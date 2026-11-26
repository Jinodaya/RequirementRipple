import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, GitBranch, Send, ShieldAlert, Upload } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { EmptyState, StatusIndicator, TableSkeleton } from '../components/StatusText';

export function AiIntelligencePage() {
  const navigate = useNavigate();
  const { activeProjectId, pushToast } = useAuthStore();

  // Requirement Analyzer State
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftCriteria, setDraftCriteria] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [reqResult, setReqResult] = useState<any>(null);

  // Developer Knowledge Assistant State
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [qaHistory, setQaHistory] = useState<
    Array<{
      question: string;
      answer: string;
      provider: string;
      citations: Array<{ type: string; label: string; snippet: string }>;
    }>
  >([]);

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to run AI requirement intelligence and query the Developer Knowledge Assistant."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setAnalyzing(true);
    try {
      const res = await apiRequest(`/api/projects/${activeProjectId}/requirements/analyze`, {
        method: 'POST',
        body: JSON.stringify({
          title: draftTitle,
          description: draftDesc,
          acceptanceCriteria: draftCriteria.split('\n').map((s) => s.trim()).filter(Boolean),
          useAi: true,
        }),
      });
      setReqResult(res);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    try {
      const res = await apiRequest<{
        provider: string;
        answer: string;
        citations: Array<{ type: string; label: string; snippet: string }>;
      }>(`/api/projects/${activeProjectId}/assistant`, {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setQaHistory((prev) => [{ question, ...res }, ...prev]);
      setQuestion('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Assistant query failed.');
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          AI Intelligence & Developer Knowledge Assistant
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Audit draft requirements for ambiguity, missing criteria, and conflicts, or interrogate authorized project evidence via RAG.
        </p>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left: Requirement Quality & Conflict Analyzer */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-blue-700" />
            <h2 className="text-base font-semibold text-slate-900">Requirement Intelligence Workbench</h2>
          </div>
          <form onSubmit={handleAnalyze} className="space-y-3">
            <input
              type="text"
              required
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder="Requirement title (e.g., Fast multi-device checkout)"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <textarea
              rows={3}
              required
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Paste requirement statement to check ambiguity, duplicates, and contradictions..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <textarea
              rows={2}
              value={draftCriteria}
              onChange={(e) => setDraftCriteria(e.target.value)}
              placeholder="Optional acceptance criteria (one per line)"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
            <button
              type="submit"
              disabled={analyzing}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
            >
              {analyzing ? 'Analyzing...' : 'Analyze Quality & Conflicts'}
            </button>
          </form>

          {reqResult && (
            <div className="pt-4 border-t border-slate-200 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900">
                  Quality Score: <span className="font-mono">{reqResult.deterministic.quality.totalScore}/100</span>
                </span>
                <span className="text-slate-500">Category: {reqResult.deterministic.suggestedCategory}</span>
              </div>
              <p className="text-slate-600 font-mono">
                Clarity {reqResult.deterministic.quality.clarityScore}/30 · Completeness {reqResult.deterministic.quality.completenessScore}/30 · Testability {reqResult.deterministic.quality.testabilityScore}/20 · Consistency {reqResult.deterministic.quality.consistencyScore}/20
              </p>
              {reqResult.deterministic.ambiguities.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-1">
                  <p className="font-semibold text-amber-900">Ambiguity Findings</p>
                  {reqResult.deterministic.ambiguities.map((a: any, i: number) => (
                    <p key={i}><strong>"{a.phrase}"</strong> — {a.suggestion}</p>
                  ))}
                </div>
              )}
              {reqResult.deterministic.conflicts.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded space-y-1">
                  <p className="font-semibold text-red-900">Conflicts Detected</p>
                  {reqResult.deterministic.conflicts.map((c: any, i: number) => (
                    <p key={i}>{c.conflictType}: {c.explanation}</p>
                  ))}
                </div>
              )}
              {reqResult.aiEnhancement && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5">
                  <p className="font-semibold text-blue-800">
                    Suggested Improved Specification ({reqResult.aiEnhancement.provider})
                  </p>
                  <p className="text-slate-700">{reqResult.aiEnhancement.executiveSummary}</p>
                  <p className="text-slate-900 font-medium">
                    {reqResult.aiEnhancement.suggestedRewrite?.description}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Project-Aware RAG Knowledge Assistant */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-6 space-y-4 flex flex-col">
          <h2 className="text-base font-semibold text-slate-900">Developer Knowledge Assistant</h2>
          <p className="text-xs text-slate-500">
            Retrieves answers strictly from authorized requirements, AST artifacts, change requests, and incident records in this project.
          </p>

          <div className="flex flex-wrap gap-2">
            {[
              'Which requirements depend on authentication?',
              'What happened during the previous auth change?',
              'What are the high-risk modules in this project?',
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setQuestion(sample)}
                className="px-2.5 py-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
              >
                {sample}
              </button>
            ))}
          </div>

          <form onSubmit={handleAsk} className="flex gap-2">
            <input
              type="text"
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about dependencies, past incidents, or API behavior..."
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <button
              type="submit"
              disabled={asking}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{asking ? 'Querying...' : 'Ask'}</span>
            </button>
          </form>

          <div className="flex-1 space-y-4 overflow-y-auto max-h-[420px]">
            {qaHistory.map((item, idx) => (
              <div key={idx} className="border border-slate-200 rounded-md p-4 space-y-2.5 text-xs">
                <p className="font-semibold text-slate-900">Q: {item.question}</p>
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{item.answer}</p>
                <p className="text-[11px] font-mono text-slate-400">Provider: {item.provider}</p>
                {item.citations.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-1">
                    <p className="font-semibold text-slate-700">Evidence Citations:</p>
                    {item.citations.map((c, ci) => (
                      <p key={ci} className="text-slate-600">
                        <span className="font-mono text-blue-700">[{c.type}]</span> <strong>{c.label}</strong> — {c.snippet}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RepositoryExplorerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();

  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [syncing, setSyncing] = useState(false);

  const [filePath, setFilePath] = useState('src/routes/billing.ts');
  const [fileContent, setFileContent] = useState(
    `import { requireAuth } from '../middleware/authGateway';\n\nexport function registerBilling(app) {\n  app.post('/api/billing/invoice', requireAuth, (req, res) => {\n    res.json({ created: true });\n  });\n}`
  );
  const [parsing, setParsing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['repository', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<any>(`/api/projects/${activeProjectId}/repository`),
  });

  const { data: driftData, refetch: refetchDrift } = useQuery({
    queryKey: ['drift', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ findings: any[]; lastSyncedAt: string | null }>(`/api/projects/${activeProjectId}/drift`),
  });

  const { data: reqsData } = useQuery({
    queryKey: ['reqs-for-repo', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ requirements: Array<{ id: string; reqCode: string; title: string }> }>(`/api/projects/${activeProjectId}/requirements`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to connect GitHub repositories, inspect AST artifacts, and detect requirement drift."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  async function handleGitHubSync(e: React.FormEvent) {
    e.preventDefault();
    setSyncing(true);
    try {
      const res = await apiRequest<{ indexedFilesCount: number; artifactsCreated: number; inferredEdgesCreated: number }>(
        `/api/projects/${activeProjectId}/repository/connect-github`,
        {
          method: 'POST',
          body: JSON.stringify({ owner, repo, branch, accessToken: token || undefined }),
        }
      );
      setToken('');
      await queryClient.invalidateQueries({ queryKey: ['repository', activeProjectId] });
      await refetchDrift();
      pushToast('success', `Indexed ${res.indexedFilesCount} files, ${res.artifactsCreated} AST artifacts, ${res.inferredEdgesCreated} inferred links.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'GitHub sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleAnalyzeFile(e: React.FormEvent) {
    e.preventDefault();
    setParsing(true);
    try {
      const res = await apiRequest<{ artifactsCreated: number; inferredEdgesCreated: number }>(
        `/api/projects/${activeProjectId}/repository/analyze-files`,
        {
          method: 'POST',
          body: JSON.stringify({ files: [{ filePath, content: fileContent }] }),
        }
      );
      await queryClient.invalidateQueries({ queryKey: ['repository', activeProjectId] });
      await refetchDrift();
      pushToast('success', `AST parsed ${res.artifactsCreated} artifact(s) and inferred ${res.inferredEdgesCreated} edge(s).`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'AST parsing failed.');
    } finally {
      setParsing(false);
    }
  }

  async function handleLinkReq(artifactId: string, requirementId: string) {
    if (!requirementId) return;
    await apiRequest(`/api/projects/${activeProjectId}/repository/artifacts/${artifactId}/link-requirement`, {
      method: 'POST',
      body: JSON.stringify({ requirementId }),
    });
    await queryClient.invalidateQueries({ queryKey: ['repository', activeProjectId] });
    await refetchDrift();
    pushToast('success', 'Code artifact mapped to requirement.');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          Repository Intelligence & Drift Detection
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Connect a GitHub repository or index JS/TS/Python files statically via AST without executing untrusted code. Tokens stay encrypted server-side.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={handleGitHubSync} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">Connect GitHub Repository</h2>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <input
              type="text"
              required
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="owner (e.g. expressjs)"
              className="px-3 py-2 border border-slate-300 rounded-md"
            />
            <input
              type="text"
              required
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="repo (e.g. express)"
              className="px-3 py-2 border border-slate-300 rounded-md"
            />
            <input
              type="text"
              required
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="branch"
              className="px-3 py-2 border border-slate-300 rounded-md"
            />
          </div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Optional GitHub PAT (encrypted server-side; blank for public repos)"
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md"
          />
          <button
            type="submit"
            disabled={syncing}
            className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md"
          >
            {syncing ? 'Indexing GitHub AST...' : 'Sync & Index Repository'}
          </button>
        </form>

        <form onSubmit={handleAnalyzeFile} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-700" />
            <h2 className="text-sm font-semibold text-slate-900">Static AST Source File Analyzer (JS / TS / Python)</h2>
          </div>
          <input
            type="text"
            required
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
          />
          <textarea
            rows={4}
            required
            value={fileContent}
            onChange={(e) => setFileContent(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
          />
          <button
            type="submit"
            disabled={parsing}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
          >
            {parsing ? 'Parsing AST...' : 'Parse AST & Infer Dependencies'}
          </button>
        </form>
      </div>

      {/* Requirement Drift Findings */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-700" />
          <h2 className="text-sm font-semibold text-slate-900">Requirement Drift Detection</h2>
        </div>
        {(driftData?.findings || []).length === 0 ? (
          <p className="text-xs text-slate-500">No requirement drift indicators detected.</p>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {driftData!.findings.map((f, idx) => (
              <div key={idx} className="py-2.5 flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-900">
                    [{f.driftType.replace(/_/g, ' ')}] {f.subject}
                  </p>
                  <p className="text-slate-600 mt-0.5">{f.details}</p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusIndicator status={f.severity} />
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5">{Math.round(f.confidence * 100)}% conf</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Indexed Artifacts Table */}
      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Indexed Repository Artifacts</h2>
            <span className="text-xs text-slate-500 tabular-nums">{data?.artifacts?.length || 0} artifacts</span>
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Artifact</th>
                <th className="py-2.5 px-3">File & Language</th>
                <th className="py-2.5 px-3">Imports / Calls</th>
                <th className="py-2.5 px-4">Map Requirement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(data?.artifacts || []).map((art: any) => (
                <tr key={art.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                    {art.name}
                    <span className="block text-[11px] text-slate-500 font-sans">{art.artifactType}</span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 font-mono">
                    {art.filePath} · {art.language}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                    {art.imports.length > 0 ? `Imports: ${art.imports.join(', ')}` : art.signature}
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={art.linkedRequirementIds[0] || ''}
                      onChange={(e) => handleLinkReq(art.id, e.target.value)}
                      className="px-2 py-1 border border-slate-300 rounded bg-white text-xs max-w-[180px]"
                    >
                      <option value="">Link requirement...</option>
                      {(reqsData?.requirements || []).map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.reqCode}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
