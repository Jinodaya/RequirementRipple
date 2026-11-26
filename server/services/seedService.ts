import { getDb, nowIso, runInTransaction, uid } from '../db/database.ts';
import { analyzeRequirementDeterministic } from '../algorithms/requirementAnalyzer.ts';
import { parseSourceFile } from '../algorithms/codeParser.ts';
import { runChangeImpactAnalysis } from '../algorithms/impactEngine.ts';
import { computeGraphMetrics } from '../algorithms/graphEngine.ts';

/**
 * Provisions a realistic, multi-module reference software engineering project ("FinPay Core Ledger")
 * for an authenticated user inside their active organization, so teams can explore real graph data,
 * AST artifacts, change impact reports, historical failures, and test suites immediately.
 */
export function provisionReferenceProject(organizationId: string, userId: string): { projectId: string; projectName: string } {
  const db = getDb();
  const ts = nowIso();

  return runInTransaction(db, () => {
    const projectId = uid('prj');
    db.prepare(
      `INSERT INTO projects (id, organization_id, key_prefix, name, description, tech_stack_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      projectId,
      organizationId,
      'FPY',
      'FinPay Core Ledger',
      'Multi-tenant payment settlement engine, identity authentication gateway, webhook dispatcher, and compliance audit ledger.',
      JSON.stringify(['TypeScript', 'Node.js', 'Express', 'React', 'PostgreSQL', 'Redis']),
      userId,
      ts,
      ts
    );

    const reqSpecs = [
      {
        code: 'FPY-REQ-001',
        title: 'JWT Session & Role-Based Gateway Verification',
        description:
          'All payment and ledger API endpoints must validate signed JWT access tokens and enforce organization role permissions server-side before processing.',
        category: 'Security',
        priority: 'critical',
        status: 'approved',
        criteria: [
          'Requests without a valid Authorization Bearer token receive HTTP 401 within 50ms.',
          'Users lacking required RBAC role receive HTTP 403 and an audit log entry is recorded.',
        ],
      },
      {
        code: 'FPY-REQ-002',
        title: 'Multi-Device Concurrent Session Support',
        description:
          'Authorized merchant administrators can maintain concurrent active sessions across up to 3 registered browser or mobile devices simultaneously.',
        category: 'Functional',
        priority: 'high',
        status: 'approved',
        criteria: [
          'Refresh token rotation tracks per-device session IDs independently.',
          'Revoking one device session does not terminate other active device sessions.',
        ],
      },
      {
        code: 'FPY-REQ-003',
        title: 'Idempotent Payment Settlement Execution',
        description:
          'The settlement endpoint POST /api/payments/settle must enforce an Idempotency-Key header so retried network requests never double-charge a customer.',
        category: 'Technical',
        priority: 'critical',
        status: 'approved',
        criteria: [
          'Duplicate POST /api/payments/settle calls with identical Idempotency-Key within 24 hours return the original HTTP 200 receipt.',
          'Concurrent settlement attempts serialize on the ledger_entries transaction lock.',
        ],
      },
      {
        code: 'FPY-REQ-004',
        title: 'Payment Checkout Response Latency SLA',
        description:
          'Payment authorization and checkout confirmation must complete within 350ms at p95 under 1,000 requests per minute.',
        category: 'Performance',
        priority: 'high',
        status: 'approved',
        criteria: [
          'p95 latency on POST /api/payments/settle remains <= 350ms in staging load tests.',
          'Database connection pool exhaustion triggers HTTP 503 within 1000ms.',
        ],
      },
      {
        code: 'FPY-REQ-005',
        title: 'Signed Outbound Webhook Dispatch',
        description:
          'Every settled or refunded transaction emits an HMAC-SHA256 signed webhook event to the merchant callback URL with exponential retry up to 5 attempts.',
        category: 'Functional',
        priority: 'high',
        status: 'approved',
        criteria: [
          'Webhook payload includes X-FinPay-Signature header computed with merchant secret.',
          'Failed deliveries retry at 10s, 30s, 90s, 300s, and 900s intervals.',
        ],
      },
      {
        code: 'FPY-REQ-006',
        title: 'Immutable 7-Year Financial Audit Trail',
        description:
          'All ledger balance mutations and settlement approvals must write append-only records to audit_ledger with actor ID, timestamp, and before/after hashes.',
        category: 'System Constraint',
        priority: 'critical',
        status: 'approved',
        criteria: [
          'No UPDATE or DELETE operations are permitted on audit_ledger rows.',
          'Exportable compliance report matches ledger balance totals to 0.00 variance.',
        ],
      },
    ];

    const reqIds: Record<string, string> = {};
    const existingForAnalysis: Array<{
      id: string;
      reqCode: string;
      title: string;
      description: string;
      acceptanceCriteria: string[];
    }> = [];

    for (const spec of reqSpecs) {
      const id = uid('req');
      reqIds[spec.code] = id;
      const analysis = analyzeRequirementDeterministic(
        {
          id,
          title: spec.title,
          description: spec.description,
          category: spec.category,
          acceptanceCriteria: spec.criteria,
        },
        existingForAnalysis
      );
      existingForAnalysis.push({
        id,
        reqCode: spec.code,
        title: spec.title,
        description: spec.description,
        acceptanceCriteria: spec.criteria,
      });

      db.prepare(
        `INSERT INTO requirements
         (id, project_id, req_code, title, description, category, priority, status, approval_status, acceptance_criteria_json, tags_json, author_id, assignee_id, version_number, quality_score, quality_breakdown_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(
        id,
        projectId,
        spec.code,
        spec.title,
        spec.description,
        spec.category,
        spec.priority,
        spec.status,
        JSON.stringify(spec.criteria),
        JSON.stringify([spec.category.toLowerCase(), 'core']),
        userId,
        userId,
        analysis.quality.totalScore,
        JSON.stringify(analysis.quality),
        ts,
        ts
      );

      db.prepare(
        `INSERT INTO requirement_versions
         (id, requirement_id, project_id, version_number, title, description, category, priority, status, acceptance_criteria_json, changed_by, change_summary, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'Initial approved baseline', ?)`
      ).run(
        uid('rv'),
        id,
        projectId,
        spec.title,
        spec.description,
        spec.category,
        spec.priority,
        spec.status,
        JSON.stringify(spec.criteria),
        userId,
        ts
      );
    }

    // Create Dependency Nodes across Requirements, Code Modules, APIs, DB Collections, External Services, and Tests
    const nodeDefs = [
      { key: 'req1', refId: reqIds['FPY-REQ-001'], type: 'requirement', name: 'FPY-REQ-001: JWT Gateway', crit: 'critical', x: 80, y: 80 },
      { key: 'req2', refId: reqIds['FPY-REQ-002'], type: 'requirement', name: 'FPY-REQ-002: Multi-Device Sessions', crit: 'high', x: 80, y: 210 },
      { key: 'req3', refId: reqIds['FPY-REQ-003'], type: 'requirement', name: 'FPY-REQ-003: Idempotent Settlement', crit: 'critical', x: 80, y: 340 },
      { key: 'req5', refId: reqIds['FPY-REQ-005'], type: 'requirement', name: 'FPY-REQ-005: Signed Webhooks', crit: 'high', x: 80, y: 470 },
      { key: 'modAuth', refId: null, type: 'source_file', name: 'src/middleware/authGateway.ts', crit: 'critical', x: 380, y: 120 },
      { key: 'modPay', refId: null, type: 'source_file', name: 'src/services/settlementService.ts', crit: 'critical', x: 380, y: 300 },
      { key: 'modHook', refId: null, type: 'source_file', name: 'src/services/webhookDispatcher.ts', crit: 'high', x: 380, y: 460 },
      { key: 'apiSettle', refId: null, type: 'api_endpoint', name: 'POST /api/payments/settle', crit: 'critical', x: 680, y: 220 },
      { key: 'apiSession', refId: null, type: 'api_endpoint', name: 'POST /api/auth/sessions', crit: 'high', x: 680, y: 80 },
      { key: 'dbLedger', refId: null, type: 'db_collection', name: 'ledger_entries', crit: 'critical', x: 960, y: 260 },
      { key: 'dbSessions', refId: null, type: 'db_collection', name: 'active_sessions', crit: 'high', x: 960, y: 100 },
      { key: 'extStripe', refId: null, type: 'external_service', name: 'Card Network Acquirer API', crit: 'critical', x: 960, y: 410 },
      { key: 'tcAuth', refId: null, type: 'test_case', name: 'TC-001: Auth Token & RBAC Rejection', crit: 'high', x: 680, y: 380 },
      { key: 'tcIdem', refId: null, type: 'test_case', name: 'TC-002: Idempotency Replay Guard', crit: 'critical', x: 680, y: 490 },
    ];

    const nodeIds: Record<string, string> = {};
    for (const nd of nodeDefs) {
      const id = uid('nod');
      nodeIds[nd.key] = id;
      db.prepare(
        `INSERT INTO dependency_nodes (id, project_id, ref_id, node_type, name, description, criticality, metadata_json, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, '{}', ?, ?, ?, ?)`
      ).run(id, projectId, nd.refId, nd.type, nd.name, nd.crit, nd.x, nd.y, ts, ts);
    }

    const edgeDefs = [
      { s: 'modAuth', t: 'req1', rel: 'implements', inf: 0, conf: 1.0, ev: 'Mapped in architecture spec' },
      { s: 'modAuth', t: 'req2', rel: 'implements', inf: 0, conf: 1.0, ev: 'Session store supports multi-device tokens' },
      { s: 'modPay', t: 'req3', rel: 'implements', inf: 0, conf: 1.0, ev: 'Idempotency key check in settlePayment()' },
      { s: 'modHook', t: 'req5', rel: 'implements', inf: 0, conf: 1.0, ev: 'HMAC signing in dispatchWebhook()' },
      { s: 'apiSession', t: 'modAuth', rel: 'calls', inf: 0, conf: 1.0, ev: 'Route handler delegates to authGateway' },
      { s: 'apiSettle', t: 'modAuth', rel: 'depends_on', inf: 0, conf: 1.0, ev: 'Express route middleware requireAuth()' },
      { s: 'apiSettle', t: 'modPay', rel: 'calls', inf: 0, conf: 1.0, ev: 'POST handler invokes settlePayment()' },
      { s: 'modPay', t: 'modHook', rel: 'calls', inf: 1, conf: 0.88, ev: 'AST call expression dispatchWebhook() inside settlementService.ts' },
      { s: 'modAuth', t: 'dbSessions', rel: 'writes_to', inf: 0, conf: 1.0, ev: 'Inserts/revokes device session rows' },
      { s: 'modPay', t: 'dbLedger', rel: 'writes_to', inf: 0, conf: 1.0, ev: 'Transactional insert into ledger_entries' },
      { s: 'modPay', t: 'extStripe', rel: 'calls', inf: 0, conf: 1.0, ev: 'Acquirer capture REST call' },
      { s: 'modHook', t: 'dbLedger', rel: 'reads_from', inf: 1, conf: 0.72, ev: 'Shared ledger_entries reference in webhook payload builder' },
      { s: 'tcAuth', t: 'req1', rel: 'tests', inf: 0, conf: 1.0, ev: 'Integration suite verifies 401/403' },
      { s: 'tcIdem', t: 'req3', rel: 'tests', inf: 0, conf: 1.0, ev: 'Concurrency replay test on POST /api/payments/settle' },
    ];

    for (const ed of edgeDefs) {
      db.prepare(
        `INSERT INTO dependency_edges (id, project_id, source_node_id, target_node_id, relationship_type, is_inferred, verified, confidence, evidence, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uid('edg'),
        projectId,
        nodeIds[ed.s],
        nodeIds[ed.t],
        ed.rel,
        ed.inf,
        ed.inf ? 0 : 1,
        ed.conf,
        ed.ev,
        userId,
        ts
      );
    }

    // Seed parsed repository source artifacts using real AST parser
    const sampleFiles = [
      {
        path: 'src/middleware/authGateway.ts',
        reqId: reqIds['FPY-REQ-001'],
        code: `import jwt from 'jsonwebtoken';
import { querySessionStore } from '../db/sessions';

export function requireAuth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const claims = jwt.verify(token, process.env.JWT_SECRET);
  return querySessionStore(claims.sub);
}`,
      },
      {
        path: 'src/services/settlementService.ts',
        reqId: reqIds['FPY-REQ-003'],
        code: `import { requireAuth } from '../middleware/authGateway';
import { dispatchWebhook } from './webhookDispatcher';

export function registerPaymentRoutes(app) {
  app.post('/api/payments/settle', requireAuth, async (req, res) => {
    const receipt = await settlePayment(req.body);
    await dispatchWebhook(receipt);
    res.json(receipt);
  });
}

export async function settlePayment(payload) {
  // INSERT INTO ledger_entries ...
  return { status: 'settled', idempotencyKey: payload.key };
}`,
      },
      {
        path: 'src/services/webhookDispatcher.ts',
        reqId: reqIds['FPY-REQ-005'],
        code: `import crypto from 'crypto';

export async function dispatchWebhook(receipt) {
  const signature = crypto.createHmac('sha256', 'secret').update(JSON.stringify(receipt)).digest('hex');
  return { signature, delivered: true };
}`,
      },
    ];

    const snapId = uid('rsn');
    db.prepare(
      `INSERT INTO repository_snapshots (id, project_id, branch, commit_sha, file_count, artifact_count, summary_json, created_at)
       VALUES (?, ?, 'main', 'a84f91c', ?, 0, '{"source":"reference_seed"}', ?)`
    ).run(snapId, projectId, sampleFiles.length, ts);

    let totalArts = 0;
    for (const file of sampleFiles) {
      const parsed = parseSourceFile(file.path, file.code);
      for (const art of parsed) {
        totalArts++;
        db.prepare(
          `INSERT INTO repository_artifacts
           (id, project_id, snapshot_id, file_path, language, artifact_type, name, signature, imports_json, calls_json, routes_json, models_json, linked_requirement_ids_json, content_hash, line_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          uid('art'),
          projectId,
          snapId,
          art.filePath,
          art.language,
          art.artifactType,
          art.name,
          art.signature,
          JSON.stringify(art.imports),
          JSON.stringify(art.calls),
          JSON.stringify(art.routes),
          JSON.stringify(art.models),
          JSON.stringify([file.reqId]),
          art.contentHash,
          art.lineCount,
          ts,
          ts
        );
      }
    }
    db.prepare('UPDATE repository_snapshots SET artifact_count = ? WHERE id = ?').run(totalArts, snapId);

    // Seed Historical Failure & Incident Intelligence
    const histId = uid('hst');
    db.prepare(
      `INSERT INTO historical_changes
       (id, project_id, title, original_requirement, approved_change, affected_artifacts_json, actual_implementation, tests_performed, bugs_discovered_json, actual_effort_hours, estimated_effort_hours, resolution, lessons_learned, outcome, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 26, 16, ?, ?, 'incident', ?)`
    ).run(
      histId,
      projectId,
      'JWT Claims Schema Refactor (Q1)',
      'JWT tokens carry userId and role fields.',
      'Renamed claim field userId to sub and enforced strict audience check.',
      JSON.stringify(['src/middleware/authGateway.ts', 'POST /api/payments/settle', 'src/services/settlementService.ts']),
      'Updated authGateway.ts without updating downstream webhook payload reader.',
      'Unit tests on authGateway passed; integration tests on webhookDispatcher were skipped.',
      JSON.stringify(['BUG-412: Null merchantId in outbound webhook signature check']),
      'Added backward-compatible claim normalization and integration contract tests.',
      'Changes to authGateway.ts propagate transitively to webhookDispatcher.ts; always run settlement + webhook regression tests.',
      ts
    );

    db.prepare(
      `INSERT INTO incidents (id, project_id, historical_change_id, title, severity, root_cause, affected_components_json, resolution, occurred_at, created_at)
       VALUES (?, ?, ?, ?, 'high', ?, ?, ?, ?, ?)`
    ).run(
      uid('inc'),
      projectId,
      histId,
      'Webhook Signature Failure Following Auth Claim Change',
      'authGateway.ts claim rename broke implicit user-ID extraction inside webhookDispatcher.ts.',
      JSON.stringify(['src/middleware/authGateway.ts', 'src/services/webhookDispatcher.ts', 'POST /api/payments/settle']),
      'Deployed hotfix restoring dual-claim fallback and added end-to-end integration test.',
      ts,
      ts
    );

    // Seed Test Cases
    const seededTests = [
      {
        code: 'FPY-TC-001',
        reqId: reqIds['FPY-REQ-001'],
        title: 'Reject missing JWT bearer token with HTTP 401',
        type: 'Security',
        obj: 'Ensure gateway rejects unauthenticated settlement calls.',
        steps: ['Send POST /api/payments/settle without Authorization header', 'Verify HTTP 401 response'],
        expected: 'HTTP 401 returned within 50ms.',
        priority: 'critical',
        art: 'src/middleware/authGateway.ts',
      },
      {
        code: 'FPY-TC-002',
        reqId: reqIds['FPY-REQ-003'],
        title: 'Idempotent replay returns cached receipt without duplicate ledger write',
        type: 'Integration',
        obj: 'Prevent double charging on network retry.',
        steps: ['Send POST /api/payments/settle with Idempotency-Key: k1', 'Repeat identical call within 5s', 'Query ledger_entries row count'],
        expected: 'Only 1 ledger_entries row created; second call returns identical receipt.',
        priority: 'critical',
        art: 'src/services/settlementService.ts',
      },
      {
        code: 'FPY-TC-003',
        reqId: reqIds['FPY-REQ-005'],
        title: 'Verify HMAC-SHA256 webhook signature header',
        type: 'Positive',
        obj: 'Ensure merchant webhook consumers can verify authenticity.',
        steps: ['Complete settlement', 'Inspect outbound HTTP headers on webhook payload'],
        expected: 'X-FinPay-Signature matches HMAC-SHA256 digest of raw body.',
        priority: 'high',
        art: 'src/services/webhookDispatcher.ts',
      },
    ];
    for (const tc of seededTests) {
      db.prepare(
        `INSERT INTO test_cases
         (id, project_id, tc_code, requirement_id, title, test_type, objective, preconditions, input_data, execution_steps_json, expected_result, priority, related_artifact, status, generated_by, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Clean staging database', 'Standard test payload', ?, ?, ?, ?, 'approved', 'manual', ?, ?, ?)`
      ).run(
        uid('tc'),
        projectId,
        tc.code,
        tc.reqId,
        tc.title,
        tc.type,
        tc.obj,
        JSON.stringify(tc.steps),
        tc.expected,
        tc.priority,
        tc.art,
        userId,
        ts,
        ts
      );
    }

    // Seed 1 pending Change Request with full 10-step Impact Analysis (including a deliberate conflict with FPY-REQ-002!)
    const crId = uid('cr');
    const crTitle = 'Restrict Merchant Accounts to Single Active Session';
    const crDesc =
      'Modify authentication gateway so only one active session is permitted per user account, invalidating prior tokens on new login.';
    const crCriteria = [
      'New login revokes any existing rows in active_sessions for the user.',
      'Previous device receives HTTP 401 on subsequent API request.',
    ];

    db.prepare(
      `INSERT INTO change_requests
       (id, project_id, cr_code, requirement_id, change_category, title, reason, original_snapshot_json, proposed_title, proposed_description, proposed_acceptance_criteria_json, priority, status, approval_status, analysis_status, requester_id, created_at, updated_at)
       VALUES (?, ?, 'FPY-CR-001', ?, 'Modification', ?, ?, ?, ?, ?, ?, 'high', 'in_review', 'pending', 'completed', ?, ?, ?)`
    ).run(
      crId,
      projectId,
      reqIds['FPY-REQ-001'],
      crTitle,
      'Enterprise security audit requested stricter session hijacking mitigation.',
      JSON.stringify({
        reqCode: 'FPY-REQ-001',
        title: reqSpecs[0].title,
        description: reqSpecs[0].description,
        acceptanceCriteria: reqSpecs[0].criteria,
      }),
      crTitle,
      crDesc,
      JSON.stringify(crCriteria),
      userId,
      ts,
      ts
    );

    const dbNodes = db
      .prepare('SELECT id, ref_id as refId, node_type as nodeType, name, criticality FROM dependency_nodes WHERE project_id = ?')
      .all(projectId) as Array<{ id: string; refId: string | null; nodeType: string; name: string; criticality: string }>;
    const dbEdges = db
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

    const impactReport = runChangeImpactAnalysis({
      changeCategory: 'Modification',
      originalTitle: reqSpecs[0].title,
      originalDescription: reqSpecs[0].description,
      originalCriteria: reqSpecs[0].criteria,
      proposedTitle: crTitle,
      proposedDescription: crDesc,
      proposedCriteria: crCriteria,
      requirementId: reqIds['FPY-REQ-001'],
      nodes: dbNodes,
      edges: dbEdges.map((e) => ({
        ...e,
        isInferred: Boolean(e.isInferred),
        verified: Boolean(e.verified),
      })),
      otherRequirements: existingForAnalysis,
      repositoryArtifacts: [],
      testCases: seededTests.map((t) => ({ id: t.code, tcCode: t.code, title: t.title, requirementId: t.reqId })),
      historicalIncidents: [
        {
          id: 'inc_1',
          title: 'Webhook Signature Failure Following Auth Claim Change',
          severity: 'high',
          affectedComponents: ['src/middleware/authGateway.ts', 'src/services/webhookDispatcher.ts'],
        },
      ],
    });

    const iaId = uid('ia');
    db.prepare(
      `INSERT INTO impact_analyses
       (id, project_id, change_request_id, semantic_diff_json, direct_count, indirect_count, potential_count, uncertain_count, total_blast_radius, impact_score, risk_level, confidence, recommendation, explanation, conflicts_json, missing_dependencies_json, effort_estimate_json, scoring_breakdown_json, ai_provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deterministic', ?)`
    ).run(
      iaId,
      projectId,
      crId,
      JSON.stringify(impactReport.semanticDiff),
      impactReport.directCount,
      impactReport.indirectCount,
      impactReport.potentialCount,
      impactReport.uncertainCount,
      impactReport.totalBlastRadius,
      impactReport.impactScore,
      impactReport.riskLevel,
      impactReport.confidence,
      impactReport.recommendation,
      impactReport.explanation,
      JSON.stringify(impactReport.conflicts),
      JSON.stringify(impactReport.missingDependencies),
      JSON.stringify(impactReport.effortEstimate),
      JSON.stringify(impactReport.scoringBreakdown),
      ts
    );

    for (const item of impactReport.impactedArtifacts) {
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

    // Create initial Digital Twin Snapshot
    const metrics = computeGraphMetrics(
      dbNodes,
      dbEdges.map((e) => ({ ...e, isInferred: Boolean(e.isInferred), verified: Boolean(e.verified) }))
    );
    db.prepare(
      `INSERT INTO graph_snapshots (id, project_id, label, description, nodes_json, edges_json, metrics_json, repo_sync_status, created_by, created_at)
       VALUES (?, ?, 'v1.0-baseline', 'Initial synchronized baseline digital twin of FinPay Core Ledger.', ?, ?, ?, 'synchronized', ?, ?)`
    ).run(uid('gsn'), projectId, JSON.stringify(dbNodes), JSON.stringify(dbEdges), JSON.stringify(metrics), userId, ts);

    return { projectId, projectName: 'FinPay Core Ledger' };
  });
}
