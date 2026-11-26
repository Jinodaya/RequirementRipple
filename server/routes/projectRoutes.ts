import { Router } from 'express';
import { z } from 'zod';
import { getDb, nowIso } from '../db/database.ts';
import {
  HttpError,
  requireAuth,
  requireProjectPermission,
  validateBody,
  type AuthedRequest,
} from '../middleware/authMiddleware.ts';
import { recordAuditLog } from '../services/auditService.ts';
import { detectRequirementDrift } from '../algorithms/codeParser.ts';
import { computeGraphMetrics } from '../algorithms/graphEngine.ts';
import { askDeveloperAssistant } from '../services/aiService.ts';

export const projectRouter = Router();
projectRouter.use(requireAuth);

projectRouter.get('/:projectId', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const p = req.project!;
  res.json({
    project: {
      id: p.id,
      organizationId: p.organization_id,
      keyPrefix: p.key_prefix,
      name: p.name,
      description: p.description,
      techStack: JSON.parse((p.tech_stack_json as string) || '[]'),
      status: p.status,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    },
    role: req.orgRole,
  });
});

projectRouter.patch(
  '/:projectId',
  requireProjectPermission('project:edit'),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      techStack: z.array(z.string().trim().min(1)).max(20).optional(),
      status: z.enum(['active', 'on_hold', 'archived']).optional(),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const p = req.project!;
    const body = req.body as {
      name?: string;
      description?: string;
      techStack?: string[];
      status?: string;
    };
    const ts = nowIso();
    const nextStatus = body.status || (p.status as string);
    const archivedAt = nextStatus === 'archived' ? ts : null;

    db.prepare(
      `UPDATE projects
       SET name = ?, description = ?, tech_stack_json = ?, status = ?, archived_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      body.name ?? (p.name as string),
      body.description ?? (p.description as string),
      body.techStack ? JSON.stringify(body.techStack) : (p.tech_stack_json as string),
      nextStatus,
      archivedAt,
      ts,
      p.id as string
    );

    recordAuditLog({
      organizationId: req.organizationId,
      projectId: p.id as string,
      actorId: req.user!.id,
      action: 'project.updated',
      entityType: 'project',
      entityId: p.id as string,
      details: body,
    });

    res.json({ ok: true, status: nextStatus });
  }
);

projectRouter.delete(
  '/:projectId',
  requireProjectPermission('project:delete'),
  validateBody(z.object({ confirmName: z.string().trim() })),
  (req: AuthedRequest, res, next) => {
    try {
      const p = req.project!;
      if ((req.body as { confirmName: string }).confirmName !== p.name) {
        throw new HttpError(400, 'Confirmation name must match the project name exactly.');
      }
      const db = getDb();
      db.prepare('DELETE FROM projects WHERE id = ?').run(p.id as string);
      recordAuditLog({
        organizationId: req.organizationId,
        actorId: req.user!.id,
        action: 'project.deleted',
        entityType: 'project',
        entityId: p.id as string,
        details: { name: p.name },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

projectRouter.get('/:projectId/analytics', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const projectId = req.params.projectId;

  const requirements = db
    .prepare('SELECT id, category, priority, status, quality_score as qualityScore FROM requirements WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; category: string; priority: string; status: string; qualityScore: number }>;

  const changes = db
    .prepare(
      `SELECT cr.id, cr.cr_code as crCode, cr.title, cr.change_category as changeCategory, cr.status, cr.approval_status as approvalStatus, cr.created_at as createdAt,
              ia.impact_score as impactScore, ia.risk_level as riskLevel, ia.total_blast_radius as totalBlastRadius
       FROM change_requests cr
       LEFT JOIN impact_analyses ia ON ia.change_request_id = cr.id
       WHERE cr.project_id = ?
       ORDER BY cr.created_at DESC`
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const nodes = db
    .prepare('SELECT id, ref_id as refId, node_type as nodeType, name, criticality FROM dependency_nodes WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; refId: string | null; nodeType: string; name: string; criticality: string }>;
  const edges = db
    .prepare(
      'SELECT id, source_node_id as sourceNodeId, target_node_id as targetNodeId, relationship_type as relationshipType, is_inferred as isInferred, verified, confidence, evidence FROM dependency_edges WHERE project_id = ?'
    )
    .all(projectId) as Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    relationshipType: string;
    isInferred: number;
    verified: number;
    confidence: number;
    evidence: string;
  }>;

  const graphMetrics = computeGraphMetrics(
    nodes,
    edges.map((e) => ({ ...e, isInferred: Boolean(e.isInferred), verified: Boolean(e.verified) }))
  );

  const testCases = db
    .prepare('SELECT id, status, test_type as testType FROM test_cases WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; status: string; testType: string }>;
  const executions = db
    .prepare('SELECT outcome FROM test_executions WHERE project_id = ?')
    .all(projectId) as Array<{ outcome: string }>;
  const historical = db
    .prepare('SELECT outcome, estimated_effort_hours as est, actual_effort_hours as act FROM historical_changes WHERE project_id = ?')
    .all(projectId) as Array<{ outcome: string; est: number; act: number }>;
  const incidents = db
    .prepare('SELECT id, severity FROM incidents WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; severity: string }>;
  const conflictSum = db
    .prepare('SELECT conflicts_json as conflictsJson FROM impact_analyses WHERE project_id = ?')
    .all(projectId) as Array<{ conflictsJson: string }>;

  const totalConflicts = conflictSum.reduce(
    (acc, row) => acc + (JSON.parse(row.conflictsJson || '[]') as unknown[]).length,
    0
  );

  const avgQuality =
    requirements.length > 0
      ? Number((requirements.reduce((a, r) => a + (r.qualityScore || 0), 0) / requirements.length).toFixed(1))
      : 0;

  const categoryBreakdown = Object.entries(
    requirements.reduce<Record<string, number>>((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, count]) => ({ name, count }));

  const riskBreakdown = Object.entries(
    changes.reduce<Record<string, number>>((acc, c) => {
      const k = (c.riskLevel as string) || 'unassessed';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {})
  ).map(([name, count]) => ({ name, count }));

  const recentActivity = db
    .prepare(
      `SELECT al.id, al.action, al.entity_type as entityType, al.created_at as createdAt, u.name as actorName
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.project_id = ?
       ORDER BY al.created_at DESC LIMIT 12`
    )
    .all(projectId);

  res.json({
    summary: {
      activeRequirements: requirements.filter((r) => r.status !== 'deprecated').length,
      totalRequirements: requirements.length,
      averageQualityScore: avgQuality,
      pendingChangeRequests: changes.filter((c) => c.approvalStatus === 'pending').length,
      approvedChanges: changes.filter((c) => c.approvalStatus === 'approved').length,
      rejectedChanges: changes.filter((c) => c.approvalStatus === 'rejected').length,
      highRiskChanges: changes.filter((c) => c.riskLevel === 'high' || c.riskLevel === 'critical').length,
      detectedConflicts: totalConflicts,
      totalTestCases: testCases.length,
      passedExecutions: executions.filter((e) => e.outcome === 'passed').length,
      failedExecutions: executions.filter((e) => e.outcome === 'failed').length,
      historicalIncidents: incidents.length,
      historicalFailureRate:
        historical.length > 0
          ? Number(
              (
                (historical.filter((h) => h.outcome === 'incident' || h.outcome === 'rollback').length /
                  historical.length) *
                100
              ).toFixed(1)
            )
          : 0,
    },
    graphMetrics,
    categoryBreakdown,
    riskBreakdown,
    recentChanges: changes.slice(0, 8),
    recentActivity,
  });
});

projectRouter.get('/:projectId/drift', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const projectId = req.params.projectId;
  const reqs = db
    .prepare(
      'SELECT id, req_code as reqCode, title, description, status, acceptance_criteria_json as criteriaJson FROM requirements WHERE project_id = ?'
    )
    .all(projectId) as Array<{
    id: string;
    reqCode: string;
    title: string;
    description: string;
    status: string;
    criteriaJson: string;
  }>;
  const arts = db
    .prepare(
      `SELECT id, name, file_path as filePath, artifact_type as artifactType, routes_json as routesJson, models_json as modelsJson, calls_json as callsJson, linked_requirement_ids_json as linkedJson
       FROM repository_artifacts WHERE project_id = ?`
    )
    .all(projectId) as Array<{
    id: string;
    name: string;
    filePath: string;
    artifactType: string;
    routesJson: string;
    modelsJson: string;
    callsJson: string;
    linkedJson: string;
  }>;
  const latestSnap = db
    .prepare('SELECT created_at FROM repository_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(projectId) as { created_at: string } | undefined;

  const findings = detectRequirementDrift(
    reqs.map((r) => ({
      ...r,
      acceptanceCriteria: JSON.parse(r.criteriaJson || '[]'),
    })),
    arts.map((a) => ({
      id: a.id,
      name: a.name,
      filePath: a.filePath,
      artifactType: a.artifactType,
      routes: JSON.parse(a.routesJson || '[]'),
      models: JSON.parse(a.modelsJson || '[]'),
      calls: JSON.parse(a.callsJson || '[]'),
      linkedRequirementIds: JSON.parse(a.linkedJson || '[]'),
    })),
    latestSnap?.created_at || null
  );

  res.json({ findings, lastSyncedAt: latestSnap?.created_at || null });
});

projectRouter.post(
  '/:projectId/assistant',
  requireProjectPermission('read'),
  validateBody(z.object({ question: z.string().trim().min(3).max(800) })),
  async (req: AuthedRequest, res, next) => {
    try {
      const { question } = req.body as { question: string };
      const result = await askDeveloperAssistant({
        projectId: req.params.projectId,
        question,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
);
