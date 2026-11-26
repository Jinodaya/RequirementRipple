export interface GraphNode {
  id: string;
  refId?: string | null;
  nodeType: string;
  name: string;
  criticality: 'low' | 'medium' | 'high' | 'critical' | string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: string;
  isInferred: boolean;
  verified: boolean;
  confidence: number;
  evidence: string;
}

export interface TraversedNode {
  node: GraphNode;
  hopDistance: number;
  tier: 'direct' | 'indirect' | 'potential' | 'uncertain';
  path: string[];
  pathEdges: GraphEdge[];
  minConfidence: number;
  hasInferredEdge: boolean;
}

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  inferredEdgeCount: number;
  verifiedEdgeCount: number;
  density: number;
  cycleCount: number;
  cycles: string[][];
  maxDepth: number;
  topHubs: Array<{
    nodeId: string;
    name: string;
    nodeType: string;
    inDegree: number;
    outDegree: number;
    reachabilityCount: number;
    centralityScore: number;
  }>;
}

export function buildAdjacency(nodes: GraphNode[], edges: GraphEdge[]) {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    if (nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId)) {
      outgoing.get(e.sourceNodeId)!.push(e);
      incoming.get(e.targetNodeId)!.push(e);
    }
  }
  return { nodeMap, outgoing, incoming };
}

/**
 * Breadth-First Search (BFS) across both outgoing dependencies and incoming dependents
 * to find every directly and indirectly impacted node from a set of seed nodes.
 */
export function traverseImpactBfs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  startNodeIds: string[],
  maxDepth = 5
): TraversedNode[] {
  const { nodeMap, outgoing, incoming } = buildAdjacency(nodes, edges);
  const visited = new Map<string, TraversedNode>();
  const queue: Array<{
    nodeId: string;
    depth: number;
    path: string[];
    pathEdges: GraphEdge[];
    minConfidence: number;
    hasInferred: boolean;
  }> = [];

  for (const startId of startNodeIds) {
    if (!nodeMap.has(startId)) continue;
    visited.set(startId, {
      node: nodeMap.get(startId)!,
      hopDistance: 0,
      tier: 'direct',
      path: [nodeMap.get(startId)!.name],
      pathEdges: [],
      minConfidence: 1.0,
      hasInferredEdge: false,
    });
    queue.push({
      nodeId: startId,
      depth: 0,
      path: [nodeMap.get(startId)!.name],
      pathEdges: [],
      minConfidence: 1.0,
      hasInferred: false,
    });
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    // Traverse downstream dependents (incoming edges: who depends on current)
    // and upstream targets (outgoing edges: what current implements/calls/writes)
    const connected: Array<{ nextId: string; edge: GraphEdge }> = [
      ...(outgoing.get(current.nodeId) || []).map((edge) => ({ nextId: edge.targetNodeId, edge })),
      ...(incoming.get(current.nodeId) || []).map((edge) => ({ nextId: edge.sourceNodeId, edge })),
    ];

    for (const { nextId, edge } of connected) {
      const nextNode = nodeMap.get(nextId);
      if (!nextNode) continue;

      const nextDepth = current.depth + 1;
      const nextConfidence = Math.min(current.minConfidence, edge.confidence);
      const nextInferred = current.hasInferred || edge.isInferred;

      let tier: TraversedNode['tier'];
      if (nextDepth === 1 && !nextInferred && nextConfidence >= 0.8) {
        tier = 'direct';
      } else if (nextInferred && nextConfidence < 0.6) {
        tier = 'uncertain';
      } else if (nextInferred) {
        tier = 'potential';
      } else {
        tier = 'indirect';
      }

      const existing = visited.get(nextId);
      if (!existing || nextDepth < existing.hopDistance) {
        const entry: TraversedNode = {
          node: nextNode,
          hopDistance: nextDepth,
          tier,
          path: [...current.path, nextNode.name],
          pathEdges: [...current.pathEdges, edge],
          minConfidence: Number(nextConfidence.toFixed(2)),
          hasInferredEdge: nextInferred,
        };
        visited.set(nextId, entry);
        queue.push({
          nodeId: nextId,
          depth: nextDepth,
          path: entry.path,
          pathEdges: entry.pathEdges,
          minConfidence: nextConfidence,
          hasInferred: nextInferred,
        });
      }
    }
  }

  return Array.from(visited.values()).filter((t) => t.hopDistance > 0);
}

/**
 * Depth-First Search (DFS) cycle detection on directed dependency edges.
 */
export function detectDependencyCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const { nodeMap, outgoing } = buildAdjacency(nodes, edges);
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited, 1=visiting, 2=done
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenSignatures = new Set<string>();

  function dfs(nodeId: string) {
    state.set(nodeId, 1);
    stack.push(nodeId);

    for (const edge of outgoing.get(nodeId) || []) {
      const target = edge.targetNodeId;
      const targetState = state.get(target) || 0;
      if (targetState === 1) {
        const idx = stack.indexOf(target);
        if (idx !== -1) {
          const cycleIds = [...stack.slice(idx), target];
          const sig = [...cycleIds].sort().join('|');
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            cycles.push(cycleIds.map((id) => nodeMap.get(id)?.name || id));
          }
        }
      } else if (targetState === 0) {
        dfs(target);
      }
    }

    stack.pop();
    state.set(nodeId, 2);
  }

  for (const n of nodes) {
    if ((state.get(n.id) || 0) === 0) {
      dfs(n.id);
    }
  }
  return cycles;
}

/**
 * Kahn's Topological Sort for safe implementation ordering on acyclic dependencies.
 */
export function computeTopologicalOrder(
  nodes: GraphNode[],
  edges: GraphEdge[]
): { order: GraphNode[]; hasCycles: boolean } {
  const { nodeMap, outgoing } = buildAdjacency(nodes, edges);
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, 0);
  for (const e of edges) {
    if (nodeMap.has(e.sourceNodeId) && nodeMap.has(e.targetNodeId)) {
      inDegree.set(e.targetNodeId, (inDegree.get(e.targetNodeId) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const order: GraphNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) order.push(node);
    for (const edge of outgoing.get(id) || []) {
      const nextDeg = (inDegree.get(edge.targetNodeId) || 0) - 1;
      inDegree.set(edge.targetNodeId, nextDeg);
      if (nextDeg === 0) queue.push(edge.targetNodeId);
    }
  }

  return {
    order,
    hasCycles: order.length < nodes.length,
  };
}

export function computeGraphMetrics(nodes: GraphNode[], edges: GraphEdge[]): GraphMetrics {
  const { outgoing, incoming } = buildAdjacency(nodes, edges);
  const cycles = detectDependencyCycles(nodes, edges);

  let maxDepth = 0;
  const topHubs = nodes.map((node) => {
    const inDeg = (incoming.get(node.id) || []).length;
    const outDeg = (outgoing.get(node.id) || []).length;
    const traversed = traverseImpactBfs(nodes, edges, [node.id], 6);
    const deepest = traversed.reduce((acc, item) => Math.max(acc, item.hopDistance), 0);
    if (deepest > maxDepth) maxDepth = deepest;

    const critWeight =
      node.criticality === 'critical' ? 1.5 : node.criticality === 'high' ? 1.25 : 1.0;
    const centralityScore = Number(
      (((inDeg * 1.4 + outDeg + traversed.length * 0.6) * critWeight) / Math.max(1, nodes.length)).toFixed(2)
    );

    return {
      nodeId: node.id,
      name: node.name,
      nodeType: node.nodeType,
      inDegree: inDeg,
      outDegree: outDeg,
      reachabilityCount: traversed.length,
      centralityScore,
    };
  });

  topHubs.sort((a, b) => b.centralityScore - a.centralityScore);

  const n = nodes.length;
  const maxPossibleEdges = n > 1 ? n * (n - 1) : 1;
  const inferredEdgeCount = edges.filter((e) => e.isInferred).length;

  return {
    nodeCount: n,
    edgeCount: edges.length,
    inferredEdgeCount,
    verifiedEdgeCount: edges.length - inferredEdgeCount,
    density: Number((edges.length / maxPossibleEdges).toFixed(3)),
    cycleCount: cycles.length,
    cycles,
    maxDepth,
    topHubs: topHubs.slice(0, 8),
  };
}

export interface VirtualMutation {
  type: 'remove_node' | 'modify_node' | 'add_edge' | 'remove_edge';
  nodeId?: string;
  edgeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  relationshipType?: string;
  newCriticality?: string;
}

export interface SimulationResult {
  baselineMetrics: GraphMetrics;
  simulatedMetrics: GraphMetrics;
  affectedNodes: Array<{
    nodeId: string;
    name: string;
    nodeType: string;
    hopDistance: number;
    impactTier: string;
    reason: string;
    confidence: number;
  }>;
  orphanedNodes: string[];
  brokenEdgesCount: number;
  riskDelta: number;
  reportSummary: string;
}

/**
 * Isolated What-If Simulation: clones nodes and edges into a temporary virtual graph,
 * never altering the real project graph in the database.
 */
export function simulateVirtualMutation(
  baseNodes: GraphNode[],
  baseEdges: GraphEdge[],
  mutations: VirtualMutation[]
): SimulationResult {
  const baselineMetrics = computeGraphMetrics(baseNodes, baseEdges);

  let virtualNodes = baseNodes.map((n) => ({ ...n }));
  let virtualEdges = baseEdges.map((e) => ({ ...e }));

  const seedNodeIds: string[] = [];
  const mutationNotes: string[] = [];
  let brokenEdgesCount = 0;

  for (const m of mutations) {
    if (m.type === 'remove_node' && m.nodeId) {
      const target = virtualNodes.find((n) => n.id === m.nodeId);
      if (target) {
        seedNodeIds.push(target.id);
        mutationNotes.push(`Simulated removal of "${target.name}" (${target.nodeType})`);
        const connectedEdges = virtualEdges.filter(
          (e) => e.sourceNodeId === m.nodeId || e.targetNodeId === m.nodeId
        );
        brokenEdgesCount += connectedEdges.length;
      }
    } else if (m.type === 'modify_node' && m.nodeId) {
      const target = virtualNodes.find((n) => n.id === m.nodeId);
      if (target) {
        seedNodeIds.push(target.id);
        if (m.newCriticality) target.criticality = m.newCriticality;
        mutationNotes.push(`Simulated modification of "${target.name}"`);
      }
    } else if (m.type === 'add_edge' && m.sourceNodeId && m.targetNodeId) {
      virtualEdges.push({
        id: `virtual_edge_${virtualEdges.length + 1}`,
        sourceNodeId: m.sourceNodeId,
        targetNodeId: m.targetNodeId,
        relationshipType: m.relationshipType || 'depends_on',
        isInferred: false,
        verified: true,
        confidence: 1.0,
        evidence: 'Hypothetical scenario edge',
      });
      seedNodeIds.push(m.sourceNodeId);
      mutationNotes.push(`Simulated new edge (${m.relationshipType || 'depends_on'})`);
    } else if (m.type === 'remove_edge' && m.edgeId) {
      const edge = virtualEdges.find((e) => e.id === m.edgeId);
      if (edge) {
        seedNodeIds.push(edge.sourceNodeId);
        seedNodeIds.push(edge.targetNodeId);
        brokenEdgesCount += 1;
        virtualEdges = virtualEdges.filter((e) => e.id !== m.edgeId);
        mutationNotes.push(`Simulated removal of dependency edge`);
      }
    }
  }

  // Traverse impact on baseline before deleting removed nodes so downstream dependents are captured
  const impacted = traverseImpactBfs(baseNodes, baseEdges, seedNodeIds, 5);

  const removedIds = new Set(
    mutations.filter((m) => m.type === 'remove_node' && m.nodeId).map((m) => m.nodeId!)
  );
  virtualNodes = virtualNodes.filter((n) => !removedIds.has(n.id));
  virtualEdges = virtualEdges.filter(
    (e) => !removedIds.has(e.sourceNodeId) && !removedIds.has(e.targetNodeId)
  );

  const simulatedMetrics = computeGraphMetrics(virtualNodes, virtualEdges);

  // Detect nodes orphaned by removals
  const connectedIds = new Set<string>();
  for (const e of virtualEdges) {
    connectedIds.add(e.sourceNodeId);
    connectedIds.add(e.targetNodeId);
  }
  const orphanedNodes = virtualNodes
    .filter((n) => !connectedIds.has(n.id) && baseEdges.some((e) => e.sourceNodeId === n.id || e.targetNodeId === n.id))
    .map((n) => n.name);

  const baseRisk =
    baselineMetrics.cycleCount * 12 +
    baselineMetrics.inferredEdgeCount * 3 +
    baselineMetrics.maxDepth * 5;
  const simRisk =
    simulatedMetrics.cycleCount * 12 +
    simulatedMetrics.inferredEdgeCount * 3 +
    simulatedMetrics.maxDepth * 5 +
    brokenEdgesCount * 6 +
    orphanedNodes.length * 8;

  const riskDelta = Number((simRisk - baseRisk).toFixed(1));

  const affectedNodes = impacted.map((item) => ({
    nodeId: item.node.id,
    name: item.node.name,
    nodeType: item.node.nodeType,
    hopDistance: item.hopDistance,
    impactTier: item.tier,
    reason: `Reachable in ${item.hopDistance} hop(s) via ${item.path.join(' -> ')}`,
    confidence: item.minConfidence,
  }));

  const reportSummary = [
    ...mutationNotes,
    `Blast radius: ${affectedNodes.length} component(s) affected, ${brokenEdgesCount} active link(s) disrupted, ${orphanedNodes.length} node(s) isolated.`,
    `Cycle delta: ${simulatedMetrics.cycleCount - baselineMetrics.cycleCount}. Risk index delta: ${riskDelta >= 0 ? '+' : ''}${riskDelta}.`,
  ].join(' ');

  return {
    baselineMetrics,
    simulatedMetrics,
    affectedNodes,
    orphanedNodes,
    brokenEdgesCount,
    riskDelta,
    reportSummary,
  };
}
