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
import { runChangeImpactAnalysis, type EffortAssumptions } from '../algorithms/impactEngine.ts';
import { inferHiddenDependencies, parseSourceFile } from '../algorithms/codeParser.ts';
import { explainImpactWithAi, generateTestCasesWithAi } from '../services/aiService.ts';
import { syncGitHubRepository } from '../services/githubService.ts';
import { encryptSecret } from '../utils/auth.ts';
import { notifyProjectMembers, recordAuditLog } from '../services/auditService.ts';

export const changeAndIntelRouter = Router({ mergeParams: true });
changeAndIntelRouter.use(requireAuth);

function executeAndPersistImpactAnalysis(
  projectId: string,
  changeRequestId: string,
  aiSummary: string | null,
  aiProvider: string,
  assumptions?: Partial<EffortAssumptions>
) {
  const db = getDb();
  const cr = db
    .prepare('SELECT * FROM change_requests WHERE id = ? AND project_id = ?')
    .get(changeRequestId, projectId) as Record<string, unknown>;

  const origSnap = JSON.parse((cr.original_snapshot_json as string) || '{}') as {
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
  };

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

  const otherReqs = db
    .prepare(
      'SELECT id, req_code as reqCode, title, description, acceptance_criteria_json as criteriaJson FROM requirements WHERE project_id = ?'
    )
    .all(projectId) as Array<{
    id: string;
    reqCode: string;
    title: string;
    description: string;
    criteriaJson: string;
  }>;

  const repoArts = db
    .prepare(
      'SELECT id, name, file_path as filePath, artifact_type as artifactType, linked_requirement_ids_json as linkedJson FROM repository_artifacts WHERE project_id = ?'
    )
    .all(projectId) as Array<{
    id: string;
    name: string;
    filePath: string;
    artifactType: string;
    linkedJson: string;
  }>;

  const testCases = db
    .prepare('SELECT id, tc_code as tcCode, title, requirement_id as requirementId FROM test_cases WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; tcCode: string; title: string; requirementId: string | null }>;

  const incidents = db
    .prepare('SELECT id, title, severity, affected_components_json as compJson FROM incidents WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; title: string; severity: string; compJson: string }>;

  const report = runChangeImpactAnalysis({
    changeCategory: cr.change_category as string,
    originalTitle: origSnap.title || (cr.proposed_title as string),
    originalDescription: origSnap.description || '',
    originalCriteria: origSnap.acceptanceCriteria || [],
    proposedTitle: cr.proposed_title as string,
    proposedDescription: cr.proposed_description as string,
    proposedCriteria: JSON.parse((cr.proposed_acceptance_criteria_json as string) || '[]'),
    requirementId: (cr.requirement_id as string) || null,
    nodes,
    edges: edges.map((e) => ({ ...e, isInferred: Boolean(e.isInferred), verified: Boolean(e.verified) })),
    otherRequirements: otherReqs.map((r) => ({
      ...r,
      acceptanceCriteria: JSON.parse(r.criteriaJson || '[]'),
    })),
    repositoryArtifacts: repoArts.map((a) => ({
      id: a.id,
      name: a.name,
      filePath: a.filePath,
      artifactType: a.artifactType,
      linkedRequirementIds: JSON.parse(a.linkedJson || '[]'),
    })),
    testCases,
    historicalIncidents: incidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      affectedComponents: JSON.parse(i.compJson || '[]'),
    })),
    assumptions,
  });

  const iaId = uid('ia');
  const ts = nowIso();
  const finalExplanation = aiSummary || report.explanation;

  runInTransaction(db, () => {
    db.prepare(
      `INSERT INTO impact_analyses
       (id, project_id, change_request_id, semantic_diff_json, direct_count, indirect_count, potential_count, uncertain_count, total_blast_radius, impact_score, risk_level, confidence, recommendation, explanation, conflicts_json, missing_dependencies_json, effort_estimate_json, scoring_breakdown_json, ai_provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      iaId,
      projectId,
      changeRequestId,
      JSON.stringify(report.semanticDiff),
      report.directCount,
      report.indirectCount,
      report.potentialCount,
      report.uncertainCount,
      report.totalBlastRadius,
      report.impactScore,
      report.riskLevel,
      report.confidence,
      report.recommendation,
      finalExplanation,
      JSON.stringify(report.conflicts),
      JSON.stringify(report.missingDependencies),
      JSON.stringify(report.effortEstimate),
      JSON.stringify(report.scoringBreakdown),
      aiProvider,
      ts
    );

    for (const item of report.impactedArtifacts) {
      db.prepare(
        `INSERT INTO impacted_artifacts
         (id, impact_analysis_id, project_id, node_id, artifact_name, artifact_type, impact_tier, relationship, hop_distance, impact_reason, evidence, confidence, risk_level, recommended_action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uid('imp'),
        iaId,
        projectId,
        item.nodeId,
        item.artifactName,
        item.artifactType,
        item.impactTier,
        item.relationship,
        item.hopDistance,
        item.impactReason,
        item.evidence,
        item.confidence,
        item.riskLevel,
        item.recommendedAction
      );
    }

    db.prepare("UPDATE change_requests SET analysis_status = 'completed', updated_at = ? WHERE id = ?").run(
      ts,
      changeRequestId
    );
  });

  return { iaId, report, finalExplanation };
}

// ============================================
// CHANGE REQUESTS & IMPACT ANALYSIS
// ============================================

changeAndIntelRouter.get('/changes', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT cr.*, u.name as requesterName,
              (SELECT impact_score FROM impact_analyses ia WHERE ia.change_request_id = cr.id ORDER BY ia.created_at DESC LIMIT 1) as impactScore,
              (SELECT risk_level FROM impact_analyses ia WHERE ia.change_request_id = cr.id ORDER BY ia.created_at DESC LIMIT 1) as riskLevel,
              (SELECT total_blast_radius FROM impact_analyses ia WHERE ia.change_request_id = cr.id ORDER BY ia.created_at DESC LIMIT 1) as totalBlastRadius,
              (SELECT recommendation FROM impact_analyses ia WHERE ia.change_request_id = cr.id ORDER BY ia.created_at DESC LIMIT 1) as recommendation
       FROM change_requests cr
       LEFT JOIN users u ON u.id = cr.requester_id
       WHERE cr.project_id = ?
       ORDER BY cr.created_at DESC`
    )
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  res.json({
    changes: rows.map((c) => ({
      id: c.id,
      projectId: c.project_id,
      crCode: c.cr_code,
      requirementId: c.requirement_id,
      changeCategory: c.change_category,
      title: c.title,
      reason: c.reason,
      proposedTitle: c.proposed_title,
      proposedDescription: c.proposed_description,
      priority: c.priority,
      status: c.status,
      approvalStatus: c.approval_status,
      analysisStatus: c.analysis_status,
      requesterName: c.requesterName,
      impactScore: c.impactScore,
      riskLevel: c.riskLevel,
      totalBlastRadius: c.totalBlastRadius,
      recommendation: c.recommendation,
      createdAt: c.created_at,
    })),
  });
});

changeAndIntelRouter.post(
  '/changes',
  requireProjectPermission('change:submit'),
  validateBody(
    z.object({
      requirementId: z.string().nullable().optional(),
      changeCategory: z.enum(['Addition', 'Modification', 'Removal', 'Replacement', 'Enhancement']),
      title: z.string().trim().min(3).max(200),
      reason: z.string().trim().min(5).max(1000),
      proposedTitle: z.string().trim().min(3).max(200),
      proposedDescription: z.string().trim().min(10).max(5000),
      proposedAcceptanceCriteria: z.array(z.string().trim()).max(30).default([]),
      priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      useAiSummary: z.boolean().optional(),
    })
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const projectId = req.params.projectId;
      const b = req.body as {
        requirementId?: string | null;
        changeCategory: string;
        title: string;
        reason: string;
        proposedTitle: string;
        proposedDescription: string;
        proposedAcceptanceCriteria: string[];
        priority: string;
        useAiSummary?: boolean;
      };

      let originalSnapshot: Record<string, unknown> = {};
      if (b.requirementId) {
        const orig = db
          .prepare('SELECT req_code, title, description, acceptance_criteria_json FROM requirements WHERE id = ? AND project_id = ?')
          .get(b.requirementId, projectId) as Record<string, unknown> | undefined;
        if (orig) {
          originalSnapshot = {
            reqCode: orig.req_code,
            title: orig.title,
            description: orig.description,
            acceptanceCriteria: JSON.parse((orig.acceptance_criteria_json as string) || '[]'),
          };
        }
      }

      const count = (db.prepare('SELECT COUNT(*) as c FROM change_requests WHERE project_id = ?').get(projectId) as { c: number }).c;
      const prefix = (req.project!.key_prefix as string) || 'CR';
      const crCode = `${prefix}-CR-${String(count + 1).padStart(3, '0')}`;
      const crId = uid('cr');
      const ts = nowIso();

      db.prepare(
        `INSERT INTO change_requests
         (id, project_id, cr_code, requirement_id, change_category, title, reason, original_snapshot_json, proposed_title, proposed_description, proposed_acceptance_criteria_json, priority, status, approval_status, analysis_status, requester_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_review', 'pending', 'running', ?, ?, ?)`
      ).run(
        crId,
        projectId,
        crCode,
        b.requirementId || null,
        b.changeCategory,
        b.title,
        b.reason,
        JSON.stringify(originalSnapshot),
        b.proposedTitle,
        b.proposedDescription,
        JSON.stringify(b.proposedAcceptanceCriteria),
        b.priority,
        req.user!.id,
        ts,
        ts
      );

      // Run 10-step impact analysis immediately
      const firstPass = executeAndPersistImpactAnalysis(projectId, crId, null, 'deterministic');

      if (b.useAiSummary) {
        const aiExplain = await explainImpactWithAi({
          changeTitle: b.title,
          reason: b.reason,
          report: firstPass.report,
        });
        db.prepare('UPDATE impact_analyses SET explanation = ?, ai_provider = ? WHERE id = ?').run(
          aiExplain.stakeholderSummary,
          aiExplain.provider,
          firstPass.iaId
        );
      }

      if (firstPass.report.riskLevel === 'high' || firstPass.report.riskLevel === 'critical') {
        notifyProjectMembers({
          organizationId: req.organizationId!,
          projectId,
          excludeUserId: req.user!.id,
          title: `High-Risk Change Request: ${crCode}`,
          message: `${b.title} scored ${firstPass.report.impactScore}/100 (${firstPass.report.riskLevel} risk).`,
          link: `/app/changes/${crId}`,
        });
      }

      recordAuditLog({
        organizationId: req.organizationId,
        projectId,
        actorId: req.user!.id,
        action: 'change_request.submitted',
        entityType: 'change_request',
        entityId: crId,
        details: { crCode, impactScore: firstPass.report.impactScore, riskLevel: firstPass.report.riskLevel },
      });

      res.status(201).json({
        id: crId,
        crCode,
        impactAnalysisId: firstPass.iaId,
        impactScore: firstPass.report.impactScore,
        riskLevel: firstPass.report.riskLevel,
      });
    } catch (err) {
      next(err);
    }
  }
);

changeAndIntelRouter.get('/changes/:crId', requireProjectPermission('read'), (req: AuthedRequest, res, next) => {
  try {
    const db = getDb();
    const cr = db
      .prepare(
        `SELECT cr.*, u.name as requesterName, rev.name as reviewerName
         FROM change_requests cr
         LEFT JOIN users u ON u.id = cr.requester_id
         LEFT JOIN users rev ON rev.id = cr.reviewer_id
         WHERE cr.id = ? AND cr.project_id = ?`
      )
      .get(req.params.crId, req.params.projectId) as Record<string, unknown> | undefined;

    if (!cr) throw new HttpError(404, 'Change request not found.');

    const latestIa = db
      .prepare('SELECT * FROM impact_analyses WHERE change_request_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.params.crId) as Record<string, unknown> | undefined;

    const impactedArtifacts = latestIa
      ? db
          .prepare('SELECT * FROM impacted_artifacts WHERE impact_analysis_id = ? ORDER BY hop_distance ASC, confidence DESC')
          .all(latestIa.id as string)
      : [];

    const approvals = db
      .prepare(
        `SELECT ar.*, u.name as decidedByName
         FROM approval_records ar
         LEFT JOIN users u ON u.id = ar.decided_by
         WHERE ar.entity_type = 'change_request' AND ar.entity_id = ?
         ORDER BY ar.created_at DESC`
      )
      .all(req.params.crId);

    const comments = db
      .prepare(
        `SELECT c.id, c.body, c.created_at as createdAt, u.name as authorName
         FROM comments c LEFT JOIN users u ON u.id = c.author_id
         WHERE c.entity_type = 'change_request' AND c.entity_id = ?
         ORDER BY c.created_at ASC`
      )
      .all(req.params.crId);

    const historicalMatches = db
      .prepare(
        `SELECT id, title, outcome, actual_effort_hours as actualEffortHours, resolution, lessons_learned as lessonsLearned
         FROM historical_changes WHERE project_id = ? ORDER BY created_at DESC LIMIT 5`
      )
      .all(req.params.projectId);

    res.json({
      changeRequest: {
        id: cr.id,
        projectId: cr.project_id,
        crCode: cr.cr_code,
        requirementId: cr.requirement_id,
        changeCategory: cr.change_category,
        title: cr.title,
        reason: cr.reason,
        originalSnapshot: JSON.parse((cr.original_snapshot_json as string) || '{}'),
        proposedTitle: cr.proposed_title,
        proposedDescription: cr.proposed_description,
        proposedAcceptanceCriteria: JSON.parse((cr.proposed_acceptance_criteria_json as string) || '[]'),
        priority: cr.priority,
        status: cr.status,
        approvalStatus: cr.approval_status,
        analysisStatus: cr.analysis_status,
        decisionReason: cr.decision_reason,
        requesterName: cr.requesterName,
        reviewerName: cr.reviewerName,
        createdAt: cr.created_at,
      },
      impactAnalysis: latestIa
        ? {
            id: latestIa.id,
            semanticDiff: JSON.parse((latestIa.semantic_diff_json as string) || '{}'),
            directCount: latestIa.direct_count,
            indirectCount: latestIa.indirect_count,
            potentialCount: latestIa.potential_count,
            uncertainCount: latestIa.uncertain_count,
            totalBlastRadius: latestIa.total_blast_radius,
            impactScore: latestIa.impact_score,
            riskLevel: latestIa.risk_level,
            confidence: latestIa.confidence,
            recommendation: latestIa.recommendation,
            explanation: latestIa.explanation,
            conflicts: JSON.parse((latestIa.conflicts_json as string) || '[]'),
            missingDependencies: JSON.parse((latestIa.missing_dependencies_json as string) || '[]'),
            effortEstimate: JSON.parse((latestIa.effort_estimate_json as string) || '{}'),
            scoringBreakdown: JSON.parse((latestIa.scoring_breakdown_json as string) || '{}'),
            aiProvider: latestIa.ai_provider,
            createdAt: latestIa.created_at,
          }
        : null,
      impactedArtifacts,
      approvals,
      comments,
      historicalMatches,
    });
  } catch (err) {
    next(err);
  }
});

changeAndIntelRouter.post(
  '/changes/:crId/analyze',
  requireProjectPermission('change:submit'),
  validateBody(
    z.object({
      assumptions: z
        .object({
          hoursPerDirectArtifact: z.number().min(0.5).max(40).optional(),
          hoursPerIndirectArtifact: z.number().min(0.25).max(20).optional(),
          hoursPerDbMigration: z.number().min(0.5).max(40).optional(),
          hoursPerTestCase: z.number().min(0.25).max(16).optional(),
          maintenanceMultiplier: z.number().min(0).max(1).optional(),
        })
        .optional(),
      useAiSummary: z.boolean().optional(),
    })
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const cr = db
        .prepare('SELECT id, title, reason FROM change_requests WHERE id = ? AND project_id = ?')
        .get(req.params.crId, req.params.projectId) as { id: string; title: string; reason: string } | undefined;
      if (!cr) throw new HttpError(404, 'Change request not found.');

      const b = req.body as { assumptions?: Partial<EffortAssumptions>; useAiSummary?: boolean };
      const resAnalysis = executeAndPersistImpactAnalysis(
        req.params.projectId,
        req.params.crId,
        null,
        'deterministic',
        b.assumptions
      );

      if (b.useAiSummary) {
        const aiExplain = await explainImpactWithAi({
          changeTitle: cr.title,
          reason: cr.reason,
          report: resAnalysis.report,
        });
        db.prepare('UPDATE impact_analyses SET explanation = ?, ai_provider = ? WHERE id = ?').run(
          aiExplain.stakeholderSummary,
          aiExplain.provider,
          resAnalysis.iaId
        );
      }

      res.json({ ok: true, impactAnalysisId: resAnalysis.iaId, report: resAnalysis.report });
    } catch (err) {
      next(err);
    }
  }
);

changeAndIntelRouter.post(
  '/changes/:crId/decision',
  requireProjectPermission('change:approve'),
  validateBody(
    z.object({
      decision: z.enum(['approved', 'rejected', 'clarification_requested']),
      reason: z.string().trim().min(5).max(1000),
    })
  ),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const { decision, reason } = req.body as {
        decision: 'approved' | 'rejected' | 'clarification_requested';
        reason: string;
      };
      const cr = db
        .prepare('SELECT * FROM change_requests WHERE id = ? AND project_id = ?')
        .get(req.params.crId, req.params.projectId) as Record<string, unknown> | undefined;
      if (!cr) throw new HttpError(404, 'Change request not found.');

      const ts = nowIso();
      const nextStatus = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'clarification_requested';

      runInTransaction(db, () => {
        db.prepare(
          `UPDATE change_requests
           SET approval_status = ?, status = ?, reviewer_id = ?, decision_reason = ?, updated_at = ?
           WHERE id = ?`
        ).run(decision, nextStatus, req.user!.id, reason, ts, cr.id as string);

        db.prepare(
          `INSERT INTO approval_records (id, project_id, entity_type, entity_id, decision, reason, decided_by, created_at)
           VALUES (?, ?, 'change_request', ?, ?, ?, ?, ?)`
        ).run(uid('apr'), req.params.projectId, cr.id as string, decision, reason, req.user!.id, ts);

        // If approved and linked to an existing requirement, advance requirement version cleanly
        if (decision === 'approved' && cr.requirement_id) {
          const reqRow = db
            .prepare('SELECT version_number FROM requirements WHERE id = ?')
            .get(cr.requirement_id as string) as { version_number: number } | undefined;
          if (reqRow) {
            const nextVer = reqRow.version_number + 1;
            db.prepare(
              `UPDATE requirements SET title = ?, description = ?, acceptance_criteria_json = ?, version_number = ?, updated_at = ? WHERE id = ?`
            ).run(
              cr.proposed_title as string,
              cr.proposed_description as string,
              cr.proposed_acceptance_criteria_json as string,
              nextVer,
              ts,
              cr.requirement_id as string
            );
            db.prepare(
              `INSERT INTO requirement_versions
               (id, requirement_id, project_id, version_number, title, description, category, priority, status, acceptance_criteria_json, changed_by, change_summary, created_at)
               SELECT ?, id, project_id, ?, title, description, category, priority, status, acceptance_criteria_json, ?, ?, ?
               FROM requirements WHERE id = ?`
            ).run(uid('rv'), nextVer, req.user!.id, `Approved via ${cr.cr_code}: ${reason}`, ts, cr.requirement_id as string);
          }
        }

        // Record in Historical Change Intelligence
        if (decision === 'approved') {
          const latestIa = db
            .prepare('SELECT effort_estimate_json FROM impact_analyses WHERE change_request_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(cr.id as string) as { effort_estimate_json?: string } | undefined;
          const estHours = latestIa?.effort_estimate_json
            ? JSON.parse(latestIa.effort_estimate_json).totalHours || 0
            : 0;
          const orig = JSON.parse((cr.original_snapshot_json as string) || '{}') as { description?: string };
          db.prepare(
            `INSERT INTO historical_changes
             (id, project_id, change_request_id, title, original_requirement, approved_change, estimated_effort_hours, resolution, outcome, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)`
          ).run(
            uid('hst'),
            req.params.projectId,
            cr.id as string,
            `${cr.cr_code}: ${cr.title}`,
            orig.description || (cr.title as string),
            cr.proposed_description as string,
            estHours,
            reason,
            ts
          );
        }
      });

      recordAuditLog({
        organizationId: req.organizationId,
        projectId: req.params.projectId,
        actorId: req.user!.id,
        action: `change_request.${decision}`,
        entityType: 'change_request',
        entityId: cr.id as string,
        details: { crCode: cr.cr_code, reason },
      });

      res.json({ ok: true, approvalStatus: decision });
    } catch (err) {
      next(err);
    }
  }
);

changeAndIntelRouter.post(
  '/changes/:crId/comments',
  requireProjectPermission('read'),
  validateBody(z.object({ body: z.string().trim().min(1).max(2000) })),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const id = uid('cmt');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO comments (id, project_id, entity_type, entity_id, author_id, body, created_at)
       VALUES (?, ?, 'change_request', ?, ?, ?, ?)`
    ).run(id, req.params.projectId, req.params.crId, req.user!.id, (req.body as { body: string }).body, ts);
    res.status(201).json({ id, createdAt: ts });
  }
);

// ============================================
// REPOSITORY & AST CODE INTELLIGENCE
// ============================================

function persistArtifactsAndInferEdges(
  projectId: string,
  userId: string,
  snapshotId: string,
  parsedArtifacts: ReturnType<typeof parseSourceFile>
) {
  const db = getDb();
  const ts = nowIso();
  const insertedIds: string[] = [];

  for (const art of parsedArtifacts) {
    const artId = uid('art');
    insertedIds.push(artId);
    db.prepare(
      `INSERT INTO repository_artifacts
       (id, project_id, snapshot_id, file_path, language, artifact_type, name, signature, imports_json, calls_json, routes_json, models_json, linked_requirement_ids_json, content_hash, line_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`
    ).run(
      artId,
      projectId,
      snapshotId,
      art.filePath,
      art.language,
      art.artifactType,
      art.name,
      art.signature,
      JSON.stringify(art.imports),
      JSON.stringify(art.calls),
      JSON.stringify(art.routes),
      JSON.stringify(art.models),
      art.contentHash,
      art.lineCount,
      ts,
      ts
    );

    // Ensure dependency node exists for artifact
    const existingNode = db
      .prepare('SELECT id FROM dependency_nodes WHERE project_id = ? AND name = ?')
      .get(projectId, art.name);
    if (!existingNode && (art.artifactType === 'module' || art.artifactType === 'api_route' || art.artifactType === 'db_model')) {
      const mappedType =
        art.artifactType === 'api_route' ? 'api_endpoint' : art.artifactType === 'db_model' ? 'db_collection' : 'source_file';
      db.prepare(
        `INSERT INTO dependency_nodes (id, project_id, ref_id, node_type, name, description, criticality, metadata_json, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'medium', '{}', ?, ?, ?, ?)`
      ).run(uid('nod'), projectId, artId, mappedType, art.name, art.signature, 420 + (insertedIds.length % 3) * 220, 120 + (insertedIds.length % 5) * 110, ts, ts);
    }
  }

  // Run hidden dependency inference across project artifacts + requirements
  const allArtifacts = db
    .prepare(
      'SELECT id, name, file_path as filePath, artifact_type as artifactType, imports_json, calls_json, routes_json, models_json FROM repository_artifacts WHERE project_id = ?'
    )
    .all(projectId) as Array<Record<string, unknown>>;
  const reqs = db
    .prepare('SELECT id, req_code as reqCode, title, description FROM requirements WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; reqCode: string; title: string; description: string }>;

  const inferred = inferHiddenDependencies(
    allArtifacts.map((a) => ({
      id: a.id as string,
      name: a.name as string,
      filePath: a.filePath as string,
      artifactType: a.artifactType as string,
      imports: JSON.parse((a.imports_json as string) || '[]'),
      calls: JSON.parse((a.calls_json as string) || '[]'),
      routes: JSON.parse((a.routes_json as string) || '[]'),
      models: JSON.parse((a.models_json as string) || '[]'),
    })),
    reqs
  );

  const nodes = db
    .prepare('SELECT id, name FROM dependency_nodes WHERE project_id = ?')
    .all(projectId) as Array<{ id: string; name: string }>;
  const nodeByName = new Map(nodes.map((n) => [n.name, n.id]));

  let inferredCreated = 0;
  for (const cand of inferred) {
    const srcId = nodeByName.get(cand.sourceName);
    const tgtId =
      nodeByName.get(cand.targetName) ||
      nodes.find((n) => n.name.startsWith(cand.targetName.split(':')[0]))?.id;
    if (srcId && tgtId && srcId !== tgtId) {
      const exists = db
        .prepare(
          'SELECT id FROM dependency_edges WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND relationship_type = ?'
        )
        .get(projectId, srcId, tgtId, cand.relationshipType);
      if (!exists) {
        db.prepare(
          `INSERT INTO dependency_edges (id, project_id, source_node_id, target_node_id, relationship_type, is_inferred, verified, confidence, evidence, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`
        ).run(uid('edg'), projectId, srcId, tgtId, cand.relationshipType, cand.confidence, cand.evidence, userId, ts);
        inferredCreated++;
      }
    }
  }

  return { artifactsCreated: insertedIds.length, inferredEdgesCreated: inferredCreated };
}

changeAndIntelRouter.get('/repository', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const projectId = req.params.projectId;
  const connections = db
    .prepare(
      'SELECT id, provider, repo_owner as repoOwner, repo_name as repoName, branch, repo_url as repoUrl, has_token as hasToken, last_synced_at as lastSyncedAt, last_commit_sha as lastCommitSha, sync_status as syncStatus, metadata_json as metadataJson FROM repository_connections WHERE project_id = ?'
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const snapshots = db
    .prepare('SELECT id, branch, commit_sha as commitSha, file_count as fileCount, artifact_count as artifactCount, created_at as createdAt FROM repository_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(projectId);

  const artifacts = db
    .prepare('SELECT * FROM repository_artifacts WHERE project_id = ? ORDER BY file_path ASC')
    .all(projectId) as Array<Record<string, unknown>>;

  res.json({
    connections: connections.map((c) => ({
      ...c,
      hasToken: Boolean(c.hasToken),
      metadata: JSON.parse((c.metadataJson as string) || '{}'),
    })),
    snapshots,
    artifacts: artifacts.map((a) => ({
      id: a.id,
      filePath: a.file_path,
      language: a.language,
      artifactType: a.artifact_type,
      name: a.name,
      signature: a.signature,
      imports: JSON.parse((a.imports_json as string) || '[]'),
      calls: JSON.parse((a.calls_json as string) || '[]'),
      routes: JSON.parse((a.routes_json as string) || '[]'),
      models: JSON.parse((a.models_json as string) || '[]'),
      linkedRequirementIds: JSON.parse((a.linked_requirement_ids_json as string) || '[]'),
      lineCount: a.line_count,
    })),
  });
});

changeAndIntelRouter.post(
  '/repository/connect-github',
  requireProjectPermission('repository:connect'),
  validateBody(
    z.object({
      owner: z.string().trim().min(1).max(100),
      repo: z.string().trim().min(1).max(100),
      branch: z.string().trim().min(1).max(100).default('main'),
      accessToken: z.string().trim().optional(),
    })
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const projectId = req.params.projectId;
      const { owner, repo, branch, accessToken } = req.body as {
        owner: string;
        repo: string;
        branch: string;
        accessToken?: string;
      };
      const encrypted = accessToken ? encryptSecret(accessToken) : '';
      const syncResult = await syncGitHubRepository({
        owner,
        repo,
        branch,
        encryptedToken: encrypted || undefined,
      });

      const ts = nowIso();
      const connId = uid('rcn');
      const snapId = uid('rsn');

      const counts = runInTransaction(db, () => {
        db.prepare(
          `INSERT INTO repository_connections
           (id, project_id, provider, repo_owner, repo_name, branch, repo_url, token_encrypted, has_token, last_synced_at, last_commit_sha, sync_status, metadata_json, created_by, created_at, updated_at)
           VALUES (?, ?, 'github', ?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?, ?, ?, ?)`
        ).run(
          connId,
          projectId,
          owner,
          repo,
          syncResult.defaultBranch,
          `https://github.com/${owner}/${repo}`,
          encrypted,
          encrypted ? 1 : 0,
          ts,
          syncResult.latestCommitSha,
          JSON.stringify({
            recentCommits: syncResult.recentCommits,
            pullRequests: syncResult.pullRequests,
            warnings: syncResult.warnings,
          }),
          req.user!.id,
          ts,
          ts
        );

        db.prepare(
          `INSERT INTO repository_snapshots (id, project_id, connection_id, branch, commit_sha, file_count, artifact_count, summary_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?)`
        ).run(
          snapId,
          projectId,
          connId,
          branch,
          syncResult.latestCommitSha,
          syncResult.indexedFilesCount,
          syncResult.parsedArtifacts.length,
          ts
        );

        return persistArtifactsAndInferEdges(projectId, req.user!.id, snapId, syncResult.parsedArtifacts);
      });

      res.status(201).json({
        connectionId: connId,
        snapshotId: snapId,
        indexedFilesCount: syncResult.indexedFilesCount,
        ...counts,
        warnings: syncResult.warnings,
      });
    } catch (err) {
      next(err);
    }
  }
);

changeAndIntelRouter.post(
  '/repository/analyze-files',
  requireProjectPermission('repository:connect'),
  validateBody(
    z.object({
      files: z
        .array(
          z.object({
            filePath: z.string().trim().min(1).max(260),
            content: z.string().min(1).max(200_000),
          })
        )
        .min(1)
        .max(25),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const projectId = req.params.projectId;
    const { files } = req.body as { files: Array<{ filePath: string; content: string }> };
    const parsedAll = files.flatMap((f) => parseSourceFile(f.filePath, f.content));
    const snapId = uid('rsn');
    const ts = nowIso();

    const counts = runInTransaction(db, () => {
      db.prepare(
        `INSERT INTO repository_snapshots (id, project_id, branch, commit_sha, file_count, artifact_count, summary_json, created_at)
         VALUES (?, ?, 'workspace-upload', 'local-ast', ?, ?, '{"source":"manual_upload"}', ?)`
      ).run(snapId, projectId, files.length, parsedAll.length, ts);

      return persistArtifactsAndInferEdges(projectId, req.user!.id, snapId, parsedAll);
    });

    res.status(201).json({ snapshotId: snapId, fileCount: files.length, ...counts });
  }
);

changeAndIntelRouter.post(
  '/repository/artifacts/:artifactId/link-requirement',
  requireProjectPermission('repository:connect'),
  validateBody(z.object({ requirementId: z.string().min(1) })),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const art = db
        .prepare('SELECT id, linked_requirement_ids_json FROM repository_artifacts WHERE id = ? AND project_id = ?')
        .get(req.params.artifactId, req.params.projectId) as
        | { id: string; linked_requirement_ids_json: string }
        | undefined;
      if (!art) throw new HttpError(404, 'Artifact not found.');
      const { requirementId } = req.body as { requirementId: string };
      const current = new Set<string>(JSON.parse(art.linked_requirement_ids_json || '[]'));
      current.add(requirementId);
      db.prepare('UPDATE repository_artifacts SET linked_requirement_ids_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(Array.from(current)),
        nowIso(),
        art.id
      );
      res.json({ ok: true, linkedRequirementIds: Array.from(current) });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================
// TEST CASES & AI TEST GENERATOR
// ============================================

changeAndIntelRouter.get('/tests', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const tests = db
    .prepare(
      `SELECT tc.*, r.req_code as reqCode,
              (SELECT outcome FROM test_executions te WHERE te.test_case_id = tc.id ORDER BY te.executed_at DESC LIMIT 1) as lastOutcome
       FROM test_cases tc
       LEFT JOIN requirements r ON r.id = tc.requirement_id
       WHERE tc.project_id = ?
       ORDER BY tc.created_at DESC`
    )
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  res.json({
    testCases: tests.map((t) => ({
      id: t.id,
      tcCode: t.tc_code,
      requirementId: t.requirement_id,
      reqCode: t.reqCode,
      changeRequestId: t.change_request_id,
      title: t.title,
      testType: t.test_type,
      objective: t.objective,
      preconditions: t.preconditions,
      inputData: t.input_data,
      executionSteps: JSON.parse((t.execution_steps_json as string) || '[]'),
      expectedResult: t.expected_result,
      priority: t.priority,
      relatedArtifact: t.related_artifact,
      status: t.status,
      generatedBy: t.generated_by,
      lastOutcome: t.lastOutcome,
      createdAt: t.created_at,
    })),
  });
});

changeAndIntelRouter.post(
  '/tests/generate',
  requireProjectPermission('test:write'),
  validateBody(
    z.object({
      requirementId: z.string().min(1),
      changeRequestId: z.string().optional(),
    })
  ),
  async (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const projectId = req.params.projectId;
      const { requirementId, changeRequestId } = req.body as { requirementId: string; changeRequestId?: string };
      const reqRow = db
        .prepare('SELECT id, req_code, title, description, acceptance_criteria_json FROM requirements WHERE id = ? AND project_id = ?')
        .get(requirementId, projectId) as Record<string, unknown> | undefined;
      if (!reqRow) throw new HttpError(404, 'Requirement not found.');

      let affectedArtifacts: string[] = [];
      let changeContext = '';
      if (changeRequestId) {
        const cr = db
          .prepare('SELECT title, proposed_description FROM change_requests WHERE id = ? AND project_id = ?')
          .get(changeRequestId, projectId) as { title: string; proposed_description: string } | undefined;
        if (cr) changeContext = `${cr.title}: ${cr.proposed_description}`;
        const ia = db
          .prepare('SELECT id FROM impact_analyses WHERE change_request_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(changeRequestId) as { id: string } | undefined;
        if (ia) {
          const arts = db
            .prepare('SELECT artifact_name FROM impacted_artifacts WHERE impact_analysis_id = ?')
            .all(ia.id) as Array<{ artifact_name: string }>;
          affectedArtifacts = arts.map((a) => a.artifact_name);
        }
      }

      const generated = await generateTestCasesWithAi({
        projectId,
        userId: req.user!.id,
        requirement: {
          reqCode: reqRow.req_code as string,
          title: reqRow.title as string,
          description: reqRow.description as string,
          acceptanceCriteria: JSON.parse((reqRow.acceptance_criteria_json as string) || '[]'),
        },
        affectedArtifacts,
        changeContext,
      });

      const existingCount = (db.prepare('SELECT COUNT(*) as c FROM test_cases WHERE project_id = ?').get(projectId) as { c: number }).c;
      const prefix = (req.project!.key_prefix as string) || 'TC';
      const ts = nowIso();

      const createdIds = runInTransaction(db, () => {
        const ids: string[] = [];
        generated.testCases.forEach((tc, idx) => {
          const id = uid('tc');
          ids.push(id);
          const tcCode = `${prefix}-TC-${String(existingCount + idx + 1).padStart(3, '0')}`;
          db.prepare(
            `INSERT INTO test_cases
             (id, project_id, tc_code, requirement_id, change_request_id, title, test_type, objective, preconditions, input_data, execution_steps_json, expected_result, priority, related_artifact, status, generated_by, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, ?, ?, ?)`
          ).run(
            id,
            projectId,
            tcCode,
            requirementId,
            changeRequestId || null,
            tc.title,
            tc.testType,
            tc.objective,
            tc.preconditions || '',
            tc.inputData || '',
            JSON.stringify(tc.executionSteps || []),
            tc.expectedResult,
            ['low', 'medium', 'high', 'critical'].includes(tc.priority) ? tc.priority : 'medium',
            tc.relatedArtifact || '',
            generated.provider,
            req.user!.id,
            ts,
            ts
          );
        });
        return ids;
      });

      res.status(201).json({
        provider: generated.provider,
        generatedCount: createdIds.length,
        note: 'Generated test cases are marked as suggested until reviewed and executed by QA.',
      });
    } catch (err) {
      next(err);
    }
  }
);

changeAndIntelRouter.patch(
  '/tests/:testId',
  requireProjectPermission('test:write'),
  validateBody(z.object({ status: z.enum(['suggested', 'approved', 'deprecated']).optional(), title: z.string().optional() })),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body as { status?: string; title?: string };
    const row = db
      .prepare('SELECT status, title FROM test_cases WHERE id = ? AND project_id = ?')
      .get(req.params.testId, req.params.projectId) as { status: string; title: string } | undefined;
    if (!row) throw new HttpError(404, 'Test case not found.');
    db.prepare('UPDATE test_cases SET status = ?, title = ?, updated_at = ? WHERE id = ?').run(
      b.status ?? row.status,
      b.title ?? row.title,
      nowIso(),
      req.params.testId
    );
    res.json({ ok: true });
  }
);

changeAndIntelRouter.post(
  '/tests/:testId/execute',
  requireProjectPermission('test:execute'),
  validateBody(z.object({ outcome: z.enum(['passed', 'failed', 'blocked']), notes: z.string().max(1000).optional() })),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const { outcome, notes } = req.body as { outcome: string; notes?: string };
    const id = uid('tex');
    db.prepare(
      `INSERT INTO test_executions (id, project_id, test_case_id, outcome, notes, executed_by, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.projectId, req.params.testId, outcome, notes || '', req.user!.id, nowIso());
    res.status(201).json({ id, outcome });
  }
);

// ============================================
// HISTORICAL FAILURE INTELLIGENCE
// ============================================

changeAndIntelRouter.get('/history', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const changes = db
    .prepare('SELECT * FROM historical_changes WHERE project_id = ? ORDER BY created_at DESC')
    .all(req.params.projectId) as Array<Record<string, unknown>>;
  const incidents = db
    .prepare('SELECT * FROM incidents WHERE project_id = ? ORDER BY occurred_at DESC')
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  res.json({
    historicalChanges: changes.map((h) => ({
      id: h.id,
      title: h.title,
      originalRequirement: h.original_requirement,
      approvedChange: h.approved_change,
      affectedArtifacts: JSON.parse((h.affected_artifacts_json as string) || '[]'),
      actualImplementation: h.actual_implementation,
      testsPerformed: h.tests_performed,
      bugsDiscovered: JSON.parse((h.bugs_discovered_json as string) || '[]'),
      actualEffortHours: h.actual_effort_hours,
      estimatedEffortHours: h.estimated_effort_hours,
      resolution: h.resolution,
      lessonsLearned: h.lessons_learned,
      outcome: h.outcome,
      createdAt: h.created_at,
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      historicalChangeId: i.historical_change_id,
      title: i.title,
      severity: i.severity,
      rootCause: i.root_cause,
      affectedComponents: JSON.parse((i.affected_components_json as string) || '[]'),
      resolution: i.resolution,
      occurredAt: i.occurred_at,
    })),
  });
});

changeAndIntelRouter.post(
  '/incidents',
  requireProjectPermission('history:write'),
  validateBody(
    z.object({
      title: z.string().trim().min(3).max(200),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      rootCause: z.string().trim().min(5).max(1500),
      affectedComponents: z.array(z.string().trim()).min(1),
      resolution: z.string().trim().min(5).max(1500),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body as {
      title: string;
      severity: string;
      rootCause: string;
      affectedComponents: string[];
      resolution: string;
    };
    const id = uid('inc');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO incidents (id, project_id, title, severity, root_cause, affected_components_json, resolution, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.projectId, b.title, b.severity, b.rootCause, JSON.stringify(b.affectedComponents), b.resolution, ts, ts);
    res.status(201).json({ id, ...b, occurredAt: ts });
  }
);
