# RequirementRipple Technical Architecture & Methodology

## 1. System Overview
RequirementRipple is a full-stack Software Requirement Engineering, Change Impact Analysis, Dependency Intelligence, Digital Twin Simulation, and Predictive Maintenance Platform.

Core workflow:
**Understand a change -> Discover graph & AST dependencies -> Simulate virtual consequences -> Quantify risks & effort -> Recommend preventive actions.**

## 2. Deterministic Algorithms & Transparent Formulas

### 2.1 Requirement Quality Score (0–100)
`Quality = Clarity (30) + Completeness (30) + Testability (20) + Consistency (20)`
- **Clarity (30)**: Deducts 8 points per detected subjective/unmeasurable phrase (e.g., *quickly*, *user-friendly*, *scalable*, *seamless*, *etc.*).
- **Completeness (30)**: Checks description depth (`>= 40` chars), presence of acceptance criteria, explicit actor/component, and negative/error-path specification.
- **Testability (20)**: Awards 12 pts for `>= 2` acceptance criteria and 8 pts for quantifiable thresholds (`ms`, `%`, HTTP status codes, numeric bounds).
- **Consistency (20)**: Deducts 8 pts per detected contradiction (session concurrency, stateless vs stateful auth, public vs authenticated, retention vs purge, numeric SLA mismatch) and 5 pts for near-duplicate overlap (`>= 0.75` cosine similarity).

### 2.2 Graph Traversal & Dependency Intelligence (`server/algorithms/graphEngine.ts`)
- **BFS Direct & Indirect Discovery**: `traverseImpactBfs(nodes, edges, startNodeIds, maxDepth)` traverses outgoing dependencies and incoming dependents, recording hop distance, full evidence path, minimum edge confidence, and whether any edge along the path is `isInferred`.
  - `direct`: `hopDistance === 1` and verified (`!hasInferredEdge && confidence >= 0.8`).
  - `indirect`: `hopDistance >= 2` across verified edges.
  - `potential`: traverses an inferred edge (`confidence >= 0.6`).
  - `uncertain`: traverses an inferred edge (`confidence < 0.6`).
- **DFS Cycle Detection**: `detectDependencyCycles` locates circular dependencies across directed links.
- **Topological Sort**: Kahn's algorithm produces safe implementation ordering for DAG subgraphs.
- **Isolated What-If Simulation**: `simulateVirtualMutation` clones project nodes and edges into an in-memory virtual graph, applies removals/modifications/edges, and compares baseline vs simulated metrics without mutating the project database.

### 2.3 10-Step Change Impact Score (0–100) & Effort Estimation
`ImpactScore = min(100, Direct(<=35) + Indirect(<=25) + Criticality(<=20) + Conflicts(<=12) + History(<=8))`
- **Effort Estimate**:
  - `devHours = baseByMagnitude + direct * hoursPerDirect + (indirect + potential) * hoursPerIndirect + dbArtifacts * hoursPerDbMigration`
  - `testHours = max(1, linkedTests + ceil(blastRadius / 2)) * hoursPerTestCase`
  - `maintenanceHours = (devHours + testHours) * maintenanceMultiplier`
  - All multipliers are user-adjustable inside the Impact Report UI.

### 2.4 Static AST Code Analysis (`server/algorithms/codeParser.ts`)
- Uses `acorn` AST parsing for JavaScript/TypeScript and structural lexing for Python without ever executing untrusted code.
- Extracts modules, functions, classes, imports, Express/FastAPI API routes, and SQL/ORM models.
- Infers hidden dependencies (`imports`, `reads_from`, `implements`) marked explicitly as `isInferred: true` with confidence and evidence strings.
- Compares approved requirements against AST evidence to flag missing implementations, unmapped routes, stale snapshots, and auth/control deviations.

## 3. Security Controls
- **Passwords**: `bcryptjs` salted hashing (`saltRounds = 10`).
- **Sessions**: Short-lived JWT access tokens held strictly in client memory (`Authorization: Bearer`) paired with `HttpOnly; Secure; SameSite=None; Partitioned` refresh token rotation cookies and `Origin` verification.
- **Isolation & RBAC**: Every `/api/orgs/:orgId/*` and `/api/projects/:projectId/*` route verifies active organization membership and role permissions (`Organization Owner`, `Administrator`, `Project Manager`, `Developer`, `Tester`, `Viewer`).
- **SSRF & Prompt Injection**: GitHub sync strictly allowlists `https://api.github.com` and encrypts stored PATs with AES-256-GCM; AI prompts wrap untrusted requirement/code payloads in `<untrusted_project_data>` delimiters.
