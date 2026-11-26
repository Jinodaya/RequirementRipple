import {
  traverseImpactBfs,
  type GraphEdge,
  type GraphNode,
  type TraversedNode,
} from './graphEngine.ts';
import { analyzeRequirementDeterministic, cosineSimilarity } from './requirementAnalyzer.ts';

export interface EffortAssumptions {
  hoursPerDirectArtifact: number;
  hoursPerIndirectArtifact: number;
  hoursPerDbMigration: number;
  hoursPerTestCase: number;
  maintenanceMultiplier: number;
}

export const DEFAULT_EFFORT_ASSUMPTIONS: EffortAssumptions = {
  hoursPerDirectArtifact: 4.0,
  hoursPerIndirectArtifact: 1.5,
  hoursPerDbMigration: 5.0,
  hoursPerTestCase: 1.5,
  maintenanceMultiplier: 0.2,
};

export interface ImpactedArtifactItem {
  nodeId: string | null;
  artifactName: string;
  artifactType: string;
  impactTier: 'direct' | 'indirect' | 'potential' | 'uncertain';
  relationship: string;
  hopDistance: number;
  impactReason: string;
  evidence: string;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendedAction: string;
}

export interface ImpactReportOutput {
  semanticDiff: {
    addedTerms: string[];
    removedTerms: string[];
    criteriaAdded: string[];
    criteriaRemoved: string[];
    similarityRatio: number;
    changeMagnitude: 'minor' | 'moderate' | 'major';
  };
  directCount: number;
  indirectCount: number;
  potentialCount: number;
  uncertainCount: number;
  totalBlastRadius: number;
  impactScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  recommendation: 'approve' | 'needs_further_analysis' | 'request_clarification' | 'reject';
  explanation: string;
  conflicts: Array<{ reqCode: string; title: string; conflictType: string; explanation: string }>;
  missingDependencies: string[];
  impactedArtifacts: ImpactedArtifactItem[];
  effortEstimate: {
    devHours: number;
    testHours: number;
    maintenanceHours: number;
    totalHours: number;
    complexity: 'low' | 'medium' | 'high' | 'very_high';
    assumptions: EffortAssumptions;
    disclaimer: string;
  };
  scoringBreakdown: {
    formula: string;
    directContribution: number;
    indirectContribution: number;
    criticalityBonus: number;
    conflictPenalty: number;
    historyRiskPenalty: number;
    finalScore: number;
  };
}

function tokenizeSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

export function runChangeImpactAnalysis(params: {
  changeCategory: string;
  originalTitle: string;
  originalDescription: string;
  originalCriteria: string[];
  proposedTitle: string;
  proposedDescription: string;
  proposedCriteria: string[];
  requirementId: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  otherRequirements: Array<{
    id: string;
    reqCode: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
  }>;
  repositoryArtifacts: Array<{
    id: string;
    name: string;
    filePath: string;
    artifactType: string;
    linkedRequirementIds: string[];
  }>;
  testCases: Array<{ id: string; tcCode: string; title: string; requirementId: string | null }>;
  historicalIncidents: Array<{ id: string; title: string; severity: string; affectedComponents: string[] }>;
  assumptions?: Partial<EffortAssumptions>;
}): ImpactReportOutput {
  const assumptions: EffortAssumptions = {
    ...DEFAULT_EFFORT_ASSUMPTIONS,
    ...(params.assumptions || {}),
  };

  // STEP 1-3: Compare original vs proposed requirement and compute semantic delta
  const origText = `${params.originalTitle} ${params.originalDescription}`;
  const propText = `${params.proposedTitle} ${params.proposedDescription}`;
  const origTerms = tokenizeSet(origText);
  const propTerms = tokenizeSet(propText);

  const addedTerms = Array.from(propTerms).filter((t) => !origTerms.has(t)).slice(0, 15);
  const removedTerms = Array.from(origTerms).filter((t) => !propTerms.has(t)).slice(0, 15);

  const origCritSet = new Set(params.originalCriteria);
  const propCritSet = new Set(params.proposedCriteria);
  const criteriaAdded = params.proposedCriteria.filter((c) => !origCritSet.has(c));
  const criteriaRemoved = params.originalCriteria.filter((c) => !propCritSet.has(c));

  const similarityRatio = cosineSimilarity(origText, propText);
  const changeMagnitude: 'minor' | 'moderate' | 'major' =
    params.changeCategory === 'Removal' || similarityRatio < 0.45
      ? 'major'
      : similarityRatio < 0.78 || criteriaAdded.length + criteriaRemoved.length >= 2
      ? 'moderate'
      : 'minor';

  // STEP 4-5: Locate seed node(s) and traverse direct & indirect graph dependencies
  const seedNodes = params.nodes.filter(
    (n) =>
      (params.requirementId && n.refId === params.requirementId) ||
      cosineSimilarity(n.name, params.proposedTitle) >= 0.6
  );
  const seedIds = seedNodes.map((n) => n.id);
  const traversed: TraversedNode[] = traverseImpactBfs(params.nodes, params.edges, seedIds, 5);

  const impactedArtifacts: ImpactedArtifactItem[] = [];
  const seenArtifactNames = new Set<string>();

  for (const item of traversed) {
    seenArtifactNames.add(item.node.name.toLowerCase());
    const lastEdge = item.pathEdges[item.pathEdges.length - 1];
    const riskLevel: ImpactedArtifactItem['riskLevel'] =
      item.node.criticality === 'critical' || (item.tier === 'direct' && changeMagnitude === 'major')
        ? 'critical'
        : item.node.criticality === 'high' || item.tier === 'direct'
        ? 'high'
        : item.hopDistance === 2
        ? 'medium'
        : 'low';

    impactedArtifacts.push({
      nodeId: item.node.id,
      artifactName: item.node.name,
      artifactType: item.node.nodeType,
      impactTier: item.tier,
      relationship: lastEdge?.relationshipType || 'depends_on',
      hopDistance: item.hopDistance,
      impactReason:
        item.hopDistance === 1
          ? `Directly connected via "${lastEdge?.relationshipType || 'depends_on'}"`
          : `Transitively impacted at hop ${item.hopDistance} along dependency path`,
      evidence:
        lastEdge?.evidence ||
        `Graph path: ${item.path.join(' -> ')}`,
      confidence: item.minConfidence,
      riskLevel,
      recommendedAction:
        item.node.nodeType === 'test_case'
          ? 'Update assertions and execute regression suite'
          : item.node.nodeType === 'db_collection' || item.node.nodeType === 'db_field'
          ? 'Review schema compatibility and write rollback-safe migration'
          : item.tier === 'uncertain'
          ? 'Verify inferred dependency manually with owning developer'
          : 'Inspect code contract and update dependent logic',
    });
  }

  // STEP 6: Correlate repository artifacts linked to requirement or matching changed terms
  for (const art of params.repositoryArtifacts) {
    if (seenArtifactNames.has(art.name.toLowerCase())) continue;
    const isLinked = params.requirementId && art.linkedRequirementIds.includes(params.requirementId);
    const termMatch = addedTerms.some((t) => art.name.toLowerCase().includes(t) || art.filePath.toLowerCase().includes(t));
    if (isLinked || termMatch) {
      seenArtifactNames.add(art.name.toLowerCase());
      impactedArtifacts.push({
        nodeId: null,
        artifactName: `${art.name} (${art.filePath})`,
        artifactType: art.artifactType,
        impactTier: isLinked ? 'direct' : 'potential',
        relationship: isLinked ? 'implements' : 'keyword_correlation',
        hopDistance: 1,
        impactReason: isLinked
          ? 'Source artifact is mapped directly to this requirement'
          : 'Artifact path/identifier overlaps with newly introduced requirement terminology',
        evidence: isLinked
          ? `Explicit requirement-to-code mapping in ${art.filePath}`
          : `AST artifact "${art.name}" matches modified tokens`,
        confidence: isLinked ? 0.92 : 0.55,
        riskLevel: isLinked ? 'high' : 'medium',
        recommendedAction: isLinked ? 'Update implementation and unit tests' : 'Review file for implicit coupling',
      });
    }
  }

  // STEP 7: Identify related test cases
  const linkedTests = params.testCases.filter(
    (tc) => tc.requirementId && tc.requirementId === params.requirementId
  );
  for (const tc of linkedTests) {
    if (seenArtifactNames.has(tc.tcCode.toLowerCase()) || seenArtifactNames.has(tc.title.toLowerCase())) continue;
    impactedArtifacts.push({
      nodeId: null,
      artifactName: `${tc.tcCode}: ${tc.title}`,
      artifactType: 'test_case',
      impactTier: 'direct',
      relationship: 'tests',
      hopDistance: 1,
      impactReason: 'Test case validates the requirement being modified',
      evidence: `Linked to requirement via test case registry (${tc.tcCode})`,
      confidence: 0.96,
      riskLevel: 'medium',
      recommendedAction: 'Update test steps and re-verify expected behavior',
    });
  }

  // STEP 8: Requirement conflicts & missing dependencies
  const reqAnalysis = analyzeRequirementDeterministic(
    {
      id: params.requirementId || undefined,
      title: params.proposedTitle,
      description: params.proposedDescription,
      acceptanceCriteria: params.proposedCriteria,
    },
    params.otherRequirements
  );

  const missingDependencies: string[] = [...reqAnalysis.missingElements];
  if (seedIds.length === 0) {
    missingDependencies.push('Requirement has no node in the Dependency Explorer graph; blast radius may be under-reported.');
  }
  if (linkedTests.length === 0) {
    missingDependencies.push('Zero linked test cases found for this requirement; regression coverage gap detected.');
  }

  // STEP 9: Explainable Impact Score & Effort Estimation
  const directCount = impactedArtifacts.filter((a) => a.impactTier === 'direct').length;
  const indirectCount = impactedArtifacts.filter((a) => a.impactTier === 'indirect').length;
  const potentialCount = impactedArtifacts.filter((a) => a.impactTier === 'potential').length;
  const uncertainCount = impactedArtifacts.filter((a) => a.impactTier === 'uncertain').length;
  const totalBlastRadius = impactedArtifacts.length;

  const criticalNodesCount = impactedArtifacts.filter(
    (a) => a.riskLevel === 'critical' || a.riskLevel === 'high'
  ).length;
  const matchingIncidents = params.historicalIncidents.filter((inc) =>
    inc.affectedComponents.some((comp) =>
      impactedArtifacts.some((a) => a.artifactName.toLowerCase().includes(comp.toLowerCase()))
    )
  );

  const directContribution = Math.min(35, directCount * 7);
  const indirectContribution = Math.min(25, (indirectCount + potentialCount) * 3.5);
  const criticalityBonus = Math.min(20, criticalNodesCount * 4 + (changeMagnitude === 'major' ? 8 : 0));
  const conflictPenalty = Math.min(12, reqAnalysis.conflicts.length * 6);
  const historyRiskPenalty = Math.min(8, matchingIncidents.length * 4);

  const impactScore = Number(
    Math.min(
      100,
      directContribution + indirectContribution + criticalityBonus + conflictPenalty + historyRiskPenalty
    ).toFixed(1)
  );

  const riskLevel: ImpactReportOutput['riskLevel'] =
    impactScore >= 75 || reqAnalysis.conflicts.some((c) => c.severity === 'high')
      ? 'critical'
      : impactScore >= 50
      ? 'high'
      : impactScore >= 25
      ? 'medium'
      : 'low';

  const avgConfidence =
    impactedArtifacts.length > 0
      ? Number(
          (
            impactedArtifacts.reduce((acc, a) => acc + a.confidence, 0) / impactedArtifacts.length
          ).toFixed(2)
        )
      : seedIds.length > 0
      ? 0.85
      : 0.45;

  let recommendation: ImpactReportOutput['recommendation'] = 'approve';
  if (reqAnalysis.conflicts.some((c) => c.severity === 'high') || riskLevel === 'critical') {
    recommendation = 'needs_further_analysis';
  }
  if (reqAnalysis.quality.totalScore < 55 || reqAnalysis.ambiguities.length >= 3) {
    recommendation = 'request_clarification';
  }
  if (reqAnalysis.conflicts.length >= 2 && riskLevel === 'critical') {
    recommendation = 'reject';
  }

  const dbCount = impactedArtifacts.filter(
    (a) => a.artifactType === 'db_collection' || a.artifactType === 'db_field' || a.artifactType === 'db_model'
  ).length;
  const devHours = Number(
    (
      (changeMagnitude === 'major' ? 6 : changeMagnitude === 'moderate' ? 3 : 1.5) +
      directCount * assumptions.hoursPerDirectArtifact +
      (indirectCount + potentialCount) * assumptions.hoursPerIndirectArtifact +
      dbCount * assumptions.hoursPerDbMigration
    ).toFixed(1)
  );
  const testHours = Number(
    (Math.max(1, linkedTests.length + Math.ceil(totalBlastRadius / 2)) * assumptions.hoursPerTestCase).toFixed(1)
  );
  const maintenanceHours = Number(((devHours + testHours) * assumptions.maintenanceMultiplier).toFixed(1));
  const totalHours = Number((devHours + testHours + maintenanceHours).toFixed(1));

  const complexity: ImpactReportOutput['effortEstimate']['complexity'] =
    totalHours >= 40 ? 'very_high' : totalHours >= 20 ? 'high' : totalHours >= 8 ? 'medium' : 'low';

  const explanation = [
    `Change categorized as ${params.changeCategory} (${changeMagnitude} semantic delta, ${Math.round(
      (1 - similarityRatio) * 100
    )}% lexical shift).`,
    `Graph traversal identified ${directCount} direct, ${indirectCount} indirect, ${potentialCount} potential, and ${uncertainCount} uncertain impacted artifacts (blast radius: ${totalBlastRadius}).`,
    reqAnalysis.conflicts.length > 0
      ? `Detected ${reqAnalysis.conflicts.length} requirement conflict(s) requiring resolution before approval.`
      : 'No structural requirement contradictions detected.',
    matchingIncidents.length > 0
      ? `Warning: ${matchingIncidents.length} historical incident(s) occurred on overlapping components.`
      : 'No overlapping historical production incidents found.',
  ].join(' ');

  return {
    semanticDiff: {
      addedTerms,
      removedTerms,
      criteriaAdded,
      criteriaRemoved,
      similarityRatio,
      changeMagnitude,
    },
    directCount,
    indirectCount,
    potentialCount,
    uncertainCount,
    totalBlastRadius,
    impactScore,
    riskLevel,
    confidence: avgConfidence,
    recommendation,
    explanation,
    conflicts: reqAnalysis.conflicts.map((c) => ({
      reqCode: c.reqCode,
      title: c.title,
      conflictType: c.conflictType,
      explanation: c.explanation,
    })),
    missingDependencies,
    impactedArtifacts,
    effortEstimate: {
      devHours,
      testHours,
      maintenanceHours,
      totalHours,
      complexity,
      assumptions,
      disclaimer:
        'Effort figures are transparent deterministic estimates derived from blast radius and configurable multipliers, not guaranteed schedules.',
    },
    scoringBreakdown: {
      formula: 'min(100, Direct(<=35) + Indirect(<=25) + Criticality(<=20) + Conflicts(<=12) + History(<=8))',
      directContribution,
      indirectContribution,
      criticalityBonus,
      conflictPenalty,
      historyRiskPenalty,
      finalScore: impactScore,
    },
  };
}
