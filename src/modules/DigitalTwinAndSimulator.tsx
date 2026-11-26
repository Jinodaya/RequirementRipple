import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, FlaskConical, Trash2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { EmptyState, StatusIndicator, TableSkeleton } from '../components/StatusText';

export function DigitalTwinPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['digital-twin-snapshots', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () =>
      apiRequest<{
        snapshots: Array<{
          id: string;
          label: string;
          description: string;
          nodes: unknown[];
          edges: unknown[];
          metrics: { nodeCount: number; edgeCount: number; inferredEdgeCount: number; cycleCount: number; maxDepth: number };
          repoSyncStatus: string;
          createdByName: string;
          createdAt: string;
        }>;
      }>(`/api/projects/${activeProjectId}/digital-twin/snapshots`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to inspect its Change Impact Digital Twin."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  const snapshots = data?.snapshots || [];

  async function handleCreateSnapshot(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/projects/${activeProjectId}/digital-twin/snapshots`, {
        method: 'POST',
        body: JSON.stringify({ label, description }),
      });
      setLabel('');
      setDescription('');
      await queryClient.invalidateQueries({ queryKey: ['digital-twin-snapshots', activeProjectId] });
      pushToast('success', 'Versioned Digital Twin snapshot captured.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to capture snapshot.');
    }
  }

  const comparePair = selectedIds.length === 2
    ? [snapshots.find((s) => s.id === selectedIds[0]), snapshots.find((s) => s.id === selectedIds[1])]
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          Change Impact Digital Twin
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Synchronized virtual representation of requirements, code artifacts, APIs, and database dependencies with historical state snapshots.
        </p>
      </div>

      <form onSubmit={handleCreateSnapshot} className="bg-white border border-slate-200 rounded-lg p-5 flex flex-wrap items-end gap-4">
        <div className="w-56">
          <label className="block text-xs font-medium text-slate-700 mb-1">Snapshot Tag</label>
          <input
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="v1.1-pre-settlement"
            className="w-full px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
          />
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium text-slate-700 mb-1">Baseline Notes</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Architecture state prior to session concurrency update"
            className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" />
          <span>Capture Twin Snapshot</span>
        </button>
      </form>

      {comparePair && comparePair[0] && comparePair[1] && (
        <div className="bg-white border border-blue-200 rounded-lg p-5 space-y-2 text-xs">
          <h2 className="text-sm font-semibold text-slate-900">
            Digital Twin Comparison: {comparePair[0].label} vs {comparePair[1].label}
          </h2>
          <div className="grid sm:grid-cols-4 gap-4 pt-2 font-mono tabular-nums">
            <div>Nodes Delta: {comparePair[1].metrics.nodeCount - comparePair[0].metrics.nodeCount}</div>
            <div>Edges Delta: {comparePair[1].metrics.edgeCount - comparePair[0].metrics.edgeCount}</div>
            <div>Inferred Delta: {comparePair[1].metrics.inferredEdgeCount - comparePair[0].metrics.inferredEdgeCount}</div>
            <div>Cycles Delta: {comparePair[1].metrics.cycleCount - comparePair[0].metrics.cycleCount}</div>
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={4} />
      ) : snapshots.length === 0 ? (
        <EmptyState
          title="No Digital Twin snapshots yet"
          description="Capture a versioned graph snapshot to track architectural evolution and compare states over time."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {snapshots.map((snap) => (
            <div key={snap.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(snap.id)}
                    onChange={(e) =>
                      setSelectedIds((prev) =>
                        e.target.checked ? [...prev.slice(-1), snap.id] : prev.filter((x) => x !== snap.id)
                      )
                    }
                    title="Select 2 snapshots to compare"
                  />
                  <span className="font-mono text-sm font-bold text-slate-900">{snap.label}</span>
                  <StatusIndicator status={snap.repoSyncStatus} />
                </div>
                <p className="text-xs text-slate-600">{snap.description || 'Captured architecture state.'}</p>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {snap.metrics.nodeCount} nodes · {snap.metrics.edgeCount} edges · {snap.metrics.inferredEdgeCount} inferred · max depth {snap.metrics.maxDepth} · {new Date(snap.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/app/simulator')}
                className="px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap"
              >
                Run What-If on Twin
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ScenarioSimulatorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mutationType, setMutationType] = useState<'remove_node' | 'modify_node' | 'add_edge'>('remove_node');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [secondNodeId, setSecondNodeId] = useState('');
  const [simulating, setSimulating] = useState(false);

  const { data: graphData } = useQuery({
    queryKey: ['graph-for-sim', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ nodes: Array<{ id: string; name: string; nodeType: string }> }>(`/api/projects/${activeProjectId}/graph`),
  });

  const { data: scenariosData, isLoading } = useQuery({
    queryKey: ['scenarios', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () => apiRequest<{ scenarios: any[] }>(`/api/projects/${activeProjectId}/scenarios`),
  });

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to run isolated hypothetical what-if scenarios."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  const nodes = graphData?.nodes || [];
  const scenarios = scenariosData?.scenarios || [];

  async function handleRunSimulation(e: React.FormEvent) {
    e.preventDefault();
    if (!targetNodeId) return;
    setSimulating(true);
    try {
      const mutation =
        mutationType === 'add_edge'
          ? { type: 'add_edge', sourceNodeId: targetNodeId, targetNodeId: secondNodeId, relationshipType: 'depends_on' }
          : mutationType === 'modify_node'
          ? { type: 'modify_node', nodeId: targetNodeId, newCriticality: 'critical' }
          : { type: 'remove_node', nodeId: targetNodeId };

      await apiRequest(`/api/projects/${activeProjectId}/scenarios`, {
        method: 'POST',
        body: JSON.stringify({ name, description, mutations: [mutation] }),
      });
      setName('');
      setDescription('');
      await queryClient.invalidateQueries({ queryKey: ['scenarios', activeProjectId] });
      pushToast('success', 'Virtual scenario simulated without altering real project graph.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Simulation failed.');
    } finally {
      setSimulating(false);
    }
  }

  async function handleDeleteScenario(id: string) {
    await apiRequest(`/api/projects/${activeProjectId}/scenarios/${id}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: ['scenarios', activeProjectId] });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
          What-If Scenario Simulator
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Clones your dependency graph into an isolated virtual sandbox to simulate removals or architectural rewiring without modifying approved project baselines.
        </p>
      </div>

      <form onSubmit={handleRunSimulation} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Configure Hypothetical Scenario</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Scenario Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What happens if authGateway.ts is removed?"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Virtual Mutation</label>
            <select
              value={mutationType}
              onChange={(e) => setMutationType(e.target.value as any)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="remove_node">Remove Component / Node</option>
              <option value="modify_node">Escalate Criticality / Modify</option>
              <option value="add_edge">Inject New Dependency Link</option>
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {mutationType === 'add_edge' ? 'Source Component' : 'Target Component'}
            </label>
            <select
              required
              value={targetNodeId}
              onChange={(e) => setTargetNodeId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            >
              <option value="">Select graph node...</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  [{n.nodeType}] {n.name}
                </option>
              ))}
            </select>
          </div>
          {mutationType === 'add_edge' ? (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Destination Component</label>
              <select
                required
                value={secondNodeId}
                onChange={(e) => setSecondNodeId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value="">Select destination node...</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    [{n.nodeType}] {n.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Hypothesis Notes</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Evaluate microservice extraction or deprecation..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={simulating}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>{simulating ? 'Simulating Virtual Graph...' : 'Run Isolated Simulation'}</span>
          </button>
        </div>
      </form>

      {isLoading ? (
        <TableSkeleton rows={4} />
      ) : scenarios.length === 0 ? (
        <EmptyState
          title="No simulations run yet"
          description="Select a component above and run a virtual mutation to compare blast radius and risk delta side by side."
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {scenarios.map((sc) => (
            <div key={sc.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{sc.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{sc.description || 'Virtual graph scenario'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteScenario(sc.id)}
                  className="p-1 text-slate-400 hover:text-red-600"
                  title="Delete scenario"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded border border-slate-200">
                {sc.reportSummary}
              </p>

              <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
                <div className="p-2.5 border border-slate-200 rounded">
                  <p className="text-[11px] text-slate-500 font-sans">Baseline Nodes</p>
                  <p className="text-sm font-bold text-slate-900">{sc.baselineMetrics?.nodeCount ?? 0}</p>
                </div>
                <div className="p-2.5 border border-slate-200 rounded">
                  <p className="text-[11px] text-slate-500 font-sans">Simulated Nodes</p>
                  <p className="text-sm font-bold text-slate-900">{sc.simulatedMetrics?.nodeCount ?? 0}</p>
                </div>
                <div className="p-2.5 border border-slate-200 rounded">
                  <p className="text-[11px] text-slate-500 font-sans">Risk Delta</p>
                  <p className={`text-sm font-bold ${sc.riskDelta > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {sc.riskDelta >= 0 ? `+${sc.riskDelta}` : sc.riskDelta}
                  </p>
                </div>
              </div>

              {sc.affectedNodes?.length > 0 && (
                <div className="text-xs">
                  <p className="font-semibold text-slate-800 mb-1.5">
                    Affected Nodes ({sc.affectedNodes.length})
                  </p>
                  <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded">
                    {sc.affectedNodes.map((an: any, idx: number) => (
                      <div key={idx} className="px-3 py-1.5 flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-slate-800">{an.name}</span>
                        <span className="font-mono text-[11px] text-slate-500 shrink-0">
                          hop {an.hopDistance} · {Math.round(an.confidence * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
