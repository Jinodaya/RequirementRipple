import { Router } from 'express';
import { z } from 'zod';
import { getDb, nowIso, runInTransaction, uid } from '../db/database.ts';
import {
  clearRefreshCookie,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  setRefreshCookie,
  signAccessToken,
  verifyPassword,
  verifyRequestOrigin,
} from '../utils/auth.ts';
import { HttpError, requireAuth, validateBody, type AuthedRequest } from '../middleware/authMiddleware.ts';
import { recordAuditLog } from '../services/auditService.ts';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128),
  jobTitle: z.string().trim().max(80).optional(),
  organizationName: z.string().trim().min(2).max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1).max(128),
});

function issueSessionTokens(userId: string, email: string, name: string) {
  const db = getDb();
  const accessToken = signAccessToken({ sub: userId, email, name });
  const rawRefresh = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(uid('rt'), userId, hashToken(rawRefresh), expiresAt, nowIso());
  return { accessToken, rawRefresh };
}

function getUserOrganizations(userId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT o.id, o.name, o.slug, o.description, om.role, om.status
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = ? AND om.status = 'active'
       ORDER BY o.created_at ASC`
    )
    .all(userId);
}

authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const db = getDb();
    const { name, email, password, jobTitle, organizationName } = req.body as z.infer<typeof registerSchema>;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      throw new HttpError(409, 'An account with this email already exists.');
    }

    const passwordHash = await hashPassword(password);
    const ts = nowIso();
    const userId = uid('usr');
    const verifyToken = generateOpaqueToken();

    const createdOrgId = runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, job_title, email_verified, email_verify_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(userId, email, name, passwordHash, jobTitle || 'Software Architect', hashToken(verifyToken), ts, ts);

      // Attach any pending invitations matching this email
      db.prepare(
        `UPDATE organization_members
         SET user_id = ?, status = 'active', updated_at = ?
         WHERE invited_email = ? AND status = 'invited'`
      ).run(userId, ts, email);

      let orgId: string | null = null;
      if (organizationName) {
        orgId = uid('org');
        const slugBase = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
        const slug = `${slugBase}-${userId.slice(-5)}`;
        db.prepare(
          `INSERT INTO organizations (id, name, slug, description, owner_id, created_at, updated_at)
           VALUES (?, ?, ?, '', ?, ?, ?)`
        ).run(orgId, organizationName, slug, userId, ts, ts);

        db.prepare(
          `INSERT INTO organization_members (id, organization_id, user_id, invited_email, role, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Organization Owner', 'active', ?, ?)`
        ).run(uid('mem'), orgId, userId, email, ts, ts);
      }
      return orgId;
    });

    if (createdOrgId) {
      recordAuditLog({
        organizationId: createdOrgId,
        actorId: userId,
        action: 'organization.created',
        entityType: 'organization',
        entityId: createdOrgId,
      });
    }

    const { accessToken, rawRefresh } = issueSessionTokens(userId, email, name);
    setRefreshCookie(res, rawRefresh);

    res.status(201).json({
      accessToken,
      user: {
        id: userId,
        email,
        name,
        jobTitle: jobTitle || 'Software Architect',
        emailVerified: false,
      },
      emailVerificationPreviewToken: verifyToken,
      organizations: getUserOrganizations(userId),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const db = getDb();
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = db
      .prepare('SELECT id, email, name, password_hash, job_title, email_verified FROM users WHERE email = ?')
      .get(email) as
      | { id: string; email: string; name: string; password_hash: string; job_title: string; email_verified: number }
      | undefined;

    if (!user) {
      throw new HttpError(401, 'Invalid email or password.');
    }
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    const { accessToken, rawRefresh } = issueSessionTokens(user.id, user.email, user.name);
    setRefreshCookie(res, rawRefresh);

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        jobTitle: user.job_title,
        emailVerified: Boolean(user.email_verified),
      },
      organizations: getUserOrganizations(user.id),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', (req, res, next) => {
  try {
    if (!verifyRequestOrigin(req)) {
      throw new HttpError(403, 'Origin check failed.');
    }
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)rr_refresh=([^;]+)/);
    const rawRefresh = match ? decodeURIComponent(match[1]) : null;
    if (!rawRefresh) {
      throw new HttpError(401, 'No active refresh session.');
    }

    const db = getDb();
    const tokenHash = hashToken(rawRefresh);
    const row = db
      .prepare(
        `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked, u.email, u.name, u.job_title, u.email_verified
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = ?`
      )
      .get(tokenHash) as
      | {
          id: string;
          user_id: string;
          expires_at: string;
          revoked: number;
          email: string;
          name: string;
          job_title: string;
          email_verified: number;
        }
      | undefined;

    if (!row || row.revoked || new Date(row.expires_at).getTime() < Date.now()) {
      clearRefreshCookie(res);
      throw new HttpError(401, 'Refresh session expired or revoked.');
    }

    // Rotate refresh token
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
    const { accessToken, rawRefresh: nextRefresh } = issueSessionTokens(row.user_id, row.email, row.name);
    setRefreshCookie(res, nextRefresh);

    res.json({
      accessToken,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        jobTitle: row.job_title,
        emailVerified: Boolean(row.email_verified),
      },
      organizations: getUserOrganizations(row.user_id),
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', (req, res) => {
  if (verifyRequestOrigin(req)) {
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)rr_refresh=([^;]+)/);
    if (match) {
      const db = getDb();
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(
        hashToken(decodeURIComponent(match[1]))
      );
    }
  }
  clearRefreshCookie(res);
  res.json({ ok: true });
});

authRouter.post(
  '/forgot-password',
  validateBody(z.object({ email: z.string().trim().email().toLowerCase() })),
  (req, res, next) => {
    try {
      const db = getDb();
      const { email } = req.body as { email: string };
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
      if (!user) {
        // Avoid user enumeration
        res.json({
          message: 'If an account matches that email, password reset instructions have been prepared.',
        });
        return;
      }
      const rawToken = generateOpaqueToken();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`
      ).run(uid('pwr'), user.id, hashToken(rawToken), expiresAt, nowIso());

      res.json({
        message: 'Password reset token generated (valid for 30 minutes).',
        resetTokenPreview: rawToken,
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  '/reset-password',
  validateBody(z.object({ token: z.string().min(10), newPassword: z.string().min(8).max(128) })),
  async (req, res, next) => {
    try {
      const db = getDb();
      const { token, newPassword } = req.body as { token: string; newPassword: string };
      const resetRow = db
        .prepare('SELECT id, user_id, expires_at, used FROM password_resets WHERE token_hash = ?')
        .get(hashToken(token)) as
        | { id: string; user_id: string; expires_at: string; used: number }
        | undefined;

      if (!resetRow || resetRow.used || new Date(resetRow.expires_at).getTime() < Date.now()) {
        throw new HttpError(400, 'Invalid or expired password reset token.');
      }

      const passwordHash = await hashPassword(newPassword);
      runInTransaction(db, () => {
        db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
          passwordHash,
          nowIso(),
          resetRow.user_id
        );
        db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(resetRow.id);
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(resetRow.user_id);
      });

      res.json({ message: 'Password updated successfully. You may now sign in.' });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post('/verify-email', validateBody(z.object({ token: z.string().min(10) })), (req, res, next) => {
  try {
    const db = getDb();
    const { token } = req.body as { token: string };
    const user = db
      .prepare('SELECT id FROM users WHERE email_verify_token = ?')
      .get(hashToken(token)) as { id: string } | undefined;
    if (!user) {
      throw new HttpError(400, 'Invalid verification token.');
    }
    db.prepare('UPDATE users SET email_verified = 1, email_verify_token = NULL, updated_at = ? WHERE id = ?').run(
      nowIso(),
      user.id
    );
    res.json({ ok: true, emailVerified: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const user = db
    .prepare('SELECT id, email, name, job_title as jobTitle, email_verified as emailVerified, created_at as createdAt FROM users WHERE id = ?')
    .get(req.user!.id);
  res.json({
    user,
    organizations: getUserOrganizations(req.user!.id),
  });
});

authRouter.patch(
  '/profile',
  requireAuth,
  validateBody(z.object({ name: z.string().trim().min(2).max(80), jobTitle: z.string().trim().min(2).max(80) })),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const { name, jobTitle } = req.body as { name: string; jobTitle: string };
    db.prepare('UPDATE users SET name = ?, job_title = ?, updated_at = ? WHERE id = ?').run(
      name,
      jobTitle,
      nowIso(),
      req.user!.id
    );
    res.json({ id: req.user!.id, email: req.user!.email, name, jobTitle });
  }
);

authRouter.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, project_id as projectId, title, message, link, is_read as isRead, created_at as createdAt
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`
    )
    .all(req.user!.id);
  res.json({ notifications: rows });
});

authRouter.patch('/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    req.params.id,
    req.user!.id
  );
  res.json({ ok: true });
});
