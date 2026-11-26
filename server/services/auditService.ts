import { getDb, nowIso, uid } from '../db/database.ts';

export function recordAuditLog(params: {
  organizationId?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (id, organization_id, project_id, actor_id, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid('aud'),
    params.organizationId || null,
    params.projectId || null,
    params.actorId || null,
    params.action,
    params.entityType,
    params.entityId,
    JSON.stringify(params.details || {}),
    nowIso()
  );
}

export function notifyProjectMembers(params: {
  organizationId: string;
  projectId: string;
  excludeUserId?: string;
  title: string;
  message: string;
  link?: string;
}): void {
  const db = getDb();
  const members = db
    .prepare(
      `SELECT user_id FROM organization_members
       WHERE organization_id = ? AND status = 'active' AND user_id IS NOT NULL`
    )
    .all(params.organizationId) as Array<{ user_id: string }>;

  const stmt = db.prepare(
    `INSERT INTO notifications (id, user_id, project_id, title, message, link, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  );
  const ts = nowIso();
  for (const m of members) {
    if (params.excludeUserId && m.user_id === params.excludeUserId) continue;
    stmt.run(uid('ntf'), m.user_id, params.projectId, params.title, params.message, params.link || '', ts);
  }
}
