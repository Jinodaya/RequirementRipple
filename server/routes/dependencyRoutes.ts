import { Router } from 'express';
import { z } from 'zod';
import { getDb, nowIso, uid } from '../db/database.ts';
import {
  HttpError,
  requireAuth,
  requireProjectPermission,
  validateBody,
  type AuthedRequest,
} from '../middleware/authMiddleware.ts';
import {
  computeGraphMetrics,
  computeTopologicalOrder,
  simulateVirtualMutation,
  traverseImpactBfs,
} from '../algorithms/graphEngine.ts';
import { recordAuditLog } from '../services/auditService.ts';

export const dependencyRouter = Router({ mergeParams: true });
dependencyRouter.use(requireAuth);

function loadProjectGraph(projectId: string) {
  const db = getDb();
  const nodes = db
    .prepare(
      `SELECT id, ref_id as refId, node_type as nodeType, name, description, criticality, metadata_json as metadataJson, position_x as positionX, position_y as positionY
       FROM dependency_nodes WHERE project_id = ? ORDER BY created_at ASC`
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const edges = db
    .prepare(
      `SELECT id, source_node_id as sourceNodeId, target_node_id as targetNodeId, relationship_type as relationshipType, is_inferred as isInferred, verified, confidence, evidence, created_at as createdAt
       FROM dependency_edges WHERE project_id = ? ORDER BY created_at ASC`
    )
    .all(projectId) as Array<Record<string, unknown>>;

  return {
    nodes: nodes.map((n) => ({
      id: n.id as string,
      refId: (n.refId as string) || null,
      nodeType: n.nodeType as string,
      name: n.name as string,
      description: (n.description as string) || '',
      criticality: (n.criticality as string) || 'medium',
      metadata: JSON.parse((n.metadataJson as string) || '{}'),
      positionX: Number(n.positionX || 0),
      positionY: Number(n.positionY || 0),
    })),
    edges: edges.map((e) => ({
      id: e.id as string,
      sourceNodeId: e.sourceNodeId as string,
      targetNodeId: e.targetNodeId as string,
      relationshipType: e.relationshipType as string,
      isInferred: Boolean(e.isInferred),
      verified: Boolean(e.verified),
      confidence: Number(e.confidence),
      evidence: (e.evidence as string) || '',
      createdAt: e.createdAt as string,
    })),
  };
}

dependencyRouter.get('/graph', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const { nodes, edges } = loadProjectGraph(req.params.projectId);
  const metrics = computeGraphMetrics(nodes, edges);
  const topo = computeTopologicalOrder(nodes, edges);
  res.json({ nodes, edges, metrics, implementationOrder: topo.order.map((n) => n.name), hasCycles: topo.hasCycles });
});

dependencyRouter.post(
  '/graph/nodes',
  requireProjectPermission('dependency:write'),
  validateBody(
    z.object({
      nodeType: z.enum([
        'requirement',
        'module',
        'source_file',
        'function',
        'api_endpoint',
        'db_collection',
        'db_field',
        'test_case',
        'external_service',
        'technical_decision',
      ]),
      name: z.string().trim().min(2).max(150),
      description: z.string().trim().max(500).optional(),
      criticality: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body as {
      nodeType: string;
      name: string;
      description?: string;
      criticality: string;
      positionX?: number;
      positionY?: number;
    };
    const id = uid('nod');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO dependency_nodes (id, project_id, node_type, name, description, criticality, metadata_json, position_x, position_y, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`
    ).run(id, req.params.projectId, b.nodeType, b.name, b.description || '', b.criticality, b.positionX ?? 240, b.positionY ?? 180, ts, ts);
    res.status(201).json({ id, ...b });
  }
);

dependencyRouter.patch(
  '/graph/nodes/:nodeId',
  requireProjectPermission('dependency:write'),
  validateBody(
    z.object({
      criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
      name: z.string().trim().min(2).max(150).optional(),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body as { criticality?: string; positionX?: number; positionY?: number; name?: string };
    const row = db
      .prepare('SELECT * FROM dependency_nodes WHERE id = ? AND project_id = ?')
      .get(req.params.nodeId, req.params.projectId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, 'Node not found.');

    db.prepare(
      'UPDATE dependency_nodes SET name = ?, criticality = ?, position_x = ?, position_y = ?, updated_at = ? WHERE id = ?'
    ).run(
      b.name ?? (row.name as string),
      b.criticality ?? (row.criticality as string),
      b.positionX ?? Number(row.position_x),
      b.positionY ?? Number(row.position_y),
      nowIso(),
      req.params.nodeId
    );
    res.json({ ok: true });
  }
);

dependencyRouter.delete('/graph/nodes/:nodeId', requireProjectPermission('dependency:write'), (req: AuthedRequest, res) => {
  const db = getDb();
  db.prepare('DELETE FROM dependency_nodes WHERE id = ? AND project_id = ?').run(
    req.params.nodeId,
    req.params.projectId
  );
  res.json({ ok: true });
});

dependencyRouter.post(
  '/graph/edges',
  requireProjectPermission('dependency:write'),
  validateBody(
    z.object({
      sourceNodeId: z.string().min(1),
      targetNodeId: z.string().min(1),
      relationshipType: z.enum([
        'depends_on',
        'implements',
        'calls',
        'reads_from',
        'writes_to',
        'tests',
        'conflicts_with',
        'replaces',
        'related_to',
      ]),
      isInferred: z.boolean().default(false),
      confidence: z.number().min(0.1).max(1).default(1),
      evidence: z.string().trim().max(400).default('Explicitly documented relationship'),
    })
  ),
  (req: AuthedRequest, res, next) => {
    try {
      const db = getDb();
      const b = req.body as {
        sourceNodeId: string;
        targetNodeId: string;
        relationshipType: string;
        isInferred: boolean;
        confidence: number;
        evidence: string;
      };
      if (b.sourceNodeId === b.targetNodeId) {
        throw new HttpError(400, 'Self-referencing dependency edges are not permitted.');
      }
      const src = db
        .prepare('SELECT id FROM dependency_nodes WHERE id = ? AND project_id = ?')
        .get(b.sourceNodeId, req.params.projectId);
      const tgt = db
        .prepare('SELECT id FROM dependency_nodes WHERE id = ? AND project_id = ?')
        .get(b.targetNodeId, req.params.projectId);
      if (!src || !tgt) {
        throw new HttpError(400, 'Source and target nodes must exist inside this project.');
      }

      const id = uid('edg');
      const ts = nowIso();
      db.prepare(
        `INSERT INTO dependency_edges (id, project_id, source_node_id, target_node_id, relationship_type, is_inferred, verified, confidence, evidence, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.params.projectId,
        b.sourceNodeId,
        b.targetNodeId,
        b.relationshipType,
        b.isInferred ? 1 : 0,
        b.isInferred ? 0 : 1,
        b.confidence,
        b.evidence,
        req.user!.id,
        ts
      );
      res.status(201).json({ id, ...b, verified: !b.isInferred });
    } catch (err) {
      next(err);
    }
  }
);

dependencyRouter.patch(
  '/graph/edges/:edgeId/verify',
  requireProjectPermission('dependency:write'),
  validateBody(z.object({ verified: z.boolean() })),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const { verified } = req.body as { verified: boolean };
    db.prepare(
      'UPDATE dependency_edges SET verified = ?, is_inferred = ?, confidence = ? WHERE id = ? AND project_id = ?'
    ).run(verified ? 1 : 0, verified ? 0 : 1, verified ? 1.0 : 0.7, req.params.edgeId, req.params.projectId);
    res.json({ ok: true, verified });
  }
);

dependencyRouter.delete('/graph/edges/:edgeId', requireProjectPermission('dependency:write'), (req: AuthedRequest, res) => {
  const db = getDb();
  db.prepare('DELETE FROM dependency_edges WHERE id = ? AND project_id = ?').run(
    req.params.edgeId,
    req.params.projectId
  );
  res.json({ ok: true });
});

dependencyRouter.post(
  '/graph/traverse',
  requireProjectPermission('read'),
  validateBody(z.object({ startNodeId: z.string(), maxDepth: z.number().int().min(1).max(6).default(4) })),
  (req: AuthedRequest, res) => {
    const { startNodeId, maxDepth } = req.body as { startNodeId: string; maxDepth: number };
    const { nodes, edges } = loadProjectGraph(req.params.projectId);
    const traversed = traverseImpactBfs(nodes, edges, [startNodeId], maxDepth);
    res.json({
      startNodeId,
      maxDepth,
      impactedNodes: traversed.map((t) => ({
        nodeId: t.node.id,
        name: t.node.name,
        nodeType: t.node.nodeType,
        hopDistance: t.hopDistance,
        tier: t.tier,
        path: t.path,
        confidence: t.minConfidence,
        hasInferredEdge: t.hasInferredEdge,
      })),
    });
  }
);

// Digital Twin Snapshots
dependencyRouter.get('/digital-twin/snapshots', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT gs.*, u.name as createdByName
       FROM graph_snapshots gs
       LEFT JOIN users u ON u.id = gs.created_by
       WHERE gs.project_id = ?
       ORDER BY gs.created_at DESC`
    )
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  res.json({
    snapshots: rows.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      nodes: JSON.parse((s.nodes_json as string) || '[]'),
      edges: JSON.parse((s.edges_json as string) || '[]'),
      metrics: JSON.parse((s.metrics_json as string) || '{}'),
      repoSyncStatus: s.repo_sync_status,
      createdByName: s.createdByName,
      createdAt: s.created_at,
    })),
  });
});

dependencyRouter.post(
  '/digital-twin/snapshots',
  requireProjectPermission('dependency:write'),
  validateBody(z.object({ label: z.string().trim().min(2).max(80), description: z.string().trim().max(400).optional() })),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const { label, description } = req.body as { label: string; description?: string };
    const { nodes, edges } = loadProjectGraph(req.params.projectId);
    const metrics = computeGraphMetrics(nodes, edges);
    const latestRepo = db
      .prepare('SELECT created_at FROM repository_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(req.params.projectId) as { created_at: string } | undefined;

    const repoSyncStatus = !latestRepo
      ? 'no_repository_indexed'
      : Date.now() - new Date(latestRepo.created_at).getTime() > 72 * 3600 * 1000
      ? 'stale_repository'
      : 'synchronized';

    const id = uid('gsn');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO graph_snapshots (id, project_id, label, description, nodes_json, edges_json, metrics_json, repo_sync_status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.projectId, label, description || '', JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify(metrics), repoSyncStatus, req.user!.id, ts);

    res.status(201).json({ id, label, metrics, repoSyncStatus, createdAt: ts });
  }
);

// What-If Scenario Simulator (NEVER mutates real project graph!)
dependencyRouter.get('/scenarios', requireProjectPermission('read'), (req: AuthedRequest, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.*, u.name as createdByName
       FROM scenarios s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.project_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  res.json({
    scenarios: rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      mutations: JSON.parse((s.mutations_json as string) || '[]'),
      baselineMetrics: JSON.parse((s.baseline_metrics_json as string) || '{}'),
      simulatedMetrics: JSON.parse((s.simulated_metrics_json as string) || '{}'),
      affectedNodes: JSON.parse((s.affected_nodes_json as string) || '[]'),
      riskDelta: s.risk_delta,
      reportSummary: s.report_summary,
      createdByName: s.createdByName,
      createdAt: s.created_at,
    })),
  });
});

dependencyRouter.post(
  '/scenarios',
  requireProjectPermission('scenario:simulate'),
  validateBody(
    z.object({
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(500).optional(),
      mutations: z
        .array(
          z.object({
            type: z.enum(['remove_node', 'modify_node', 'add_edge', 'remove_edge']),
            nodeId: z.string().optional(),
            edgeId: z.string().optional(),
            sourceNodeId: z.string().optional(),
            targetNodeId: z.string().optional(),
            relationshipType: z.string().optional(),
            newCriticality: z.string().optional(),
          })
        )
        .min(1),
    })
  ),
  (req: AuthedRequest, res) => {
    const db = getDb();
    const b = req.body as {
      name: string;
      description?: string;
      mutations: Parameters<typeof simulateVirtualMutation>[2];
    };
    const { nodes, edges } = loadProjectGraph(req.params.projectId);
    const simResult = simulateVirtualMutation(nodes, edges, b.mutations);

    const id = uid('scn');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO scenarios
       (id, project_id, name, description, mutations_json, baseline_metrics_json, simulated_metrics_json, affected_nodes_json, risk_delta, report_summary, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.params.projectId,
      b.name,
      b.description || '',
      JSON.stringify(b.mutations),
      JSON.stringify(simResult.baselineMetrics),
      JSON.stringify(simResult.simulatedMetrics),
      JSON.stringify(simResult.affectedNodes),
      simResult.riskDelta,
      simResult.reportSummary,
      req.user!.id,
      ts,
      ts
    );

    recordAuditLog({
      organizationId: req.organizationId,
      projectId: req.params.projectId,
      actorId: req.user!.id,
      action: 'scenario.simulated',
      entityType: 'scenario',
      entityId: id,
      details: { name: b.name, riskDelta: simResult.riskDelta },
    });

    res.status(201).json({
      scenario: {
        id,
        name: b.name,
        description: b.description || '',
        mutations: b.mutations,
        ...simResult,
        createdAt: ts,
      },
    });
  }
);

dependencyRouter.delete('/scenarios/:scenarioId', requireProjectPermission('scenario:simulate'), (req: AuthedRequest, res) => {
  const db = getDb();
  db.prepare('DELETE FROM scenarios WHERE id = ? AND project_id = ?').run(
    req.params.scenarioId,
    req.params.projectId
  );
  res.json({ ok: true });
});
