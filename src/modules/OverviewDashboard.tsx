import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { EmptyState, StatusIndicator, TableSkeleton } from '../components/StatusText';

interface AnalyticsPayload {
  summary: {
    activeRequirements: number;
    totalRequirements: number;
    averageQualityScore: number;
    pendingChangeRequests: number;
    approvedChanges: number;
    rejectedChanges: number;
    highRiskChanges: number;
    detectedConflicts: number;
    totalTestCases: number;
    passedExecutions: number;
    failedExecutions: number;
    historicalIncidents: number;
    historicalFailureRate: number;
  };
  graphMetrics: {
    nodeCount: number;
    edgeCount: number;
    inferredEdgeCount: number;
    verifiedEdgeCount: number;
    cycleCount: number;
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
  };
  categoryBreakdown: Array<{ name: string; count: number }>;
  riskBreakdown: Array<{ name: string; count: number }>;
  recentChanges: Array<{
    id: string;
    crCode: string;
    title: string;
    changeCategory: string;
    approvalStatus: string;
    impactScore: number | null;
    riskLevel: string | null;
    totalBlastRadius: number | null;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    createdAt: string;
    actorName: string;
  }>;
}

export function OverviewDashboard() {
  const navigate = useNavigate();
  const { activeProjectId } = useAuthStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-analytics', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<AnalyticsPayload>(`/api/projects/${activeProjectId}/analytics`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No active project selected"
        description="Create a new engineering project or provision the FinPay Core Ledger reference project to begin analyzing requirement dependencies and change impact."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
        <TableSkeleton rows={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-white border border-red-200 rounded-lg text-sm text-red-800">
        {error instanceof Error ? error.message : 'Unable to load project analytics.'}
      </div>
    );
  }

  const s = data.summary;
  const g = data.graphMetrics;

  const kpis = [
    { label: 'Active Requirements', value: s.activeRequirements, sub: `Avg quality ${s.averageQualityScore}/100` },
    { label: 'Pending Change Requests', value: s.pendingChangeRequests, sub: `${s.approvedChanges} approved · ${s.rejectedChanges} rejected` },
    { label: 'High-Risk Changes', value: s.highRiskChanges, sub: `${s.detectedConflicts} requirement conflict(s)` },
    { label: 'Dependency Graph', value: `${g.nodeCount} / ${g.edgeCount}`, sub: `${g.inferredEdgeCount} inferred · ${g.cycleCount} cycle(s)` },
    { label: 'Test Registry', value: s.totalTestCases, sub: `${s.passedExecutions} passed · ${s.failedExecutions} failed` },
    { label: 'Historical Incidents', value: s.historicalIncidents, sub: `${s.historicalFailureRate}% past incident rate` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
            Engineering Impact Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live project intelligence aggregated from requirements, dependency graph traversal, AST artifacts, and change history.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/app/dependencies')}
            className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
          >
            Explore Graph
          </button>
          <button
            type="button"
            onClick={() => navigate('/app/changes')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
          >
            Submit Change Request
          </button>
        </div>
      </div>

      {/* 6-Column KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs font-medium text-slate-500 truncate">{k.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums font-mono">{k.value}</p>
            <p className="mt-1 text-xs text-slate-500 tabular-nums truncate">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Requirements by Category</h2>
            <span className="text-xs text-slate-500 tabular-nums">{s.totalRequirements} total</span>
          </div>
          {data.categoryBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500 py-12 text-center">No requirements defined yet.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.categoryBreakdown} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Architectural Dependency Hubs</h2>
            <span className="text-xs text-slate-500 tabular-nums">Max depth {g.maxDepth}</span>
          </div>
          {g.topHubs.length === 0 ? (
            <p className="text-xs text-slate-500 py-12 text-center">No dependency nodes mapped yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-medium text-slate-500">
                    <th className="py-2 pr-3">Component</th>
                    <th className="py-2 px-2">Type</th>
                    <th className="py-2 px-2 text-right">In / Out</th>
                    <th className="py-2 pl-2 text-right">Reach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {g.topHubs.slice(0, 6).map((hub) => (
                    <tr key={hub.nodeId} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium text-slate-900 max-w-[200px] truncate">{hub.name}</td>
                      <td className="py-2.5 px-2 text-slate-500">{hub.nodeType.replace(/_/g, ' ')}</td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700">
                        {hub.inDegree} / {hub.outDegree}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {hub.reachabilityCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Recent Change Requests & Activity */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">Recent Change Requests</h2>
            <button
              type="button"
              onClick={() => navigate('/app/changes')}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              View all
            </button>
          </div>
          {data.recentChanges.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No change requests submitted yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-medium text-slate-500">
                    <th className="py-2 pr-3">ID</th>
                    <th className="py-2 px-2">Title</th>
                    <th className="py-2 px-2 text-right">Impact</th>
                    <th className="py-2 px-2">Risk</th>
                    <th className="py-2 pl-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.recentChanges.map((cr) => (
                    <tr
                      key={cr.id}
                      onClick={() => navigate(`/app/changes/${cr.id}`)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="py-2.5 pr-3 font-mono text-blue-700 whitespace-nowrap">{cr.crCode}</td>
                      <td className="py-2.5 px-2 font-medium text-slate-900 max-w-[220px] truncate">{cr.title}</td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-800">
                        {cr.impactScore ?? '—'}
                      </td>
                      <td className="py-2.5 px-2">
                        {cr.riskLevel ? <StatusIndicator status={cr.riskLevel} /> : '—'}
                      </td>
                      <td className="py-2.5 pl-2">
                        <StatusIndicator status={cr.approvalStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Audit Activity Stream</h2>
          {data.recentActivity.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">No audit events recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentActivity.map((act) => (
                <div key={act.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{act.action}</p>
                    <p className="text-slate-500 truncate">
                      {act.actorName || 'System'} · {act.entityType}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
                    {new Date(act.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
