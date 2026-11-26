import React, { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { EmptyState, StatusIndicator, TableSkeleton } from '../components/StatusText';

interface ChangeListItem {
  id: string;
  crCode: string;
  changeCategory: string;
  title: string;
  priority: string;
  approvalStatus: string;
  requesterName: string;
  impactScore: number | null;
  riskLevel: string | null;
  totalBlastRadius: number | null;
  recommendation: string | null;
  createdAt: string;
}

export function ChangeRequestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preselectedReqId = searchParams.get('requirementId') || '';
  const { activeProjectId, pushToast } = useAuthStore();

  const [showCreate, setShowCreate] = useState(Boolean(preselectedReqId));
  const [requirementId, setRequirementId] = useState(preselectedReqId);
  const [changeCategory, setChangeCategory] = useState('Modification');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [proposedTitle, setProposedTitle] = useState('');
  const [proposedDescription, setProposedDescription] = useState('');
  const [proposedCriteriaText, setProposedCriteriaText] = useState('');
  const [priority, setPriority] = useState('high');
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['changes', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ changes: ChangeListItem[] }>(`/api/projects/${activeProjectId}/changes`),
  });

  const { data: reqsData } = useQuery({
    queryKey: ['requirements-for-cr', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () =>
      apiRequest<{
        requirements: Array<{ id: string; reqCode: string; title: string; description: string; acceptanceCriteria: string[] }>;
      }>(`/api/projects/${activeProjectId}/requirements`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="Select a project first"
        description="Choose an active project to submit and inspect change requests."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  const requirements = reqsData?.requirements || [];
  const changes = data?.changes || [];

  function handleSelectRequirement(id: string) {
    setRequirementId(id);
    const found = requirements.find((r) => r.id === id);
    if (found) {
      setProposedTitle(found.title);
      setProposedDescription(found.description);
      setProposedCriteriaText(found.acceptanceCriteria.join('\n'));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiRequest<{ id: string; crCode: string; impactScore: number }>(
        `/api/projects/${activeProjectId}/changes`,
        {
          method: 'POST',
          body: JSON.stringify({
            requirementId: requirementId || null,
            changeCategory,
            title,
            reason,
            proposedTitle: proposedTitle || title,
            proposedDescription,
            proposedAcceptanceCriteria: proposedCriteriaText.split('\n').map((s) => s.trim()).filter(Boolean),
            priority,
            useAiSummary: true,
          }),
        }
      );
      await queryClient.invalidateQueries({ queryKey: ['changes', activeProjectId] });
      pushToast('success', `${res.crCode} submitted — Impact Score: ${res.impactScore}/100`);
      navigate(`/app/changes/${res.id}`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            Change Requests & Impact Queue
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Every submitted change automatically triggers the 10-step dependency traversal, conflict scan, and effort estimation pipeline.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Propose Change</span>
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Submit Change Request for Automated Impact Analysis</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Target Requirement</label>
              <select
                value={requirementId}
                onChange={(e) => handleSelectRequirement(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="">Net-new capability (not linked to existing REQ)</option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.reqCode} — {r.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Change Category</label>
              <select
                value={changeCategory}
                onChange={(e) => setChangeCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                {['Addition', 'Modification', 'Removal', 'Replacement', 'Enhancement'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Change Summary Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enforce strict single active session per user"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
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
            <label className="block text-xs font-medium text-slate-700 mb-1">Business / Security Rationale</label>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this change requested?"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Proposed Requirement Specification</label>
            <textarea
              rows={3}
              required
              value={proposedDescription}
              onChange={(e) => setProposedDescription(e.target.value)}
              placeholder="Write the full proposed requirement text..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Proposed Acceptance Criteria (one per line)</label>
            <textarea
              rows={2}
              value={proposedCriteriaText}
              onChange={(e) => setProposedCriteriaText(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
          </div>

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
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
            >
              {submitting ? 'Running 10-Step Impact Analysis...' : 'Submit & Analyze Impact'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : changes.length === 0 ? (
        <EmptyState
          title="No change requests yet"
          description="Propose a modification to an existing requirement to see automated dependency blast radius, conflicts, and effort estimates."
          actionLabel="Propose First Change"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">CR Code</th>
                <th className="py-3 px-3">Title & Category</th>
                <th className="py-3 px-3 text-right">Impact Score</th>
                <th className="py-3 px-3 text-right">Blast Radius</th>
                <th className="py-3 px-3">Risk</th>
                <th className="py-3 px-3">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {changes.map((cr) => (
                <tr
                  key={cr.id}
                  onClick={() => navigate(`/app/changes/${cr.id}`)}
                  className="hover:bg-slate-50 cursor-pointer"
                >
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-blue-700 whitespace-nowrap">
                    {cr.crCode}
                  </td>
                  <td className="py-3 px-3">
                    <p className="font-medium text-slate-900">{cr.title}</p>
                    <p className="text-xs text-slate-500">
                      {cr.changeCategory} · {cr.requesterName}
                    </p>
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs tabular-nums font-semibold">
                    {cr.impactScore ?? '—'}/100
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs tabular-nums">
                    {cr.totalBlastRadius ?? 0} artifacts
                  </td>
                  <td className="py-3 px-3">
                    {cr.riskLevel ? <StatusIndicator status={cr.riskLevel} /> : '—'}
                  </td>
                  <td className="py-3 px-3">
                    <StatusIndicator status={cr.approvalStatus} />
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

export function ImpactAnalysisDetailPage() {
  const { crId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();

  const [decisionReason, setDecisionReason] = useState('');
  const [hoursDirect, setHoursDirect] = useState(4);
  const [hoursIndirect, setHoursIndirect] = useState(1.5);
  const [reanalyzing, setReanalyzing] = useState(false);

  // If user navigated to /app/impact directly without crId, pick latest CR from changes list
  const { data: listData } = useQuery({
    queryKey: ['changes-for-impact', activeProjectId],
    enabled: Boolean(activeProjectId && !crId),
    queryFn: () => apiRequest<{ changes: ChangeListItem[] }>(`/api/projects/${activeProjectId}/changes`),
  });

  const resolvedCrId = crId || listData?.changes?.[0]?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['change-detail', activeProjectId, resolvedCrId],
    enabled: Boolean(activeProjectId && resolvedCrId),
    queryFn: () => apiRequest<any>(`/api/projects/${activeProjectId}/changes/${resolvedCrId}`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to inspect change impact reports."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  if (!crId && listData && listData.changes.length === 0) {
    return (
      <EmptyState
        title="No impact reports generated yet"
        description="Submit a Change Request to generate a 10-step dependency blast radius and effort report."
        actionLabel="Submit Change Request"
        onAction={() => navigate('/app/changes')}
      />
    );
  }

  if (isLoading || !data) return <TableSkeleton rows={6} />;

  const { changeRequest: cr, impactAnalysis: ia, impactedArtifacts, historicalMatches } = data;

  async function handleRecalculate() {
    setReanalyzing(true);
    try {
      await apiRequest(`/api/projects/${activeProjectId}/changes/${resolvedCrId}/analyze`, {
        method: 'POST',
        body: JSON.stringify({
          assumptions: {
            hoursPerDirectArtifact: hoursDirect,
            hoursPerIndirectArtifact: hoursIndirect,
          },
          useAiSummary: true,
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['change-detail', activeProjectId, resolvedCrId] });
      pushToast('success', 'Impact analysis and effort estimate recalculated.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Recalculation failed.');
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleDecision(decision: 'approved' | 'rejected' | 'clarification_requested') {
    if (decisionReason.trim().length < 5) {
      pushToast('error', 'Please enter a rationale (at least 5 characters) before recording a decision.');
      return;
    }
    try {
      await apiRequest(`/api/projects/${activeProjectId}/changes/${resolvedCrId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: decisionReason }),
      });
      setDecisionReason('');
      await queryClient.invalidateQueries({ queryKey: ['change-detail', activeProjectId, resolvedCrId] });
      pushToast('success', `Change request marked ${decision.replace(/_/g, ' ')}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Decision failed.');
    }
  }

  async function handleGenerateTests() {
    if (!cr.requirementId) {
      pushToast('info', 'Link this change request to a base requirement to auto-generate test cases.');
      return;
    }
    try {
      const res = await apiRequest<{ generatedCount: number; provider: string }>(
        `/api/projects/${activeProjectId}/tests/generate`,
        {
          method: 'POST',
          body: JSON.stringify({ requirementId: cr.requirementId, changeRequestId: cr.id }),
        }
      );
      pushToast('success', `Generated ${res.generatedCount} test cases (${res.provider}).`);
      navigate('/app/tests');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Test generation failed.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/app/changes')}
            className="p-2 border border-slate-300 bg-white rounded-md hover:bg-slate-50"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <p className="text-xs font-mono text-blue-700 font-semibold">
              {cr.crCode} · {cr.changeCategory} · Priority: {cr.priority}
            </p>
            <h1 className="text-xl font-bold text-slate-900 font-display">{cr.title}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGenerateTests}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
          >
            Generate Impacted Test Cases
          </button>
          <button
            type="button"
            onClick={handleRecalculate}
            disabled={reanalyzing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{reanalyzing ? 'Analyzing...' : 'Re-Run Analysis'}</span>
          </button>
        </div>
      </div>

      {ia && (
        <>
          {/* Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Impact Score</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">{ia.impactScore}/100</p>
              <div className="mt-1"><StatusIndicator status={ia.riskLevel} /></div>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Blast Radius</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">{ia.totalBlastRadius}</p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums">
                {ia.directCount} direct · {ia.indirectCount} indirect · {ia.potentialCount} potential
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Estimated Effort</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {ia.effortEstimate?.totalHours ?? 0}h
              </p>
              <p className="mt-1 text-xs text-slate-500 capitalize">
                {ia.effortEstimate?.complexity || 'medium'} complexity (estimate)
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Confidence</p>
              <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                {Math.round((ia.confidence || 0) * 100)}%
              </p>
              <p className="mt-1 text-xs text-slate-500">Engine: {ia.aiProvider}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <p className="text-xs text-slate-500">Recommended Action</p>
              <div className="mt-2"><StatusIndicator status={ia.recommendation} /></div>
              <p className="mt-2 text-xs text-slate-500">Human approval required</p>
            </div>
          </div>

          {/* Explanation & Semantic Diff */}
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Explainable Impact & Scoring Evidence</h2>
              <p className="text-sm text-slate-700 leading-relaxed">{ia.explanation}</p>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs font-mono text-slate-700 space-y-1">
                <p><strong>Formula:</strong> {ia.scoringBreakdown?.formula}</p>
                <p className="tabular-nums">
                  Direct: +{ia.scoringBreakdown?.directContribution} · Indirect: +{ia.scoringBreakdown?.indirectContribution} · Criticality: +{ia.scoringBreakdown?.criticalityBonus} · Conflicts: +{ia.scoringBreakdown?.conflictPenalty} · History: +{ia.scoringBreakdown?.historyRiskPenalty}
                </p>
              </div>

              {ia.conflicts.length > 0 && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded text-xs space-y-1">
                  <p className="font-semibold text-red-900">Detected Requirement Conflicts ({ia.conflicts.length})</p>
                  {ia.conflicts.map((c: any, idx: number) => (
                    <p key={idx} className="text-red-800">
                      <strong>{c.conflictType}:</strong> {c.explanation}
                    </p>
                  ))}
                </div>
              )}

              {ia.missingDependencies.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded text-xs space-y-1">
                  <p className="font-semibold text-amber-900">Coverage & Dependency Gaps</p>
                  <ul className="list-disc list-inside text-amber-800">
                    {ia.missingDependencies.map((m: string, idx: number) => (
                      <li key={idx}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Baseline vs Proposed Diff + Effort Assumptions */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs">
                <h2 className="text-sm font-semibold text-slate-900">Requirement Semantic Diff</h2>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                  <p className="font-semibold text-slate-600">Original Baseline</p>
                  <p className="mt-1 text-slate-800">{cr.originalSnapshot?.description || 'Net-new requirement'}</p>
                </div>
                <div className="p-3 bg-blue-50/40 border border-blue-200 rounded">
                  <p className="font-semibold text-blue-800">Proposed Change</p>
                  <p className="mt-1 text-slate-900">{cr.proposedDescription}</p>
                </div>
                <p className="text-slate-600">
                  <strong>Added terms:</strong> {(ia.semanticDiff?.addedTerms || []).join(', ') || 'None'}
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs">
                <h2 className="text-sm font-semibold text-slate-900">Effort Estimation Assumptions</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-600 mb-1">Hours / Direct Artifact</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={hoursDirect}
                      onChange={(e) => setHoursDirect(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Hours / Indirect Artifact</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={hoursIndirect}
                      onChange={(e) => setHoursIndirect(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded font-mono"
                    />
                  </div>
                </div>
                <p className="text-slate-500">{ia.effortEstimate?.disclaimer}</p>
              </div>
            </div>
          </div>

          {/* Impacted Artifacts Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Impacted Artifacts & Evidence</h2>
              <span className="text-xs text-slate-500 tabular-nums">{impactedArtifacts.length} discovered</span>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4">Artifact</th>
                  <th className="py-2.5 px-3">Tier / Hop</th>
                  <th className="py-2.5 px-3">Relationship & Evidence</th>
                  <th className="py-2.5 px-3 text-right">Confidence</th>
                  <th className="py-2.5 px-3">Risk</th>
                  <th className="py-2.5 px-4">Recommended Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {impactedArtifacts.map((art: any) => (
                  <tr key={art.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-900">
                      <p>{art.artifact_name}</p>
                      <p className="text-slate-500 font-normal">{art.artifact_type.replace(/_/g, ' ')}</p>
                    </td>
                    <td className="py-3 px-3 font-mono whitespace-nowrap">
                      {art.impact_tier} (hop {art.hop_distance})
                    </td>
                    <td className="py-3 px-3 max-w-md">
                      <p className="font-medium text-slate-800">{art.relationship}</p>
                      <p className="text-slate-500 mt-0.5">{art.evidence}</p>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      {Math.round(art.confidence * 100)}%
                    </td>
                    <td className="py-3 px-3">
                      <StatusIndicator status={art.risk_level} />
                    </td>
                    <td className="py-3 px-4 text-slate-700">{art.recommended_action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Decision Intelligence & Human Approval */}
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Decision Intelligence & Approval Gate</h2>
              <StatusIndicator status={cr.approvalStatus} />
            </div>
            {cr.decisionReason && (
              <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded border border-slate-200">
                <strong>Recorded Decision Rationale ({cr.reviewerName || 'Reviewer'}):</strong> {cr.decisionReason}
              </p>
            )}
            {historicalMatches.length > 0 && (
              <div className="text-xs text-slate-600">
                <strong>Recent Historical Context:</strong> {historicalMatches[0].title} ({historicalMatches[0].outcome}) —{' '}
                {historicalMatches[0].lessonsLearned || historicalMatches[0].resolution}
              </div>
            )}
            <div className="space-y-3">
              <textarea
                rows={2}
                value={decisionReason}
                onChange={(e) => setDecisionReason(e.target.value)}
                placeholder="Document justification, risk mitigation plan, or required clarification..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleDecision('approved')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md"
                >
                  Approve Change
                </button>
                <button
                  type="button"
                  onClick={() => handleDecision('clarification_requested')}
                  className="px-4 py-2 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 rounded-md"
                >
                  Request Clarification
                </button>
                <button
                  type="button"
                  onClick={() => handleDecision('rejected')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
                >
                  Reject Change
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
