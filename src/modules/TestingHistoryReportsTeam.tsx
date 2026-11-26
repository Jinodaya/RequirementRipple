import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Play, Printer, Sparkles, UserPlus } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { EmptyState, StatusIndicator, TableSkeleton } from '../components/StatusText';

export function TestManagementPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();
  const [selectedReqId, setSelectedReqId] = useState('');
  const [generating, setGenerating] = useState(false);

  const { data: testsData, isLoading } = useQuery({
    queryKey: ['tests', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ testCases: any[] }>(`/api/projects/${activeProjectId}/tests`),
  });

  const { data: reqsData } = useQuery({
    queryKey: ['reqs-for-tests', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () =>
      apiRequest<{ requirements: Array<{ id: string; reqCode: string; title: string }> }>(
        `/api/projects/${activeProjectId}/requirements`
      ),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to manage and generate test cases."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  async function handleGenerate() {
    if (!selectedReqId) return;
    setGenerating(true);
    try {
      const res = await apiRequest<{ generatedCount: number; provider: string; note: string }>(
        `/api/projects/${activeProjectId}/tests/generate`,
        {
          method: 'POST',
          body: JSON.stringify({ requirementId: selectedReqId }),
        }
      );
      await queryClient.invalidateQueries({ queryKey: ['tests', activeProjectId] });
      pushToast('success', `Generated ${res.generatedCount} test cases (${res.provider}).`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleApproveTest(testId: string) {
    await apiRequest(`/api/projects/${activeProjectId}/tests/${testId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    });
    await queryClient.invalidateQueries({ queryKey: ['tests', activeProjectId] });
    pushToast('success', 'Test case approved.');
  }

  async function handleRecordExecution(testId: string, outcome: 'passed' | 'failed') {
    await apiRequest(`/api/projects/${activeProjectId}/tests/${testId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ outcome, notes: `Recorded via QA console` }),
    });
    await queryClient.invalidateQueries({ queryKey: ['tests', activeProjectId] });
    pushToast('success', `Test execution logged: ${outcome}.`);
  }

  function handleExportCsv() {
    const rows = testsData?.testCases || [];
    const header = ['Code', 'Title', 'Type', 'Priority', 'Status', 'Last Outcome', 'Expected Result'];
    const lines = [
      header.join(','),
      ...rows.map((t) =>
        [t.tcCode, t.title, t.testType, t.priority, t.status, t.lastOutcome || 'not_run', t.expectedResult]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-cases-${activeProjectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">Test Management</h1>
          <p className="mt-1 text-sm text-slate-600">
            Generate Positive, Negative, Boundary, Security, and Regression test suggestions and track QA executions.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50"
        >
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <select
          value={selectedReqId}
          onChange={(e) => setSelectedReqId(e.target.value)}
          className="flex-1 min-w-[240px] px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
        >
          <option value="">Select requirement to generate test suite...</option>
          {(reqsData?.requirements || []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.reqCode} — {r.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedReqId || generating}
          onClick={handleGenerate}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{generating ? 'Generating Suite...' : 'Generate AI Test Cases'}</span>
        </button>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {(testsData?.testCases || []).map((tc) => (
            <div key={tc.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-blue-700">{tc.tcCode}</span>
                  <span>·</span>
                  <span className="font-medium text-slate-700">{tc.testType}</span>
                  <span>·</span>
                  <span className="capitalize text-slate-500">{tc.priority}</span>
                  <span>·</span>
                  <StatusIndicator status={tc.status} />
                  {tc.lastOutcome && (
                    <>
                      <span>·</span>
                      <StatusIndicator status={tc.lastOutcome} />
                    </>
                  )}
                </div>
                <p className="text-sm font-semibold text-slate-900">{tc.title}</p>
                <p className="text-xs text-slate-600">{tc.expectedResult}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {tc.status === 'suggested' && (
                  <button
                    type="button"
                    onClick={() => handleApproveTest(tc.id)}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 rounded-md"
                  >
                    Approve
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRecordExecution(tc.id, 'passed')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-md"
                >
                  <Play className="w-3 h-3" /> Log Pass
                </button>
                <button
                  type="button"
                  onClick={() => handleRecordExecution(tc.id, 'failed')}
                  className="px-2.5 py-1.5 text-xs font-medium text-red-800 border border-red-200 bg-red-50 rounded-md"
                >
                  Log Fail
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoricalIntelligencePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('high');
  const [rootCause, setRootCause] = useState('');
  const [components, setComponents] = useState('');
  const [resolution, setResolution] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['history', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ historicalChanges: any[]; incidents: any[] }>(`/api/projects/${activeProjectId}/history`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to view historical change outcomes and incident intelligence."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  async function handleLogIncident(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/projects/${activeProjectId}/incidents`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          severity,
          rootCause,
          affectedComponents: components.split(',').map((s) => s.trim()).filter(Boolean),
          resolution,
        }),
      });
      setShowAdd(false);
      setTitle('');
      setRootCause('');
      setComponents('');
      setResolution('');
      await queryClient.invalidateQueries({ queryKey: ['history', activeProjectId] });
      pushToast('success', 'Production incident logged for future risk correlation.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to log incident.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            Historical Failure Intelligence
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Learns from verified change outcomes, estimation accuracy, and past production incidents to warn teams before risky modifications.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md"
        >
          Log Incident Record
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleLogIncident} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 text-xs">
          <div className="grid sm:grid-cols-3 gap-3">
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Incident title"
              className="sm:col-span-2 px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-md bg-white text-sm"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <input
            type="text"
            required
            value={components}
            onChange={(e) => setComponents(e.target.value)}
            placeholder="Affected components (comma-separated, e.g. authGateway.ts, POST /api/payments/settle)"
            className="w-full px-3 py-2 border border-slate-300 rounded-md"
          />
          <textarea
            rows={2}
            required
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            placeholder="Root cause analysis..."
            className="w-full px-3 py-2 border border-slate-300 rounded-md"
          />
          <textarea
            rows={2}
            required
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Resolution & preventive action..."
            className="w-full px-3 py-2 border border-slate-300 rounded-md"
          />
          <button type="submit" className="px-4 py-2 bg-blue-700 text-white font-semibold rounded-md">
            Save Incident
          </button>
        </form>
      )}

      {isLoading ? (
        <TableSkeleton rows={5} />
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Production Incidents & Root Causes</h2>
            {(data?.incidents || []).length === 0 ? (
              <p className="text-xs text-slate-500">No production incidents logged.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs space-y-3">
                {data!.incidents.map((inc) => (
                  <div key={inc.id} className="pt-3 first:pt-0 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{inc.title}</span>
                      <StatusIndicator status={inc.severity} />
                    </div>
                    <p className="text-slate-700"><strong>Root cause:</strong> {inc.rootCause}</p>
                    <p className="text-slate-600"><strong>Resolution:</strong> {inc.resolution}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      Components: {inc.affectedComponents.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Change Outcome Ledger</h2>
            {(data?.historicalChanges || []).length === 0 ? (
              <p className="text-xs text-slate-500">No historical change outcomes recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 text-xs space-y-3">
                {data!.historicalChanges.map((hc) => (
                  <div key={hc.id} className="pt-3 first:pt-0 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{hc.title}</span>
                      <StatusIndicator status={hc.outcome} />
                    </div>
                    <p className="text-slate-600">{hc.lessonsLearned || hc.resolution}</p>
                    <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                      Est: {hc.estimatedEffortHours}h · Actual: {hc.actualEffortHours}h
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportsPage() {
  const navigate = useNavigate();
  const { activeProjectId } = useAuthStore();

  const { data: analytics } = useQuery({
    queryKey: ['report-analytics', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<any>(`/api/projects/${activeProjectId}/analytics`),
  });

  const { data: reqs } = useQuery({
    queryKey: ['report-reqs', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ requirements: any[] }>(`/api/projects/${activeProjectId}/requirements`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to generate and export engineering reports."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  function downloadJson(filename: string, payload: unknown) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            Reports & Specification Exports
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Export timestamped, evidence-backed requirement specifications, analytics, and printable PDF reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadJson(`requirements-spec-${activeProjectId}.json`, reqs?.requirements || [])}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md"
          >
            <Download className="w-3.5 h-3.5" /> Export Requirements JSON
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-md"
          >
            <Printer className="w-3.5 h-3.5" /> Print / Save PDF Report
          </button>
        </div>
      </div>

      {analytics && (
        <div className="bg-white border border-slate-200 rounded-lg p-8 space-y-6">
          <div className="border-b border-slate-200 pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Project Change Impact & Governance Report</h2>
              <p className="text-xs text-slate-500 font-mono">Generated {new Date().toISOString()}</p>
            </div>
            <span className="text-xs font-mono text-slate-600">RequirementRipple</span>
          </div>
          <div className="grid sm:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <p className="text-slate-500 font-sans">Active Requirements</p>
              <p className="text-lg font-bold text-slate-900">{analytics.summary.activeRequirements}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <p className="text-slate-500 font-sans">Avg Quality Score</p>
              <p className="text-lg font-bold text-slate-900">{analytics.summary.averageQualityScore}/100</p>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <p className="text-slate-500 font-sans">High-Risk CRs</p>
              <p className="text-lg font-bold text-slate-900">{analytics.summary.highRiskChanges}</p>
            </div>
            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <p className="text-slate-500 font-sans">Graph Nodes / Edges</p>
              <p className="text-lg font-bold text-slate-900">
                {analytics.graphMetrics.nodeCount} / {analytics.graphMetrics.edgeCount}
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Requirement Specification Register</h3>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 px-2">Title</th>
                  <th className="py-2 px-2">Category</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 pl-2 text-right">Quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(reqs?.requirements || []).map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-mono">{r.reqCode}</td>
                    <td className="py-2 px-2 font-medium">{r.title}</td>
                    <td className="py-2 px-2">{r.category}</td>
                    <td className="py-2 px-2">{r.status}</td>
                    <td className="py-2 pl-2 text-right font-mono tabular-nums">{r.qualityScore}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function TeamManagementPage() {
  const queryClient = useQueryClient();
  const { activeOrgId, pushToast } = useAuthStore();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Developer');

  const { data: membersData, isLoading } = useQuery({
    queryKey: ['org-members', activeOrgId],
    enabled: Boolean(activeOrgId),
    queryFn: () => apiRequest<{ members: any[]; availableRoles: string[] }>(`/api/orgs/${activeOrgId}/members`),
  });

  const { data: auditData } = useQuery({
    queryKey: ['org-audit', activeOrgId],
    enabled: Boolean(activeOrgId),
    queryFn: () => apiRequest<{ logs: any[] }>(`/api/orgs/${activeOrgId}/audit-logs`),
  });

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/orgs/${activeOrgId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteEmail('');
      await queryClient.invalidateQueries({ queryKey: ['org-members', activeOrgId] });
      pushToast('success', 'Team invitation recorded.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Invitation failed.');
    }
  }

  async function handleRoleChange(memberId: string, role: string) {
    try {
      await apiRequest(`/api/orgs/${activeOrgId}/members/${memberId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await queryClient.invalidateQueries({ queryKey: ['org-members', activeOrgId] });
      pushToast('success', `Role updated to ${role}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Role update failed.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          Team Management & RBAC Audit
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Invite team members and enforce least-privilege roles across Organization Owner, Administrator, Project Manager, Developer, Tester, and Viewer.
        </p>
      </div>

      <form onSubmit={handleInvite} className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-slate-700 mb-1">Colleague Email</label>
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="engineer@company.com"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
          >
            {(membersData?.availableRoles || ['Developer', 'Tester', 'Project Manager', 'Administrator', 'Viewer']).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
        >
          <UserPlus className="w-3.5 h-3.5" /> Invite Member
        </button>
      </form>

      {isLoading ? (
        <TableSkeleton rows={4} />
      ) : (
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4">Member</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-4">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {(membersData?.members || []).map((m) => (
                  <tr key={m.id}>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{m.name || m.email}</p>
                      <p className="text-slate-500">{m.email}</p>
                    </td>
                    <td className="py-3 px-3">
                      <StatusIndicator status={m.status} />
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.id, e.target.value)}
                        className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                      >
                        {(membersData?.availableRoles || []).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">Organization Audit Log</h2>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 text-xs">
              {(auditData?.logs || []).map((l) => (
                <div key={l.id} className="py-2">
                  <p className="font-medium text-slate-900">{l.action}</p>
                  <p className="text-slate-500">
                    {l.actorName || l.actorEmail || 'System'} · {new Date(l.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { user, setOrganizations, organizations, setActiveOrgId, pushToast } = useAuthStore();
  const [name, setName] = useState(user?.name || '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle || 'Software Architect');
  const [newOrgName, setNewOrgName] = useState('');

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name, jobTitle }),
      });
      pushToast('success', 'Profile settings updated.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Update failed.');
    }
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ organization: any }>('/api/orgs', {
        method: 'POST',
        body: JSON.stringify({ name: newOrgName }),
      });
      setOrganizations([...organizations, res.organization]);
      setActiveOrgId(res.organization.id);
      setNewOrgName('');
      pushToast('success', `Organization "${res.organization.name}" created.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to create organization.');
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">Workspace Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Manage your engineer profile and create additional isolated organizations.</p>
      </div>

      <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">User Profile</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Engineering Title</label>
            <input
              type="text"
              required
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
        </div>
        <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-md">
          Save Profile
        </button>
      </form>

      <form onSubmit={handleCreateOrg} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Create New Organization</h2>
        <div className="flex gap-3">
          <input
            type="text"
            required
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            placeholder="New division or client organization name"
            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
          <button type="submit" className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md">
            Create Organization
          </button>
        </div>
      </form>
    </div>
  );
}
