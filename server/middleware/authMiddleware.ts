import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { getDb } from '../db/database.ts';
import { hasPermission, verifyAccessToken, type Permission } from '../utils/auth.ts';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  orgRole?: string;
  organizationId?: string;
  project?: Record<string, unknown>;
}

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new HttpError(401, 'Authentication required. Please sign in.'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = verifyAccessToken(token);
    const db = getDb();
    const userRow = db
      .prepare('SELECT id, email, name FROM users WHERE id = ?')
      .get(payload.sub) as AuthUser | undefined;
    if (!userRow) {
      next(new HttpError(401, 'Session user not found.'));
      return;
    }
    req.user = userRow;
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired access token.'));
  }
}

export function requireOrgPermission(permission: Permission) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, 'Authentication required.'));
      return;
    }
    const orgId =
      (req.params.orgId as string) ||
      (req.body?.organizationId as string) ||
      (req.query.organizationId as string);
    if (!orgId || typeof orgId !== 'string') {
      next(new HttpError(400, 'Organization identifier is required.'));
      return;
    }
    const db = getDb();
    const membership = db
      .prepare(
        `SELECT role, status FROM organization_members
         WHERE organization_id = ? AND user_id = ? AND status = 'active'`
      )
      .get(orgId, req.user.id) as { role: string; status: string } | undefined;

    if (!membership) {
      next(new HttpError(403, 'You do not have access to this organization.'));
      return;
    }
    if (!hasPermission(membership.role, permission)) {
      next(new HttpError(403, `Role "${membership.role}" lacks permission "${permission}".`));
      return;
    }
    req.organizationId = orgId;
    req.orgRole = membership.role;
    next();
  };
}

export function requireProjectPermission(permission: Permission) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, 'Authentication required.'));
      return;
    }
    const projectId =
      (req.params.projectId as string) ||
      (req.body?.projectId as string) ||
      (req.query.projectId as string);
    if (!projectId || typeof projectId !== 'string') {
      next(new HttpError(400, 'Project identifier is required.'));
      return;
    }
    const db = getDb();
    const project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(projectId) as Record<string, unknown> | undefined;
    if (!project) {
      next(new HttpError(404, 'Project not found.'));
      return;
    }

    const membership = db
      .prepare(
        `SELECT role, status FROM organization_members
         WHERE organization_id = ? AND user_id = ? AND status = 'active'`
      )
      .get(project.organization_id as string, req.user.id) as
      | { role: string; status: string }
      | undefined;

    if (!membership) {
      next(new HttpError(403, 'Access denied: cross-organization isolation enforced.'));
      return;
    }
    if (!hasPermission(membership.role, permission)) {
      next(new HttpError(403, `Role "${membership.role}" lacks permission "${permission}".`));
      return;
    }
    req.organizationId = project.organization_id as string;
    req.orgRole = membership.role;
    req.project = project;
    next();
  };
}

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          new HttpError(
            400,
            err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
            err.issues
          )
        );
        return;
      }
      next(err);
    }
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      details: err.details ?? undefined,
    });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[RequirementRipple Error]', message);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
}
