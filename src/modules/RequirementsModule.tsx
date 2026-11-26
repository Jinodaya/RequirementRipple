import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Search, Sparkles } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { EmptyState, StatusIndicator, TableSkeleton } from '../components/StatusText';

interface RequirementItem {
  id: string;
  reqCode: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  approvalStatus: string;
  acceptanceCriteria: string[];
  tags: string[];
  authorName: string;
  versionNumber: number;
  qualityScore: number;
  qualityBreakdown: {
    totalScore: number;
    clarityScore: number;
    completenessScore: number;
    testabilityScore: number;
    consistencyScore: number;
    deductions: string[];
    formula: string;
  };
  updatedAt: string;
}

const CATEGORIES = [
  'Functional',
  'Non-Functional',
  'Security',
  'Performance',
  'Technical',
  'Business',
  'User Story',
  'System Constraint',
];

export function RequirementsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Functional');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('high');
  const [criteriaText, setCriteriaText] = useState('');
  const [analysisPreview, setAnalysisPreview] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['requirements', activeProjectId, search, categoryFilter, statusFilter],
    enabled: Boolean(activeProjectId),
    queryFn: () => {
      const qs = new URLSearchParams({
        search,
        category: categoryFilter,
        status: statusFilter,
      }).toString();
      return apiRequest<{ requirements: RequirementItem[] }>(
        `/api/projects/${activeProjectId}/requirements?${qs}`
      );
    },
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="Select a project first"
        description="Choose or create a project in Projects to manage requirements."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  const requirements = data?.requirements || [];

  async function handlePreAnalyze() {
    if (!activeProjectId || title.trim().length < 2 || description.trim().length < 2) return;
    setAnalyzing(true);
    try {
      const criteria = criteriaText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiRequest(`/api/projects/${activeProjectId}/requirements/analyze`, {
        method: 'POST',
        body: JSON.stringify({ title, description, category, acceptanceCriteria: criteria, useAi: true }),
      });
      setAnalysisPreview(res);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCreateRequirement(e: React.FormEvent) {
    e.preventDefault();
    if (!activeProjectId) return;
    setSaving(true);
    try {
      const criteria = criteriaText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiRequest(`/api/projects/${activeProjectId}/requirements`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          category,
          priority,
          acceptanceCriteria: criteria,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['requirements', activeProjectId] });
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setCriteriaText('');
      setAnalysisPreview(null);
      pushToast('success', 'Requirement created, versioned (v1), and added to dependency graph.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to create requirement.');
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkStatus(status: string) {
    if (selectedIds.length === 0) return;
    try {
      await apiRequest(`/api/projects/${activeProjectId}/requirements/bulk-status`, {
        method: 'POST',
        body: JSON.stringify({ requirementIds: selectedIds, status }),
      });
      setSelectedIds([]);
      await queryClient.invalidateQueries({ queryKey: ['requirements', activeProjectId] });
      pushToast('success', `Updated ${selectedIds.length} requirement(s) to ${status}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Bulk update failed.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">Requirements</h1>
          <p className="mt-1 text-sm text-slate-600">
            Versioned requirement repository with explainable quality scoring, conflict detection, and dependency linking.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Requirement</span>
        </button>
      </div>

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Author Requirement with Intelligence Check</h2>
            <button
              type="button"
              onClick={handlePreAnalyze}
              disabled={analyzing || !title || !description}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{analyzing ? 'Analyzing...' : 'Run Quality & Conflict Check'}</span>
            </button>
          </div>

          <form onSubmit={handleCreateRequirement} className="space-y-4">
            <div className="grid sm:grid-cols-4 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Requirement Title</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enforce idempotency key on settlement API"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Detailed Specification</label>
              <textarea
                rows={3}
                required
                minLength={10}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe actor, expected system behavior, SLAs, and error handling..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Acceptance Criteria (one measurable condition per line)
              </label>
              <textarea
                rows={3}
                value={criteriaText}
                onChange={(e) => setCriteriaText(e.target.value)}
                placeholder="Given valid token, returns HTTP 200 within 250ms p95.&#10;Given missing token, returns HTTP 401."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-mono text-xs"
              />
            </div>

            {analysisPreview && (
              <div className="border border-slate-200 rounded-md p-4 bg-slate-50 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    Explainable Quality Score: <span className="font-mono tabular-nums">{analysisPreview.deterministic.quality.totalScore}/100</span>
                  </span>
                  <span className="text-slate-500">
                    Suggested Category: {analysisPreview.deterministic.suggestedCategory}
                  </span>
                </div>
                {analysisPreview.deterministic.ambiguities.length > 0 && (
                  <div>
                    <p className="font-semibold text-amber-800">Ambiguities Detected:</p>
                    <ul className="mt-1 list-disc list-inside text-slate-700 space-y-0.5">
                      {analysisPreview.deterministic.ambiguities.map((a: any, i: number) => (
                        <li key={i}>
                          <strong>"{a.phrase}"</strong> — {a.reason} <em>Fix: {a.suggestion}</em>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysisPreview.deterministic.conflicts.length > 0 && (
                  <div>
                    <p className="font-semibold text-red-700">Potential Contradictions:</p>
                    <ul className="mt-1 list-disc list-inside text-red-800 space-y-0.5">
                      {analysisPreview.deterministic.conflicts.map((c: any, i: number) => (
                        <li key={i}>{c.conflictType}: {c.explanation}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysisPreview.aiEnhancement && (
                  <div>
                    <p className="font-semibold text-blue-800">
                      AI Review ({analysisPreview.aiEnhancement.provider}):
                    </p>
                    <p className="mt-0.5 text-slate-700">{analysisPreview.aiEnhancement.executiveSummary}</p>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
              >
                {saving ? 'Saving...' : 'Save Requirement'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-lg p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, title, or specification..."
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-slate-200 rounded-md"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-md bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="in_review">In Review</option>
          <option value="approved">Approved</option>
          <option value="implemented">Implemented</option>
          <option value="deprecated">Deprecated</option>
        </select>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-slate-600 tabular-nums">{selectedIds.length} selected</span>
            <button
              type="button"
              onClick={() => handleBulkStatus('approved')}
              className="px-2.5 py-1 text-xs font-medium bg-emerald-700 text-white rounded"
            >
              Mark Approved
            </button>
            <button
              type="button"
              onClick={() => handleBulkStatus('in_review')}
              className="px-2.5 py-1 text-xs font-medium bg-slate-700 text-white rounded"
            >
              Mark In Review
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : requirements.length === 0 ? (
        <EmptyState
          title="No matching requirements"
          description="Author your first software requirement to compute quality scores and build the dependency graph."
          actionLabel="Author First Requirement"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4 w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === requirements.length && requirements.length > 0}
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? requirements.map((r) => r.id) : [])
                    }
                  />
                </th>
                <th className="py-3 px-3">Code</th>
                <th className="py-3 px-3">Title & Category</th>
                <th className="py-3 px-3">Priority</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3 text-right">Quality</th>
                <th className="py-3 px-3 text-right">Ver</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {requirements.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(req.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked ? [...prev, req.id] : prev.filter((x) => x !== req.id)
                        )
                      }
                    />
                  </td>
                  <td
                    onClick={() => navigate(`/app/requirements/${req.id}`)}
                    className="py-3 px-3 font-mono text-xs font-semibold text-blue-700 cursor-pointer whitespace-nowrap"
                  >
                    {req.reqCode}
                  </td>
                  <td
                    onClick={() => navigate(`/app/requirements/${req.id}`)}
                    className="py-3 px-3 cursor-pointer"
                  >
                    <p className="font-medium text-slate-900">{req.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {req.category} · {req.acceptanceCriteria.length} acceptance criteria
                    </p>
                  </td>
                  <td className="py-3 px-3 text-xs capitalize text-slate-700">{req.priority}</td>
                  <td className="py-3 px-3">
                    <StatusIndicator status={req.status} />
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs tabular-nums font-semibold text-slate-900">
                    {req.qualityScore}/100
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-slate-500">
                    v{req.versionNumber}
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

export function RequirementDetailPage() {
  const { reqId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCriteria, setEditCriteria] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [commentBody, setCommentBody] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['requirement-detail', activeProjectId, reqId],
    enabled: Boolean(activeProjectId && reqId),
    queryFn: () =>
      apiRequest<{
        requirement: RequirementItem;
        versions: Array<{
          id: string;
          versionNumber: number;
          title: string;
          description: string;
          acceptanceCriteria: string[];
          changedByName: string;
          changeSummary: string;
          createdAt: string;
        }>;
        comments: Array<{ id: string; body: string; authorName: string; createdAt: string }>;
        linkedArtifacts: Array<{ id: string; filePath: string; artifactType: string; name: string }>;
        linkedTests: Array<{ id: string; tcCode: string; title: string; testType: string; status: string }>;
      }>(`/api/projects/${activeProjectId}/requirements/${reqId}`),
  });

  if (isLoading || !data) {
    return <TableSkeleton rows={6} />;
  }

  const { requirement: req, versions, comments, linkedArtifacts, linkedTests } = data;
  const selectedOldVersion =
    versions.find((v) => v.versionNumber === compareVersion) || versions[1] || versions[0];

  function startEdit() {
    setEditTitle(req.title);
    setEditDesc(req.description);
    setEditCriteria(req.acceptanceCriteria.join('\n'));
    setChangeSummary('');
    setEditing(true);
  }

  async function handleSaveVersion(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/projects/${activeProjectId}/requirements/${req.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          description: editDesc,
          acceptanceCriteria: editCriteria.split('\n').map((s) => s.trim()).filter(Boolean),
          changeSummary: changeSummary || 'Specification refinement',
        }),
      });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['requirement-detail', activeProjectId, reqId] });
      pushToast('success', 'New immutable requirement version saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Save failed.');
    }
  }

  async function handleApprove(decision: 'approved' | 'rejected') {
    try {
      await apiRequest(`/api/projects/${activeProjectId}/requirements/${req.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          reason: `Reviewed quality (${req.qualityScore}/100) and acceptance criteria.`,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['requirement-detail', activeProjectId, reqId] });
      pushToast('success', `Requirement ${decision}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Approval failed.');
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    await apiRequest(`/api/projects/${activeProjectId}/requirements/${req.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: commentBody }),
    });
    setCommentBody('');
    await queryClient.invalidateQueries({ queryKey: ['requirement-detail', activeProjectId, reqId] });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/app/requirements')}
            className="p-2 border border-slate-300 bg-white rounded-md hover:bg-slate-50"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-xs font-mono text-blue-700 font-semibold">
              {req.reqCode} · v{req.versionNumber} · {req.category}
            </p>
            <h1 className="text-xl font-bold text-slate-900 font-display">{req.title}</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startEdit}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
          >
            Edit (New Version)
          </button>
          <button
            type="button"
            onClick={() => handleApprove('approved')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
          >
            Approve Baseline
          </button>
          <button
            type="button"
            onClick={() => navigate(`/app/changes?requirementId=${req.id}`)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
          >
            Propose Change Request
          </button>
        </div>
      </div>

      {editing ? (
        <form onSubmit={handleSaveVersion} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">Create Version v{req.versionNumber + 1}</h2>
          <input
            type="text"
            required
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
          <textarea
            rows={4}
            required
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
          <textarea
            rows={3}
            value={editCriteria}
            onChange={(e) => setEditCriteria(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
          />
          <input
            type="text"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder="Reason for this version update..."
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs border border-slate-300 rounded">
              Cancel
            </button>
            <button type="submit" className="px-4 py-1.5 text-xs font-semibold bg-blue-700 text-white rounded">
              Save v{req.versionNumber + 1}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <StatusIndicator status={req.status} />
                <span className="text-xs font-mono tabular-nums text-slate-600">
                  Quality: {req.qualityScore}/100 ({req.qualityBreakdown?.formula})
                </span>
              </div>
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{req.description}</p>
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-2">Acceptance Criteria</h3>
                {req.acceptanceCriteria.length === 0 ? (
                  <p className="text-xs text-slate-500">No acceptance criteria defined.</p>
                ) : (
                  <ul className="list-disc list-inside space-y-1 text-sm text-slate-700">
                    {req.acceptanceCriteria.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
              {req.qualityBreakdown?.deductions?.length > 0 && (
                <div className="pt-3 border-t border-slate-100 text-xs text-amber-800">
                  <strong>Quality Deductions:</strong> {req.qualityBreakdown.deductions.join(' · ')}
                </div>
              )}
            </div>

            {/* Version Comparison */}
            <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Version History & Comparison</h2>
                {versions.length > 1 && (
                  <select
                    value={selectedOldVersion?.versionNumber || ''}
                    onChange={(e) => setCompareVersion(Number(e.target.value))}
                    className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.versionNumber}>
                        Compare vs v{v.versionNumber} ({v.changeSummary})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {selectedOldVersion && (
                <div className="grid sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 border border-slate-200 rounded bg-slate-50">
                    <p className="font-mono font-semibold text-slate-600 mb-1">
                      v{selectedOldVersion.versionNumber} Baseline
                    </p>
                    <p className="font-semibold text-slate-900">{selectedOldVersion.title}</p>
                    <p className="mt-1 text-slate-700">{selectedOldVersion.description}</p>
                  </div>
                  <div className="p-3 border border-blue-200 rounded bg-blue-50/40">
                    <p className="font-mono font-semibold text-blue-700 mb-1">
                      v{req.versionNumber} Current
                    </p>
                    <p className="font-semibold text-slate-900">{req.title}</p>
                    <p className="mt-1 text-slate-700">{req.description}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Comments */}
            <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Engineering Discussion</h2>
              <div className="space-y-3">
                {comments.map((c) => (
                  <div key={c.id} className="text-xs border-b border-slate-100 pb-2.5">
                    <div className="flex justify-between text-slate-500">
                      <span className="font-semibold text-slate-800">{c.authorName}</span>
                      <span className="font-mono">{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 text-slate-700">{c.body}</p>
                  </div>
                ))}
              </div>
              <form onSubmit={handleAddComment} className="flex gap-2">
                <input
                  type="text"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder="Add technical review note..."
                  className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-md"
                />
                <button type="submit" className="px-4 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-md">
                  Post
                </button>
              </form>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Linked Code Artifacts</h3>
              {linkedArtifacts.length === 0 ? (
                <p className="text-xs text-slate-500">No source files mapped yet.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {linkedArtifacts.map((a) => (
                    <li key={a.id} className="border-b border-slate-100 pb-2">
                      <p className="font-mono font-medium text-slate-900">{a.name}</p>
                      <p className="text-slate-500">{a.filePath} · {a.artifactType}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Linked Test Cases</h3>
              {linkedTests.length === 0 ? (
                <p className="text-xs text-slate-500">No test cases linked yet.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {linkedTests.map((t) => (
                    <li key={t.id} className="border-b border-slate-100 pb-2">
                      <p className="font-mono text-blue-700">{t.tcCode}</p>
                      <p className="font-medium text-slate-900">{t.title}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
