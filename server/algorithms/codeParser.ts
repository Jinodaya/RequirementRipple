import * as acorn from 'acorn';
import crypto from 'node:crypto';

export interface ParsedArtifact {
  filePath: string;
  language: 'typescript' | 'javascript' | 'python' | 'sql' | 'unknown';
  artifactType: 'module' | 'api_route' | 'db_model' | 'component' | 'function' | 'class';
  name: string;
  signature: string;
  imports: string[];
  calls: string[];
  routes: Array<{ method: string; path: string }>;
  models: string[];
  lineCount: number;
  contentHash: string;
}

export interface InferredEdgeCandidate {
  sourceName: string;
  targetName: string;
  relationshipType: 'calls' | 'imports' | 'reads_from' | 'writes_to' | 'implements' | 'related_to';
  confidence: number;
  evidence: string;
}

export interface DriftFinding {
  driftType:
    | 'missing_implementation'
    | 'unmapped_code'
    | 'possible_deviation'
    | 'stale_snapshot'
    | 'unimplemented_criteria';
  subject: string;
  details: string;
  confidence: number;
  severity: 'low' | 'medium' | 'high';
}

export function detectLanguage(filePath: string): ParsedArtifact['language'] {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) return 'javascript';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.sql')) return 'sql';
  return 'unknown';
}

/**
 * Strips common TypeScript syntax annotations safely enough for acorn AST traversal
 * without executing any code. Falls back cleanly to structural extraction if needed.
 */
function stripTypeScriptAnnotations(code: string): string {
  return code
    .replace(/^\s*import\s+type\s+[^;]+;?/gm, '')
    .replace(/^\s*export\s+(interface|type)\s+[^{=\n]+(\{[^}]*\}|=[^;]+);?/gms, '')
    .replace(/:\s*[A-Za-z0-9_<>\[\]|&\s{}.,?]+(?=[=),;{])/g, '')
    .replace(/\s+as\s+[A-Za-z0-9_<>\[\]|&]+/g, '');
}

function walkAcornAst(node: unknown, visitor: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.type === 'string') {
    visitor(obj);
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) walkAcornAst(item, visitor);
    } else if (val && typeof val === 'object') {
      walkAcornAst(val, visitor);
    }
  }
}

/**
 * Static AST & Structural Parser (never executes untrusted repository code).
 */
export function parseSourceFile(filePath: string, content: string): ParsedArtifact[] {
  const language = detectLanguage(filePath);
  const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  const lineCount = content.split('\n').length;

  const imports = new Set<string>();
  const calls = new Set<string>();
  const routes: Array<{ method: string; path: string }> = [];
  const models = new Set<string>();
  const subArtifacts: ParsedArtifact[] = [];

  if (language === 'javascript' || language === 'typescript') {
    const candidateSource = language === 'typescript' ? stripTypeScriptAnnotations(content) : content;
    try {
      const ast = acorn.parse(candidateSource, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
      });

      walkAcornAst(ast, (node) => {
        if (node.type === 'ImportDeclaration') {
          const src = node.source as { value?: string } | undefined;
          if (src?.value) imports.add(src.value);
        } else if (node.type === 'FunctionDeclaration') {
          const id = node.id as { name?: string } | undefined;
          if (id?.name) {
            const isComponent = /^[A-Z]/.test(id.name) && (filePath.endsWith('.tsx') || filePath.endsWith('.jsx'));
            subArtifacts.push({
              filePath,
              language,
              artifactType: isComponent ? 'component' : 'function',
              name: id.name,
              signature: `function ${id.name}(...)`,
              imports: [],
              calls: [],
              routes: [],
              models: [],
              lineCount,
              contentHash,
            });
          }
        } else if (node.type === 'ClassDeclaration') {
          const id = node.id as { name?: string } | undefined;
          if (id?.name) {
            subArtifacts.push({
              filePath,
              language,
              artifactType: 'class',
              name: id.name,
              signature: `class ${id.name}`,
              imports: [],
              calls: [],
              routes: [],
              models: [],
              lineCount,
              contentHash,
            });
          }
        } else if (node.type === 'CallExpression') {
          const callee = node.callee as Record<string, unknown>;
          const args = (node.arguments as Array<Record<string, unknown>>) || [];
          if (callee?.type === 'Identifier' && typeof callee.name === 'string') {
            calls.add(callee.name);
            if (callee.name === 'require' && typeof args[0]?.value === 'string') {
              imports.add(args[0].value);
            }
          } else if (callee?.type === 'MemberExpression') {
            const obj = callee.object as { name?: string } | undefined;
            const prop = callee.property as { name?: string } | undefined;
            if (prop?.name) {
              const callName = obj?.name ? `${obj.name}.${prop.name}` : prop.name;
              calls.add(callName);
              const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
              if (
                obj?.name &&
                /app|router|server|fastify/i.test(obj.name) &&
                httpMethods.has(prop.name.toLowerCase()) &&
                typeof args[0]?.value === 'string'
              ) {
                routes.push({
                  method: prop.name.toUpperCase(),
                  path: args[0].value,
                });
              }
            }
          }
        }
      });
    } catch {
      // Fallback structural scan if TSX/complex syntax cannot be stripped cleanly
      for (const m of content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g)) {
        imports.add(m[1]);
      }
      for (const m of content.matchAll(/(?:app|router)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/gi)) {
        routes.push({ method: m[1].toUpperCase(), path: m[2] });
      }
      for (const m of content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) {
        subArtifacts.push({
          filePath,
          language,
          artifactType: /^[A-Z]/.test(m[1]) ? 'component' : 'function',
          name: m[1],
          signature: `function ${m[1]}(...)`,
          imports: [],
          calls: [],
          routes: [],
          models: [],
          lineCount,
          contentHash,
        });
      }
    }

    // Extract Mongoose/SQL/Prisma model indicators
    for (const m of content.matchAll(/(?:mongoose\.model|CREATE TABLE IF NOT EXISTS|CREATE TABLE)\s*\(?['"`]?([A-Za-z0-9_]+)/gi)) {
      models.add(m[1]);
    }
    for (const m of content.matchAll(/(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]{2,})/g)) {
      models.add(m[1]);
    }
  } else if (language === 'python') {
    for (const m of content.matchAll(/^\s*import\s+([A-Za-z0-9_.]+)/gm)) imports.add(m[1]);
    for (const m of content.matchAll(/^\s*from\s+([A-Za-z0-9_.]+)\s+import/gm)) imports.add(m[1]);
    for (const m of content.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gm)) {
      subArtifacts.push({
        filePath,
        language,
        artifactType: 'function',
        name: m[1],
        signature: `def ${m[1]}(${m[2].slice(0, 40)})`,
        imports: [],
        calls: [],
        routes: [],
        models: [],
        lineCount,
        contentHash,
      });
    }
    for (const m of content.matchAll(/^\s*class\s+([A-Za-z0-9_]+)/gm)) {
      const isModel = /\(Base\)|\(models\.Model\)|\(BaseModel\)/.test(content);
      if (isModel) models.add(m[1]);
      subArtifacts.push({
        filePath,
        language,
        artifactType: isModel ? 'db_model' : 'class',
        name: m[1],
        signature: `class ${m[1]}`,
        imports: [],
        calls: [],
        routes: [],
        models: [],
        lineCount,
        contentHash,
      });
    }
    for (const m of content.matchAll(/@(?:app|router)\.(get|post|put|patch|delete|route)\(\s*['"]([^'"]+)['"]/gi)) {
      routes.push({ method: m[1].toUpperCase(), path: m[2] });
    }
  }

  const baseName = filePath.split('/').pop() || filePath;
  const moduleArtifact: ParsedArtifact = {
    filePath,
    language,
    artifactType: routes.length > 0 ? 'api_route' : models.size > 0 ? 'db_model' : 'module',
    name: baseName,
    signature: `${filePath} (${lineCount} lines)`,
    imports: Array.from(imports),
    calls: Array.from(calls).slice(0, 30),
    routes,
    models: Array.from(models),
    lineCount,
    contentHash,
  };

  const routeArtifacts: ParsedArtifact[] = routes.map((r) => ({
    filePath,
    language,
    artifactType: 'api_route',
    name: `${r.method} ${r.path}`,
    signature: `${r.method} ${r.path} in ${baseName}`,
    imports: Array.from(imports),
    calls: [],
    routes: [r],
    models: Array.from(models),
    lineCount,
    contentHash,
  }));

  return [moduleArtifact, ...routeArtifacts, ...subArtifacts.slice(0, 12)];
}

/**
 * Discovers hidden dependencies across parsed code artifacts and requirements.
 * Every discovered edge is marked inferred with explicit evidence and confidence.
 */
export function inferHiddenDependencies(
  artifacts: Array<{
    id: string;
    name: string;
    filePath: string;
    artifactType: string;
    imports: string[];
    calls: string[];
    routes: Array<{ method: string; path: string }>;
    models: string[];
  }>,
  requirements: Array<{ id: string; reqCode: string; title: string; description: string }>
): InferredEdgeCandidate[] {
  const candidates: InferredEdgeCandidate[] = [];

  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i];

    // 1. Import matching between artifacts
    for (const imp of a.imports) {
      const impStem = imp.split('/').pop()?.replace(/\.(ts|tsx|js|jsx|py)$/, '') || imp;
      for (let j = 0; j < artifacts.length; j++) {
        if (i === j) continue;
        const b = artifacts[j];
        const bStem = b.filePath.split('/').pop()?.replace(/\.(ts|tsx|js|jsx|py)$/, '') || b.name;
        if (impStem && bStem && impStem.toLowerCase() === bStem.toLowerCase() && a.filePath !== b.filePath) {
          candidates.push({
            sourceName: a.name,
            targetName: b.name,
            relationshipType: 'imports',
            confidence: 0.92,
            evidence: `AST import "${imp}" in ${a.filePath} resolves to ${b.filePath}`,
          });
        }
      }
    }

    // 2. Shared DB model access
    for (let j = i + 1; j < artifacts.length; j++) {
      const b = artifacts[j];
      if (a.filePath === b.filePath) continue;
      const sharedModels = a.models.filter((m) => b.models.includes(m));
      if (sharedModels.length > 0) {
        candidates.push({
          sourceName: a.name,
          targetName: b.name,
          relationshipType: 'reads_from',
          confidence: 0.74,
          evidence: `Both ${a.filePath} and ${b.filePath} reference shared data model(s): ${sharedModels.join(', ')}`,
        });
      }
    }

    // 3. Requirement-to-artifact semantic suggestion
    const artTokens = new Set(
      `${a.name} ${a.filePath} ${a.routes.map((r) => r.path).join(' ')} ${a.models.join(' ')}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 3)
    );
    for (const req of requirements) {
      const reqTokens = `${req.title} ${req.description}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 3);
      const overlap = Array.from(new Set(reqTokens.filter((t) => artTokens.has(t))));
      if (overlap.length >= 2) {
        const confidence = Number(Math.min(0.86, 0.45 + overlap.length * 0.1).toFixed(2));
        candidates.push({
          sourceName: a.name,
          targetName: `${req.reqCode}: ${req.title}`,
          relationshipType: 'implements',
          confidence,
          evidence: `Shared domain identifiers [${overlap.slice(0, 4).join(', ')}] between ${a.filePath} and ${req.reqCode}`,
        });
      }
    }
  }

  return candidates;
}

/**
 * Requirement Drift Detection: compares approved requirements against repository AST evidence.
 * Explicitly avoids claiming full behavioral verification from keyword matches alone.
 */
export function detectRequirementDrift(
  requirements: Array<{
    id: string;
    reqCode: string;
    title: string;
    description: string;
    status: string;
    acceptanceCriteria: string[];
  }>,
  artifacts: Array<{
    id: string;
    name: string;
    filePath: string;
    artifactType: string;
    routes: Array<{ method: string; path: string }>;
    models: string[];
    calls: string[];
    linkedRequirementIds: string[];
  }>,
  lastSyncedAt: string | null
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  if (!lastSyncedAt) {
    findings.push({
      driftType: 'stale_snapshot',
      subject: 'Repository Index',
      details: 'No repository snapshot has been indexed yet. Drift checks are limited until code is indexed.',
      confidence: 1.0,
      severity: 'medium',
    });
  } else {
    const ageHours = (Date.now() - new Date(lastSyncedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > 72) {
      findings.push({
        driftType: 'stale_snapshot',
        subject: 'Repository Snapshot Age',
        details: `Repository snapshot is ${Math.round(ageHours)} hours old; recent commits may not be reflected.`,
        confidence: 0.95,
        severity: 'low',
      });
    }
  }

  for (const req of requirements) {
    const linked = artifacts.filter((a) => a.linkedRequirementIds.includes(req.id));
    if (linked.length === 0 && (req.status === 'approved' || req.status === 'implemented')) {
      findings.push({
        driftType: 'missing_implementation',
        subject: `${req.reqCode}: ${req.title}`,
        details: `Requirement is marked "${req.status}" but has zero mapped source artifacts in the indexed repository.`,
        confidence: 0.85,
        severity: 'high',
      });
      continue;
    }

    // Check if security/auth acceptance criteria are unaddressed in linked route handlers
    const needsAuth = /\b(auth|jwt|rbac|role|permission|token|unauthorized|403|401)\b/i.test(
      `${req.description} ${req.acceptanceCriteria.join(' ')}`
    );
    if (needsAuth && linked.length > 0) {
      const hasAuthCalls = linked.some((a) =>
        a.calls.some((c) => /auth|verify|token|permission|role|guard/i.test(c))
      );
      if (!hasAuthCalls) {
        findings.push({
          driftType: 'possible_deviation',
          subject: `${req.reqCode}: ${req.title}`,
          details: `Requirement specifies authorization controls, but linked code artifact(s) (${linked
            .map((l) => l.filePath)
            .join(', ')}) show no detected auth/permission middleware calls in AST.`,
          confidence: 0.68,
          severity: 'high',
        });
      }
    }
  }

  // Unmapped routes / modules
  for (const art of artifacts) {
    if (art.artifactType === 'api_route' && art.linkedRequirementIds.length === 0) {
      findings.push({
        driftType: 'unmapped_code',
        subject: `${art.name} (${art.filePath})`,
        details: 'API route discovered in AST has no linked software requirement or change request.',
        confidence: 0.9,
        severity: 'medium',
      });
    }
  }

  return findings;
}
