import { Router } from 'express';
import { z } from 'zod';
import { getDb, nowIso, runInTransaction, uid } from '../db/database.ts';
import {
  HttpError,
  requireAuth,
  requireProjectPermission,
  validateBody,
  type AuthedRequest,
} from '../middleware/authMiddleware.ts';
import { analyzeRequirementDeterministic } from '../algorithms/requirementAnalyzer.ts';
import { enhanceRequirementAnalysisWithAi } from '../services/aiService.ts';
import { recordAuditLog } from '../services/auditService.ts';

export const requirementRouter = Router({ mergeParams: true });
requirementRouter.use(requireAuth);

const requirementSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(5000),
  category: z.string().trim().min(2).max(60),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['draft', 'in_review', 'approved', 'implemented', 'deprecated']).optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1)).max(30).optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  assigneeId: z.string().nullable().optional(),
  changeSummary: z.string().trim().max(300).optional(),
});

function formatRequirementRow(r: Record<string, unknown>) {
  return {
    id: r.id,
    projectId: r.project_id,
    reqCode: r.req_code,
    title: r.title,
    description: r.description,
    category: r.category,
    priority: r.priority,
    status: r.status,
    approvalStatus: r.approval_status,
    acceptanceCriteria: JSON.parse((r.acceptance_criteria_json as string) || '[]'),
    tags: JSON.parse((r.tags_json as string) || '[]'),
    authorId: r.author_id,
    authorName: r.author_name || '',
    assigneeId: r.assignee_id,
    versionNumber: r.version_number,
    qualityScore: r.quality_score,
    qualityBreakdown: JSON.parse((r.quality_breakdown_json as string) || '{}'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

requirementRouter.get('/', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const projectId = req.params.projectId;
  const search = String(req.query.search || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  const priority = String(req.query.priority || '').trim();
  const status = String(req.query.status || '').trim();

  const rows = db
    .prepare(
      `SELECT r.*, u.name as author_name
       FROM requirements r
       LEFT JOIN users u ON u.id = r.author_id
       WHERE r.project_id = ?
       ORDER BY r.updated_at DESC`
    )
    .all(projectId) as Array<Record<string, unknown>>;

  let formatted = rows.map(formatRequirementRow);
  if (search) {
    formatted = formatted.filter(
      (r) =>
        String(r.reqCode).toLowerCase().includes(search) ||
        String(r.title).toLowerCase().includes(search) ||
        String(r.description).toLowerCase().includes(search)
    );
  }
  if (category && category !== 'all') formatted = formatted.filter((r) => r.category === category);
  if (priority && priority !== 'all') formatted = formatted.filter((r) => r.priority === priority);
  if (status && status !== 'all') formatted = formatted.filter((r) => r.status === status);

  res.json({ requirements: formatted });
});

requirementRouter.post(
  '/analyze',
  requireProjectPermission('read'),
  validateBody(
    z.object({
      id: z.string().optional(),
      title: z.string().trim().min(2).max(200),
      description: z.string().trim().min(2).max(5000),
      category: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      useAi: z.boolean().optional(),
    })
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const body = req.body as {
        id?: string;
        title: string;
        description: string;
        category?: string;
        acceptanceCriteria?: string[];
        useAi?: boolean;
      };
      const existing = db
        .prepare('SELECT id, req_code as reqCode, title, description, acceptance_criteria_json as criteriaJson FROM requirements WHERE project_id = ?')
        .all(req.params.projectId) as Array<{
        id: string;
        reqCode: string;
        title: string;
        description: string;
        criteriaJson: string;
      }>;

      const deterministic = analyzeRequirementDeterministic(
        body,
        existing.map((e) => ({
          id: e.id,
          reqCode: e.reqCode,
          title: e.title,
          description: e.description,
          acceptanceCriteria: JSON.parse(e.criteriaJson || '[]'),
        }))
      );

      let aiEnhancement: {
        provider: string;
        executiveSummary: string;
        suggestedRewrite: { title: string; description: string; acceptanceCriteria: string[] };
      } | null = null;

      if (body.useAi) {
        aiEnhancement = await enhanceRequirementAnalysisWithAi({
          projectId: req.params.projectId,
          userId: req.user!.id,
          title: body.title,
          description: body.description,
          acceptanceCriteria: body.acceptanceCriteria || [],
          deterministic,
        });
      }

      res.json({ deterministic, aiEnhancement });
    } catch (err) {
      next(err);
    }
  }
);

requirementRouter.post(
  '/',
  requireProjectPermission('requirement:write'),
  validateBody(requirementSchema),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const projectId = req.params.projectId;
    const body = req.body as z.infer<typeof requirementSchema>;
    const prefix = (req.project!.key_prefix as string) || 'REQ';

    const existing = db
      .prepare('SELECT id, req_code as reqCode, title, description, acceptance_criteria_json as criteriaJson FROM requirements WHERE project_id = ?')
      .all(projectId) as Array<{
      id: string;
      reqCode: string;
      title: string;
      description: string;
      criteriaJson: string;
    }>;

    const nextNum = existing.length + 1;
    const reqCode = `${prefix}-REQ-${String(nextNum).padStart(3, '0')}`;
    const reqId = uid('req');
    const ts = nowIso();

    const analysis = analyzeRequirementDeterministic(
      {
        id: reqId,
        title: body.title,
        description: body.description,
        category: body.category,
        acceptanceCriteria: body.acceptanceCriteria || [],
      },
      existing.map((e) => ({
        id: e.id,
        reqCode: e.reqCode,
        title: e.title,
        description: e.description,
        acceptanceCriteria: JSON.parse(e.criteriaJson || '[]'),
      }))
    );

    runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO requirements
         (id, project_id, req_code, title, description, category, priority, status, approval_status, acceptance_criteria_json, tags_json, author_id, assignee_id, version_number, quality_score, quality_breakdown_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(
        reqId,
        projectId,
        reqCode,
        body.title,
        body.description,
        body.category,
        body.priority,
        body.status || 'draft',
        JSON.stringify(body.acceptanceCriteria || []),
        JSON.stringify(body.tags || []),
        req.user!.id,
        body.assigneeId || null,
        analysis.quality.totalScore,
        JSON.stringify(analysis.quality),
        ts,
        ts
      );

      db.prepare(
        `INSERT INTO requirement_versions
         (id, requirement_id, project_id, version_number, title, description, category, priority, status, acceptance_criteria_json, changed_by, change_summary, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'Initial requirement created', ?)`
      ).run(
        uid('rv'),
        reqId,
        projectId,
        body.title,
        body.description,
        body.category,
        body.priority,
        body.status || 'draft',
        JSON.stringify(body.acceptanceCriteria || []),
        req.user!.id,
        ts
      );

      // Automatically register a corresponding node in the dependency graph
      db.prepare(
        `INSERT INTO dependency_nodes
         (id, project_id, ref_id, node_type, name, description, criticality, metadata_json, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, 'requirement', ?, ?, ?, '{}', ?, ?, ?, ?)`
      ).run(
        uid('nod'),
        projectId,
        reqId,
        `${reqCode}: ${body.title.slice(0, 48)}`,
        body.description.slice(0, 200),
        body.priority,
        80,
        80 + (nextNum % 6) * 110,
        ts,
        ts
      );
    });

    recordAuditLog({
      organizationId: req.organizationId,
      projectId,
      actorId: req.user!.id,
      action: 'requirement.created',
      entityType: 'requirement',
      entityId: reqId,
      details: { reqCode, title: body.title },
    });

    const created = db
      .prepare('SELECT r.*, u.name as author_name FROM requirements r LEFT JOIN users u ON u.id = r.author_id WHERE r.id = ?')
      .get(reqId) as Record<string, unknown>;

    res.status(201).json({ requirement: formatRequirementRow(created), analysis });
  }
);

requirementRouter.get('/:reqId', requireProjectPermission('read'), (req: AuthedRequest, res, next) => {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT r.*, u.name as author_name FROM requirements r LEFT JOIN users u ON u.id = r.author_id WHERE r.id = ? AND r.project_id = ?')
      .get(req.params.reqId, req.params.projectId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new HttpError(404, 'Requirement not found.');
    }

    const versions = db
      .prepare(
        `SELECT rv.*, u.name as changedByName
         FROM requirement_versions rv
         LEFT JOIN users u ON u.id = rv.changed_by
         WHERE rv.requirement_id = ?
         ORDER BY rv.version_number DESC`
      )
      .all(req.params.reqId) as Array<Record<string, unknown>>;

    const comments = db
      .prepare(
        `SELECT c.id, c.body, c.created_at as createdAt, u.name as authorName, u.email as authorEmail
         FROM comments c
         LEFT JOIN users u ON u.id = c.author_id
         WHERE c.entity_type = 'requirement' AND c.entity_id = ?
         ORDER BY c.created_at ASC`
      )
      .all(req.params.reqId);

    const linkedArtifacts = db
      .prepare(
        `SELECT id, file_path as filePath, language, artifact_type as artifactType, name, signature
         FROM repository_artifacts
         WHERE project_id = ? AND linked_requirement_ids_json LIKE ?`
      )
      .all(req.params.projectId, `%${req.params.reqId}%`);

    const linkedTests = db
      .prepare(
        `SELECT id, tc_code as tcCode, title, test_type as testType, status, priority
         FROM test_cases WHERE project_id = ? AND requirement_id = ?`
      )
      .all(req.params.projectId, req.params.reqId);

    res.json({
      requirement: formatRequirementRow(row),
      versions: versions.map((v) => ({
        id: v.id,
        versionNumber: v.version_number,
        title: v.title,
        description: v.description,
        category: v.category,
        priority: v.priority,
        status: v.status,
        acceptanceCriteria: JSON.parse((v.acceptance_criteria_json as string) || '[]'),
        changedByName: v.changedByName,
        changeSummary: v.change_summary,
        createdAt: v.created_at,
      })),
      comments,
      linkedArtifacts,
      linkedTests,
    });
  } catch (err) {
    next(err);
  }
});

requirementRouter.patch(
  '/:reqId',
  requireProjectPermission('requirement:write'),
  validateBody(requirementSchema.partial()),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const existingRow = db
        .prepare('SELECT * FROM requirements WHERE id = ? AND project_id = ?')
        .get(req.params.reqId, req.params.projectId) as Record<string, unknown> | undefined;
      if (!existingRow) {
        throw new HttpError(404, 'Requirement not found.');
      }

      const body = req.body as Partial<z.infer<typeof requirementSchema>>;
      const nextTitle = body.title ?? (existingRow.title as string);
      const nextDesc = body.description ?? (existingRow.description as string);
      const nextCat = body.category ?? (existingRow.category as string);
      const nextPriority = body.priority ?? (existingRow.priority as string);
      const nextStatus = body.status ?? (existingRow.status as string);
      const nextCriteria =
        body.acceptanceCriteria ?? JSON.parse((existingRow.acceptance_criteria_json as string) || '[]');
      const nextTags = body.tags ?? JSON.parse((existingRow.tags_json as string) || '[]');
      const nextVersion = Number(existingRow.version_number) + 1;
      const ts = nowIso();

      const otherReqs = db
        .prepare('SELECT id, req_code as reqCode, title, description, acceptance_criteria_json as criteriaJson FROM requirements WHERE project_id = ? AND id != ?')
        .all(req.params.projectId, req.params.reqId) as Array<{
        id: string;
        reqCode: string;
        title: string;
        description: string;
        criteriaJson: string;
      }>;

      const analysis = analyzeRequirementDeterministic(
        {
          id: req.params.reqId,
          title: nextTitle,
          description: nextDesc,
          category: nextCat,
          acceptanceCriteria: nextCriteria,
        },
        otherReqs.map((e) => ({
          id: e.id,
          reqCode: e.reqCode,
          title: e.title,
          description: e.description,
          acceptanceCriteria: JSON.parse(e.criteriaJson || '[]'),
        }))
      );

      runInTransaction(db, () => {
        db.prepare(
          `UPDATE requirements
           SET title = ?, description = ?, category = ?, priority = ?, status = ?, acceptance_criteria_json = ?, tags_json = ?,
               version_number = ?, quality_score = ?, quality_breakdown_json = ?, updated_at = ?
           WHERE id = ?`
        ).run(
          nextTitle,
          nextDesc,
          nextCat,
          nextPriority,
          nextStatus,
          JSON.stringify(nextCriteria),
          JSON.stringify(nextTags),
          nextVersion,
          analysis.quality.totalScore,
          JSON.stringify(analysis.quality),
          ts,
          req.params.reqId
        );

        db.prepare(
          `INSERT INTO requirement_versions
           (id, requirement_id, project_id, version_number, title, description, category, priority, status, acceptance_criteria_json, changed_by, change_summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uid('rv'),
          req.params.reqId,
          req.params.projectId,
          nextVersion,
          nextTitle,
          nextDesc,
          nextCat,
          nextPriority,
          nextStatus,
          JSON.stringify(nextCriteria),
          req.user!.id,
          body.changeSummary || `Updated to v${nextVersion}`,
          ts
        );

        db.prepare('UPDATE dependency_nodes SET name = ?, criticality = ?, updated_at = ? WHERE ref_id = ?').run(
          `${existingRow.req_code}: ${nextTitle.slice(0, 48)}`,
          nextPriority,
          ts,
          req.params.reqId
        );
      });

      recordAuditLog({
        organizationId: req.organizationId,
        projectId: req.params.projectId,
        actorId: req.user!.id,
        action: 'requirement.updated',
        entityType: 'requirement',
        entityId: req.params.reqId,
        details: { versionNumber: nextVersion },
      });

      res.json({ ok: true, versionNumber: nextVersion, quality: analysis.quality });
    } catch (err) {
      next(err);
    }
  }
);

requirementRouter.post(
  '/:reqId/approve',
  requireProjectPermission('requirement:approve'),
  validateBody(z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().min(3) })),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const { decision, reason } = req.body as { decision: 'approved' | 'rejected'; reason: string };
      const existing = db
        .prepare('SELECT id FROM requirements WHERE id = ? AND project_id = ?')
        .get(req.params.reqId, req.params.projectId);
      if (!existing) throw new HttpError(404, 'Requirement not found.');

      const ts = nowIso();
      runInTransaction(db, () => {
        db.prepare(
          `UPDATE requirements SET approval_status = ?, status = ?, updated_at = ? WHERE id = ?`
        ).run(decision, decision === 'approved' ? 'approved' : 'draft', ts, req.params.reqId);

        db.prepare(
          `INSERT INTO approval_records (id, project_id, entity_type, entity_id, decision, reason, decided_by, created_at)
           VALUES (?, ?, 'requirement', ?, ?, ?, ?, ?)`
        ).run(uid('apr'), req.params.projectId, req.params.reqId, decision, reason, req.user!.id, ts);
      });

      res.json({ ok: true, approvalStatus: decision });
    } catch (err) {
      next(err);
    }
  }
);

requirementRouter.post(
  '/bulk-status',
  requireProjectPermission('requirement:write'),
  validateBody(
    z.object({
      requirementIds: z.array(z.string()).min(1).max(100),
      status: z.enum(['draft', 'in_review', 'approved', 'implemented', 'deprecated']),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const { requirementIds, status } = req.body as { requirementIds: string[]; status: string };
    const ts = nowIso();
    const stmt = db.prepare('UPDATE requirements SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?');
    runInTransaction(db, () => {
      for (const id of requirementIds) {
        stmt.run(status, ts, id, req.params.projectId);
      }
    });
    res.json({ ok: true, updatedCount: requirementIds.length });
  }
);

requirementRouter.delete('/:reqId', requireProjectPermission('requirement:write'), (req: AuthedRequest, res) => {
  const db = getDb();
  db.prepare('DELETE FROM requirements WHERE id = ? AND project_id = ?').run(
    req.params.reqId,
    req.params.projectId
  );
  db.prepare('DELETE FROM dependency_nodes WHERE ref_id = ? AND project_id = ?').run(
    req.params.reqId,
    req.params.projectId
  );
  res.json({ ok: true });
});

requirementRouter.post(
  '/:reqId/comments',
  requireProjectPermission('read'),
  validateBody(z.object({ body: z.string().trim().min(1).max(2000) })),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const id = uid('cmt');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO comments (id, project_id, entity_type, entity_id, author_id, body, created_at)
       VALUES (?, ?, 'requirement', ?, ?, ?, ?)`
    ).run(id, req.params.projectId, req.params.reqId, req.user!.id, (req.body as { body: string }).body, ts);
    res.status(201).json({ id, createdAt: ts });
  }
);
