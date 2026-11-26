export interface AmbiguityFinding {
  phrase: string;
  reason: string;
  suggestion: string;
}

export interface DuplicateCandidate {
  requirementId: string;
  reqCode: string;
  title: string;
  similarity: number;
}

export interface ConflictFinding {
  requirementId: string;
  reqCode: string;
  title: string;
  conflictType: string;
  explanation: string;
  severity: 'low' | 'medium' | 'high';
}

export interface QualityBreakdown {
  totalScore: number;
  clarityScore: number;
  completenessScore: number;
  testabilityScore: number;
  consistencyScore: number;
  deductions: string[];
  formula: string;
}

export interface RequirementAnalysisResult {
  suggestedCategory: string;
  ambiguities: AmbiguityFinding[];
  missingElements: string[];
  duplicates: DuplicateCandidate[];
  conflicts: ConflictFinding[];
  quality: QualityBreakdown;
  improvedDraft: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
  };
}

const VAGUE_TERMS: Array<{ pattern: RegExp; phrase: string; reason: string; suggestion: string }> = [
  {
    pattern: /\b(quickly|fast|rapidly|instantaneous|instant)\b/i,
    phrase: 'quickly / fast',
    reason: 'Response latency is subjective without a millisecond or percentile SLA.',
    suggestion: 'Specify p95 response time (e.g., "p95 latency <= 250ms under 500 concurrent requests").',
  },
  {
    pattern: /\b(user-friendly|intuitive|easy to use|seamless|smooth)\b/i,
    phrase: 'user-friendly / intuitive / seamless',
    reason: 'Usability claim cannot be verified objectively in QA tests.',
    suggestion: 'Define measurable task completion steps or WCAG AA accessibility criteria.',
  },
  {
    pattern: /\b(scalable|high availability|highly available|reliable|robust)\b/i,
    phrase: 'scalable / reliable / robust',
    reason: 'Lacks target throughput, concurrency, or uptime SLO targets.',
    suggestion: 'State target throughput (e.g., "10,000 req/min" or "99.95% monthly availability").',
  },
  {
    pattern: /\b(secure|safely|protected)\b/i,
    phrase: 'secure / safely',
    reason: 'Security requirement does not specify threat vector, algorithm, or access rule.',
    suggestion: 'Name explicit control (e.g., "AES-256-GCM at rest, RBAC verified server-side, 403 on unauthorized access").',
  },
  {
    pattern: /\b(minimal|reasonable|adequate|appropriate|etc\.?|and so on)\b/i,
    phrase: 'minimal / appropriate / etc.',
    reason: 'Open-ended boundary invites scope creep and inconsistent implementation.',
    suggestion: 'Enumerate exact bounds, fields, or error codes.',
  },
  {
    pattern: /\b(as soon as possible|asap|real-time|realtime)\b/i,
    phrase: 'asap / real-time',
    reason: 'Delivery cadence is unquantified (sub-second vs. 5s polling vs. batch).',
    suggestion: 'Specify exact sync interval or propagation SLA (e.g., "within 500ms via WebSocket").',
  },
];

const CONTRADICTION_PAIRS: Array<{
  a: RegExp;
  b: RegExp;
  type: string;
  explanation: string;
  severity: 'high' | 'medium';
}> = [
  {
    a: /\b(only one active session|single active session|one session per user|prevent concurrent logins)\b/i,
    b: /\b(multiple devices|concurrent sessions|simultaneous logins|multi-device access)\b/i,
    type: 'Session Concurrency Contradiction',
    explanation:
      'One requirement mandates a single active session while the other permits concurrent multi-device sessions.',
    severity: 'high',
  },
  {
    a: /\b(stateless|no server-side session|jwt only without storage)\b/i,
    b: /\b(server-side session|session store|revoke active session immediately|sticky session)\b/i,
    type: 'Authentication State Contradiction',
    explanation:
      'Stateless token architecture conflicts with mandatory server-side session revocation/storage.',
    severity: 'high',
  },
  {
    a: /\b(publicly accessible|anonymous access|without authentication|no login required)\b/i,
    b: /\b(authenticated users only|require login|jwt required|role-based access)\b/i,
    type: 'Access Control Contradiction',
    explanation:
      'Endpoint/feature is specified as both publicly unauthenticated and strictly authenticated.',
    severity: 'high',
  },
  {
    a: /\b(zero downtime|no maintenance window|24\/7 uninterrupted)\b/i,
    b: /\b(scheduled downtime|maintenance window|offline migration)\b/i,
    type: 'Availability SLA Contradiction',
    explanation: 'Zero-downtime constraint directly conflicts with scheduled offline maintenance windows.',
    severity: 'medium',
  },
  {
    a: /\b(permanently delete|hard delete|purge immediately)\b/i,
    b: /\b(immutable audit|retain all records|soft delete|7-year retention)\b/i,
    type: 'Data Retention Contradiction',
    explanation: 'Immediate permanent purge conflicts with immutable retention / soft-delete compliance rules.',
    severity: 'high',
  },
];

export function classifyRequirement(text: string): string {
  const lower = text.toLowerCase();
  if (/\b(as a |i want to |so that )\b/.test(lower)) return 'User Story';
  if (/\b(encrypt|jwt|oauth|rbac|xss|csrf|password|mfa|audit|permission|auth)\b/.test(lower)) {
    return 'Security';
  }
  if (/\b(latency|throughput|ms|rps|concurrent|cache|memory|cpu|p95|p99|load time)\b/.test(lower)) {
    return 'Performance';
  }
  if (/\b(constraint|must run on|docker|browser|compliance|gdpr|hipaa|pci|standard)\b/.test(lower)) {
    return 'System Constraint';
  }
  if (/\b(revenue|billing|compliance|sla|cost|customer|roi|stakeholder|market)\b/.test(lower)) {
    return 'Business';
  }
  if (/\b(api|schema|database|index|endpoint|microservice|ast|webhook|queue|sdk)\b/.test(lower)) {
    return 'Technical';
  }
  if (/\b(availability|uptime|accessibility|wcag|maintainability|scalability)\b/.test(lower)) {
    return 'Non-Functional';
  }
  return 'Functional';
}

export function tokenize(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'with', 'on', 'is', 'be',
    'that', 'this', 'must', 'should', 'shall', 'will', 'can', 'from', 'by', 'as', 'at',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

export function cosineSimilarity(aText: string, bText: string): number {
  const aTokens = tokenize(aText);
  const bTokens = tokenize(bText);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const freqA = new Map<string, number>();
  const freqB = new Map<string, number>();
  const vocab = new Set<string>();

  for (const t of aTokens) {
    freqA.set(t, (freqA.get(t) || 0) + 1);
    vocab.add(t);
  }
  for (const t of bTokens) {
    freqB.set(t, (freqB.get(t) || 0) + 1);
    vocab.add(t);
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const term of vocab) {
    const va = freqA.get(term) || 0;
    const vb = freqB.get(term) || 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  return Number((dot / (Math.sqrt(magA) * Math.sqrt(magB))).toFixed(2));
}

export function analyzeRequirementDeterministic(
  input: {
    id?: string;
    title: string;
    description: string;
    category?: string;
    acceptanceCriteria?: string[];
  },
  existingRequirements: Array<{
    id: string;
    reqCode: string;
    title: string;
    description: string;
    acceptanceCriteria?: string[];
  }>
): RequirementAnalysisResult {
  const combined = `${input.title} ${input.description} ${(input.acceptanceCriteria || []).join(' ')}`;
  const suggestedCategory = input.category || classifyRequirement(combined);

  // 1. Ambiguity detection
  const ambiguities: AmbiguityFinding[] = [];
  for (const rule of VAGUE_TERMS) {
    if (rule.pattern.test(combined)) {
      ambiguities.push({
        phrase: rule.phrase,
        reason: rule.reason,
        suggestion: rule.suggestion,
      });
    }
  }

  // 2. Completeness check
  const missingElements: string[] = [];
  if (input.description.trim().length < 40) {
    missingElements.push('Detailed behavioral description (>= 40 characters)');
  }
  if (!input.acceptanceCriteria || input.acceptanceCriteria.length === 0) {
    missingElements.push('Measurable acceptance criteria (at least 1 testable condition)');
  }
  if (!/\b(user|admin|system|service|client|api|developer|tester|role|actor)\b/i.test(combined)) {
    missingElements.push('Explicit actor or initiating system component');
  }
  if (!/\b(error|fail|invalid|reject|timeout|unauthorized|fallback|exception|4\d\d|5\d\d)\b/i.test(combined)) {
    missingElements.push('Failure / negative-path handling behavior');
  }

  // 3. Duplicate detection
  const duplicates: DuplicateCandidate[] = [];
  for (const other of existingRequirements) {
    if (input.id && other.id === input.id) continue;
    const sim = cosineSimilarity(
      `${input.title} ${input.description}`,
      `${other.title} ${other.description}`
    );
    if (sim >= 0.45) {
      duplicates.push({
        requirementId: other.id,
        reqCode: other.reqCode,
        title: other.title,
        similarity: sim,
      });
    }
  }
  duplicates.sort((a, b) => b.similarity - a.similarity);

  // 4. Conflict detection
  const conflicts: ConflictFinding[] = [];
  for (const other of existingRequirements) {
    if (input.id && other.id === input.id) continue;
    const otherText = `${other.title} ${other.description} ${(other.acceptanceCriteria || []).join(' ')}`;

    for (const pair of CONTRADICTION_PAIRS) {
      if (
        (pair.a.test(combined) && pair.b.test(otherText)) ||
        (pair.b.test(combined) && pair.a.test(otherText))
      ) {
        conflicts.push({
          requirementId: other.id,
          reqCode: other.reqCode,
          title: other.title,
          conflictType: pair.type,
          explanation: `${pair.explanation} (${other.reqCode}: "${other.title}")`,
          severity: pair.severity,
        });
      }
    }

    // Numeric SLA threshold conflict check (e.g., latency ms mismatch on shared topic)
    const sim = cosineSimilarity(input.title, other.title);
    if (sim >= 0.35) {
      const msA = combined.match(/(\d+)\s*ms/i);
      const msB = otherText.match(/(\d+)\s*ms/i);
      if (msA && msB && Number(msA[1]) !== Number(msB[1])) {
        conflicts.push({
          requirementId: other.id,
          reqCode: other.reqCode,
          title: other.title,
          conflictType: 'Conflicting Latency Threshold',
          explanation: `Specifies ${msA[1]}ms while ${other.reqCode} specifies ${msB[1]}ms for a related capability.`,
          severity: 'medium',
        });
      }
    }
  }

  // 5. Transparent Quality Score (100 pts)
  const deductions: string[] = [];
  const clarityPenalty = Math.min(25, ambiguities.length * 8);
  const clarityScore = Math.max(0, 30 - clarityPenalty);
  if (clarityPenalty > 0) deductions.push(`-${clarityPenalty} clarity (${ambiguities.length} ambiguous term(s))`);

  const completenessPenalty = Math.min(28, missingElements.length * 7);
  const completenessScore = Math.max(0, 30 - completenessPenalty);
  if (completenessPenalty > 0) deductions.push(`-${completenessPenalty} completeness (${missingElements.length} missing element(s))`);

  const hasQuantifiableTarget = /\b(\d+|<=|>=|<|>|%|ms|seconds?|hours?|http\s*\d{3}|true|false)\b/i.test(combined);
  const criteriaCount = input.acceptanceCriteria?.length || 0;
  let testabilityScore = 0;
  if (criteriaCount >= 2) testabilityScore += 12;
  else if (criteriaCount === 1) testabilityScore += 7;
  else deductions.push('-12 testability (no acceptance criteria defined)');
  if (hasQuantifiableTarget) testabilityScore += 8;
  else deductions.push('-8 testability (no measurable thresholds or expected status codes)');

  let consistencyScore = 20;
  if (conflicts.length > 0) {
    const p = Math.min(16, conflicts.length * 8);
    consistencyScore -= p;
    deductions.push(`-${p} consistency (${conflicts.length} conflict(s) detected)`);
  }
  if (duplicates.some((d) => d.similarity >= 0.75)) {
    consistencyScore = Math.max(0, consistencyScore - 5);
    deductions.push('-5 consistency (near-duplicate requirement >= 75% overlap)');
  }

  const totalScore = Math.max(0, Math.min(100, clarityScore + completenessScore + testabilityScore + consistencyScore));

  // 6. Improved draft suggestion
  const improvedCriteria = [...(input.acceptanceCriteria || [])];
  for (const amb of ambiguities) {
    improvedCriteria.push(amb.suggestion);
  }
  if (improvedCriteria.length === 0) {
    improvedCriteria.push(
      'Given an authorized request, the system returns HTTP 200 within 250ms p95.',
      'Given invalid or unauthorized input, the system rejects with HTTP 400/403 and logs an audit event.'
    );
  }

  return {
    suggestedCategory,
    ambiguities,
    missingElements,
    duplicates,
    conflicts,
    quality: {
      totalScore,
      clarityScore,
      completenessScore,
      testabilityScore,
      consistencyScore,
      deductions,
      formula: 'Clarity (30) + Completeness (30) + Testability (20) + Consistency (20) = 100',
    },
    improvedDraft: {
      title: input.title,
      description:
        ambiguities.length > 0
          ? `${input.description.trim()} [Clarification: replace subjective terms with explicit SLAs, error codes, and authorization rules.]`
          : input.description.trim(),
      acceptanceCriteria: Array.from(new Set(improvedCriteria)).slice(0, 6),
    },
  };
}
