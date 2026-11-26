import { describe, it, expect } from 'vitest';
import {
  traverseImpactBfs,
  detectDependencyCycles,
  computeTopologicalOrder,
  simulateVirtualMutation,
  type GraphNode,
  type GraphEdge,
} from '../algorithms/graphEngine.ts';
import { analyzeRequirementDeterministic } from '../algorithms/requirementAnalyzer.ts';
import { parseSourceFile, inferHiddenDependencies, detectRequirementDrift } from '../algorithms/codeParser.ts';
import { runChangeImpactAnalysis } from '../algorithms/impactEngine.ts';

describe('Graph Engine Algorithms', () => {
  const nodes: GraphNode[] = [
    { id: 'n1', refId: 'r1', nodeType: 'requirement', name: 'REQ-1 Auth', criticality: 'critical' },
    { id: 'n2', refId: null, nodeType: 'source_file', name: 'auth.ts', criticality: 'high' },
    { id: 'n3', refId: null, nodeType: 'api_endpoint', name: 'POST /pay', criticality: 'critical' },
    { id: 'n4', refId: null, nodeType: 'db_collection', name: 'ledger', criticality: 'critical' },
  ];
  const edges: GraphEdge[] = [
    {
      id: 'e1',
      sourceNodeId: 'n2',
      targetNodeId: 'n1',
      relationshipType: 'implements',
      isInferred: false,
      verified: true,
      confidence: 1.0,
      evidence: 'spec',
    },
    {
      id: 'e2',
      sourceNodeId: 'n3',
      targetNodeId: 'n2',
      relationshipType: 'calls',
      isInferred: false,
      verified: true,
      confidence: 1.0,
      evidence: 'route middleware',
    },
    {
      id: 'e3',
      sourceNodeId: 'n3',
      targetNodeId: 'n4',
      relationshipType: 'writes_to',
      isInferred: true,
      verified: false,
      confidence: 0.78,
      evidence: 'AST SQL write',
    },
  ];

  it('discovers direct and indirect nodes with BFS and marks inferred paths properly', () => {
    const traversed = traverseImpactBfs(nodes, edges, ['n1'], 4);
    expect(traversed.length).toBe(3);
    const authFile = traversed.find((t) => t.node.id === 'n2');
    const ledger = traversed.find((t) => t.node.id === 'n4');
    expect(authFile?.hopDistance).toBe(1);
    expect(authFile?.tier).toBe('direct');
    expect(ledger?.hopDistance).toBe(3);
    expect(ledger?.hasInferredEdge).toBe(true);
    expect(ledger?.tier).toBe('potential');
  });

  it('detects dependency cycles using DFS and computes topological sort on DAG', () => {
    expect(detectDependencyCycles(nodes, edges)).toEqual([]);
    const cyclicEdges: GraphEdge[] = [
      ...edges,
      {
        id: 'e4',
        sourceNodeId: 'n1',
        targetNodeId: 'n3',
        relationshipType: 'depends_on',
        isInferred: false,
        verified: true,
        confidence: 1,
        evidence: 'cycle test',
      },
    ];
    const cycles = detectDependencyCycles(nodes, cyclicEdges);
    expect(cycles.length).toBe(1);

    const topo = computeTopologicalOrder(nodes, edges);
    expect(topo.hasCycles).toBe(false);
    expect(topo.order.length).toBe(4);
  });

  it('runs isolated What-If simulation without mutating original node/edge arrays', () => {
    const sim = simulateVirtualMutation(nodes, edges, [{ type: 'remove_node', nodeId: 'n2' }]);
    expect(nodes.length).toBe(4);
    expect(edges.length).toBe(3);
    expect(sim.simulatedMetrics.nodeCount).toBe(3);
    expect(sim.brokenEdgesCount).toBe(2);
    expect(sim.affectedNodes.length).toBeGreaterThan(0);
  });
});

describe('Requirement Intelligence Engine', () => {
  it('flags ambiguous terms, missing elements, and transparent quality deductions', () => {
    const res = analyzeRequirementDeterministic(
      {
        title: 'Fast Checkout',
        description: 'The checkout page should load quickly and be user-friendly.',
        acceptanceCriteria: [],
      },
      []
    );
    expect(res.ambiguities.length).toBeGreaterThanOrEqual(2);
    expect(res.missingElements.length).toBeGreaterThanOrEqual(2);
    expect(res.quality.totalScore).toBeLessThan(65);
    expect(res.quality.deductions.length).toBeGreaterThan(0);
  });

  it('detects session concurrency contradictions between requirements', () => {
    const res = analyzeRequirementDeterministic(
      {
        title: 'Single Session Enforcement',
        description: 'Only one active session is permitted per user account at any time.',
        acceptanceCriteria: ['Prior session invalidated on new login.'],
      },
      [
        {
          id: 'r_existing',
          reqCode: 'REQ-002',
          title: 'Multi-device Login',
          description: 'Users can access their accounts from multiple devices with concurrent sessions.',
          acceptanceCriteria: ['Up to 3 devices allowed.'],
        },
      ]
    );
    expect(res.conflicts.length).toBe(1);
    expect(res.conflicts[0].conflictType).toContain('Session Concurrency');
  });
});

describe('AST Code Parser & Drift Detection', () => {
  it('parses JS/TS routes, imports, and functions without executing code', () => {
    const code = `
      import { verifyJwt } from './auth';
      export function registerRoutes(app) {
        app.post('/api/orders', verifyJwt, (req, res) => {
          return res.json({ ok: true });
        });
      }
    `;
    const arts = parseSourceFile('src/orders.ts', code);
    expect(arts.some((a) => a.artifactType === 'api_route' && a.name === 'POST /api/orders')).toBe(true);
    expect(arts[0].imports).toContain('./auth');
  });

  it('infers hidden dependencies and detects missing implementations', () => {
    const inferred = inferHiddenDependencies(
      [
        {
          id: 'a1',
          name: 'orders.ts',
          filePath: 'src/orders.ts',
          artifactType: 'module',
          imports: ['./auth'],
          calls: ['verifyJwt'],
          routes: [{ method: 'POST', path: '/api/orders' }],
          models: ['orders_table'],
        },
        {
          id: 'a2',
          name: 'auth.ts',
          filePath: 'src/auth.ts',
          artifactType: 'module',
          imports: [],
          calls: [],
          routes: [],
          models: ['orders_table'],
        },
      ],
      []
    );
    expect(inferred.some((e) => e.relationshipType === 'imports')).toBe(true);
    expect(inferred.some((e) => e.relationshipType === 'reads_from')).toBe(true);

    const drift = detectRequirementDrift(
      [
        {
          id: 'r1',
          reqCode: 'REQ-1',
          title: 'Order Creation',
          description: 'Must create order',
          status: 'approved',
          acceptanceCriteria: [],
        },
      ],
      [],
      null
    );
    expect(drift.some((d) => d.driftType === 'missing_implementation')).toBe(true);
  });

  it('calculates explainable 10-step impact report', () => {
    const report = runChangeImpactAnalysis({
      changeCategory: 'Modification',
      originalTitle: 'Auth Gateway',
      originalDescription: 'Validate JWT token.',
      originalCriteria: ['HTTP 401 on missing token'],
      proposedTitle: 'Auth Gateway',
      proposedDescription: 'Enforce single active session and validate JWT token.',
      proposedCriteria: ['HTTP 401 on missing token', 'Invalidate previous session'],
      requirementId: 'r1',
      nodes: [
        { id: 'n1', refId: 'r1', nodeType: 'requirement', name: 'REQ-1 Auth', criticality: 'critical' },
        { id: 'n2', refId: null, nodeType: 'api_endpoint', name: 'POST /pay', criticality: 'critical' },
      ],
      edges: [
        {
          id: 'e1',
          sourceNodeId: 'n2',
          targetNodeId: 'n1',
          relationshipType: 'depends_on',
          isInferred: false,
          verified: true,
          confidence: 1,
          evidence: 'middleware',
        },
      ],
      otherRequirements: [],
      repositoryArtifacts: [],
      testCases: [],
      historicalIncidents: [],
    });
    expect(report.directCount).toBe(1);
    expect(report.impactScore).toBeGreaterThan(0);
    expect(report.effortEstimate.totalHours).toBeGreaterThan(0);
  });
});
