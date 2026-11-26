import { Router } from 'express';
import { z } from 'zod';
import { getDb, nowIso, runInTransaction, uid } from '../db/database.ts';
import {
  HttpError,
  requireAuth,
  requireOrgPermission,
  validateBody,
  type AuthedRequest,
} from '../middleware/authMiddleware.ts';
import { ALL_ROLES, generateOpaqueToken } from '../utils/auth.ts';
import { recordAuditLog } from '../services/auditService.ts';
import { provisionReferenceProject } from '../services/seedService.ts';

export const orgRouter = Router();
orgRouter.use(requireAuth);

orgRouter.get('/', (req: AuthedRequest, res) => {
  const db = getDb();
  const orgs = db
    .prepare(
      `SELECT o.id, o.name, o.slug, o.description, o.created_at as createdAt, om.role
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = ? AND om.status = 'active'
       ORDER BY o.created_at ASC`
    )
    .all(req.user!.id);
  res.json({ organizations: orgs });
});

orgRouter.post(
  '/',
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(100),
      description: z.string().trim().max(500).optional(),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const { name, description } = req.body as { name: string; description?: string };
    const ts = nowIso();
    const orgId = uid('org');
    const slugBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
    const slug = `${slugBase}-${orgId.slice(-5)}`;

    runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO organizations (id, name, slug, description, owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(orgId, name, slug, description || '', req.user!.id, ts, ts);

      db.prepare(
        `INSERT INTO organization_members (id, organization_id, user_id, invited_email, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'Organization Owner', 'active', ?, ?)`
      ).run(uid('mem'), orgId, req.user!.id, req.user!.email, ts, ts);
    });

    recordAuditLog({
      organizationId: orgId,
      actorId: req.user!.id,
      action: 'organization.created',
      entityType: 'organization',
      entityId: orgId,
      details: { name },
    });

    res.status(201).json({
      organization: { id: orgId, name, slug, description: description || '', role: 'Organization Owner' },
    });
  }
);

orgRouter.get('/:orgId/members', requireOrgPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const members = db
    .prepare(
      `SELECT om.id, om.user_id as userId, om.invited_email as email, om.role, om.status, om.created_at as createdAt,
              u.name, u.job_title as jobTitle
       FROM organization_members om
       LEFT JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = ?
       ORDER BY om.created_at ASC`
    )
    .all(req.params.orgId);
  res.json({ members, availableRoles: ALL_ROLES });
});

orgRouter.post(
  '/:orgId/invitations',
  requireOrgPermission('team:invite'),
  validateBody(
    z.object({
      email: z.string().trim().email().toLowerCase(),
      role: z.enum([
        'Organization Owner',
        'Administrator',
        'Project Manager',
        'Developer',
        'Tester',
        'Viewer',
      ]),
    })
  ),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const { email, role } = req.body as { email: string; role: string };
      const orgId = req.params.orgId;
      const existing = db
        .prepare('SELECT id FROM organization_members WHERE organization_id = ? AND invited_email = ?')
        .get(orgId, email);
      if (existing) {
        throw new HttpError(409, 'This email is already a member or invited to the organization.');
      }

      const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
        | { id: string }
        | undefined;
      const ts = nowIso();
      const memId = uid('mem');
      const status = existingUser ? 'active' : 'invited';

      db.prepare(
        `INSERT INTO organization_members (id, organization_id, user_id, invited_email, role, status, invite_token, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        memId,
        orgId,
        existingUser ? existingUser.id : null,
        email,
        role,
        status,
        existingUser ? null : generateOpaqueToken(),
        ts,
        ts
      );

      if (existingUser) {
        db.prepare(
          `INSERT INTO notifications (id, user_id, title, message, link, is_read, created_at)
           VALUES (?, ?, 'Organization Invitation', ?, '/app/team', 0, ?)`
        ).run(uid('ntf'), existingUser.id, `You were added to an organization with role ${role}.`, ts);
      }

      recordAuditLog({
        organizationId: orgId,
        actorId: req.user!.id,
        action: 'team.invited',
        entityType: 'organization_member',
        entityId: memId,
        details: { email, role, status },
      });

      res.status(201).json({ id: memId, email, role, status });
    } catch (err) {
      next(err);
    }
  }
);

orgRouter.patch(
  '/:orgId/members/:memberId/role',
  requireOrgPermission('team:manage_roles'),
  validateBody(
    z.object({
      role: z.enum([
        'Organization Owner',
        'Administrator',
        'Project Manager',
        'Developer',
        'Tester',
        'Viewer',
      ]),
    })
  ),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const { role } = req.body as { role: string };
      const target = db
        .prepare('SELECT id, user_id, role FROM organization_members WHERE id = ? AND organization_id = ?')
        .get(req.params.memberId, req.params.orgId) as
        | { id: string; user_id: string | null; role: string }
        | undefined;
      if (!target) {
        throw new HttpError(404, 'Member not found.');
      }
      if (target.role === 'Organization Owner' && role !== 'Organization Owner') {
        const ownersCount = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM organization_members WHERE organization_id = ? AND role = 'Organization Owner' AND status = 'active'`
            )
            .get(req.params.orgId) as { cnt: number }
        ).cnt;
        if (ownersCount <= 1) {
          throw new HttpError(400, 'Organization must retain at least one Organization Owner.');
        }
      }

      db.prepare('UPDATE organization_members SET role = ?, updated_at = ? WHERE id = ?').run(
        role,
        nowIso(),
        target.id
      );

      recordAuditLog({
        organizationId: req.params.orgId,
        actorId: req.user!.id,
        action: 'team.role_updated',
        entityType: 'organization_member',
        entityId: target.id,
        details: { previousRole: target.role, newRole: role },
      });

      res.json({ id: target.id, role });
    } catch (err) {
      next(err);
    }
  }
);

orgRouter.delete(
  '/:orgId/members/:memberId',
  requireOrgPermission('team:manage_roles'),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const target = db
        .prepare('SELECT id, role FROM organization_members WHERE id = ? AND organization_id = ?')
        .get(req.params.memberId, req.params.orgId) as { id: string; role: string } | undefined;
      if (!target) {
        throw new HttpError(404, 'Member not found.');
      }
      if (target.role === 'Organization Owner') {
        throw new HttpError(400, 'Transfer ownership before removing an Organization Owner.');
      }
      db.prepare('DELETE FROM organization_members WHERE id = ?').run(target.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

orgRouter.get('/:orgId/audit-logs', requireOrgPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const logs = db
    .prepare(
      `SELECT al.id, al.action, al.entity_type as entityType, al.entity_id as entityId, al.details_json as detailsJson, al.created_at as createdAt,
              u.name as actorName, u.email as actorEmail
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.organization_id = ?
       ORDER BY al.created_at DESC LIMIT 100`
    )
    .all(req.params.orgId) as Array<Record<string, unknown>>;

  res.json({
    logs: logs.map((l) => ({
      ...l,
      details: JSON.parse((l.detailsJson as string) || '{}'),
    })),
  });
});

orgRouter.get('/:orgId/projects', requireOrgPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM requirements r WHERE r.project_id = p.id) as requirementCount,
              (SELECT COUNT(*) FROM change_requests cr WHERE cr.project_id = p.id AND cr.approval_status = 'pending') as pendingChangeCount,
              (SELECT COUNT(*) FROM dependency_nodes dn WHERE dn.project_id = p.id) as nodeCount
       FROM projects p
       WHERE p.organization_id = ?
       ORDER BY p.updated_at DESC`
    )
    .all(req.params.orgId) as Array<Record<string, unknown>>;

  res.json({
    projects: rows.map((p) => ({
      id: p.id,
      organizationId: p.organization_id,
      keyPrefix: p.key_prefix,
      name: p.name,
      description: p.description,
      techStack: JSON.parse((p.tech_stack_json as string) || '[]'),
      status: p.status,
      requirementCount: p.requirementCount,
      pendingChangeCount: p.pendingChangeCount,
      nodeCount: p.nodeCount,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
  });
});

orgRouter.post(
  '/:orgId/projects',
  requireOrgPermission('project:create'),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(120),
      keyPrefix: z.string().trim().min(2).max(8).toUpperCase(),
      description: z.string().trim().max(1000).optional(),
      techStack: z.array(z.string().trim().min(1)).max(20).optional(),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const { name, keyPrefix, description, techStack } = req.body as {
      name: string;
      keyPrefix: string;
      description?: string;
      techStack?: string[];
    };
    const ts = nowIso();
    const projectId = uid('prj');

    db.prepare(
      `INSERT INTO projects (id, organization_id, key_prefix, name, description, tech_stack_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      projectId,
      req.params.orgId,
      keyPrefix,
      name,
      description || '',
      JSON.stringify(techStack || []),
      req.user!.id,
      ts,
      ts
    );

    recordAuditLog({
      organizationId: req.params.orgId,
      projectId,
      actorId: req.user!.id,
      action: 'project.created',
      entityType: 'project',
      entityId: projectId,
      details: { name, keyPrefix },
    });

    res.status(201).json({
      project: {
        id: projectId,
        organizationId: req.params.orgId,
        keyPrefix,
        name,
        description: description || '',
        techStack: techStack || [],
        status: 'active',
        createdAt: ts,
        updatedAt: ts,
      },
    });
  }
);

orgRouter.post('/:orgId/projects/seed-reference', requireOrgPermission('project:create'), (req: AuthedRequest, res) => {
  const result = provisionReferenceProject(req.params.orgId, req.user!.id);
  recordAuditLog({
    organizationId: req.params.orgId,
    projectId: result.projectId,
    actorId: req.user!.id,
    action: 'project.reference_provisioned',
    entityType: 'project',
    entityId: result.projectId,
    details: { projectName: result.projectName },
  });
  res.status(201).json(result);
});
