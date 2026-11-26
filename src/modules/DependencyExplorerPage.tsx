import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  MarkerType,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Download, Plus, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { EmptyState, TableSkeleton } from '../components/StatusText';

interface ApiNode {
  id: string;
  nodeType: string;
  name: string;
  criticality: string;
  positionX: number;
  positionY: number;
}

interface ApiEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: string;
  isInferred: boolean;
  verified: boolean;
  confidence: number;
  evidence: string;
}

const NODE_COLORS: Record<string, { bg: string; border: string }> = {
  requirement: { bg: '#eff6ff', border: '#1d4ed8' },
  source_file: { bg: '#f8fafc', border: '#334155' },
  api_endpoint: { bg: '#eef2ff', border: '#4338ca' },
  db_collection: { bg: '#fefce8', border: '#ca8a04' },
  external_service: { bg: '#fff1f2', border: '#be123c' },
  test_case: { bg: '#ecfdf5', border: '#15803d' },
};

export function DependencyExplorerPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeProjectId, pushToast } = useAuthStore();

  const [search, setSearch] = useState('');
  const [relFilter, setRelFilter] = useState('all');
  const [showInferred, setShowInferred] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<ApiEdge | null>(null);
  const [bfsDepth, setBfsDepth] = useState(3);
  const [impactedIds, setImpactedIds] = useState<Set<string>>(new Set());

  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeType, setNewNodeType] = useState('module');
  const [newNodeCrit, setNewNodeCrit] = useState('medium');

  const [showAddEdge, setShowAddEdge] = useState(false);
  const [edgeSrc, setEdgeSrc] = useState('');
  const [edgeTgt, setEdgeTgt] = useState('');
  const [edgeRel, setEdgeRel] = useState('depends_on');

  const { data, isLoading } = useQuery({
    queryKey: ['dependency-graph', activeProjectId],
    enabled: Boolean(activeProjectId),
    queryFn: () =>
      apiRequest<{
        nodes: ApiNode[];
        edges: ApiEdge[];
        metrics: {
          nodeCount: number;
          edgeCount: number;
          inferredEdgeCount: number;
          cycleCount: number;
          cycles: string[][];
        };
        implementationOrder: string[];
      }>(`/api/projects/${activeProjectId}/graph`),
  });

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const filteredNodes = useMemo(() => {
    const raw = data?.nodes || [];
    if (!search.trim()) return raw;
    const q = search.toLowerCase();
    return raw.filter((n) => n.name.toLowerCase().includes(q) || n.nodeType.toLowerCase().includes(q));
  }, [data?.nodes, search]);

  const filteredEdges = useMemo(() => {
    const raw = data?.edges || [];
    const visibleIds = new Set(filteredNodes.map((n) => n.id));
    return raw.filter((e) => {
      if (!visibleIds.has(e.sourceNodeId) || !visibleIds.has(e.targetNodeId)) return false;
      if (!showInferred && e.isInferred) return false;
      if (relFilter !== 'all' && e.relationshipType !== relFilter) return false;
      return true;
    });
  }, [data?.edges, filteredNodes, showInferred, relFilter]);

  useEffect(() => {
    setRfNodes(
      filteredNodes.map((n, idx) => {
        const palette = NODE_COLORS[n.nodeType] || { bg: '#ffffff', border: '#64748b' };
        const isSelected = n.id === selectedNodeId;
        const isImpacted = impactedIds.has(n.id);
        return {
          id: n.id,
          position: {
            x: n.positionX || (idx % 4) * 260 + 40,
            y: n.positionY || Math.floor(idx / 4) * 130 + 40,
          },
          data: {
            label: (
              <div className="text-left">
                <div className="text-[10px] font-mono uppercase tracking-wide text-slate-500">
                  {n.nodeType.replace(/_/g, ' ')} · {n.criticality}
                </div>
                <div className="text-xs font-semibold text-slate-900 mt-0.5 leading-snug">{n.name}</div>
              </div>
            ),
          },
          style: {
            background: isImpacted ? '#fef2f2' : palette.bg,
            border: isSelected
              ? '2px solid #1d4ed8'
              : isImpacted
              ? '2px solid #dc2626'
              : `1px solid ${palette.border}`,
            borderRadius: 6,
            padding: '8px 12px',
            width: 215,
          },
        };
      })
    );

    setRfEdges(
      filteredEdges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        label: e.isInferred ? `${e.relationshipType} (inferred ${Math.round(e.confidence * 100)}%)` : e.relationshipType,
        animated: e.isInferred,
        style: {
          stroke: e.isInferred ? '#d97706' : '#334155',
          strokeDasharray: e.isInferred ? '5 4' : undefined,
          strokeWidth: 1.5,
        },
        labelStyle: { fontSize: 10, fill: e.isInferred ? '#92400e' : '#334155' },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: e.isInferred ? '#d97706' : '#334155',
        },
      }))
    );
  }, [filteredNodes, filteredEdges, selectedNodeId, impactedIds, setRfNodes, setRfEdges]);

  if (!activeProjectId) {
    return (
      <EmptyState
        title="No project selected"
        description="Select a project to explore its dependency graph."
        actionLabel="Go to Projects"
        onAction={() => navigate('/app/projects')}
      />
    );
  }

  if (isLoading || !data) return <TableSkeleton rows={6} />;

  async function handleNodeClick(_evt: React.MouseEvent, node: Node) {
    setSelectedNodeId(node.id);
    setSelectedEdge(null);
    try {
      const res = await apiRequest<{ impactedNodes: Array<{ nodeId: string }> }>(
        `/api/projects/${activeProjectId}/graph/traverse`,
        {
          method: 'POST',
          body: JSON.stringify({ startNodeId: node.id, maxDepth: bfsDepth }),
        }
      );
      setImpactedIds(new Set(res.impactedNodes.map((i) => i.nodeId)));
    } catch {
      setImpactedIds(new Set());
    }
  }

  function handleEdgeClick(_evt: React.MouseEvent, edge: Edge) {
    const found = data?.edges.find((e) => e.id === edge.id) || null;
    setSelectedEdge(found);
  }

  async function handleNodeDragStop(_evt: unknown, node: Node) {
    try {
      await apiRequest(`/api/projects/${activeProjectId}/graph/nodes/${node.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ positionX: node.position.x, positionY: node.position.y }),
      });
    } catch {
      // ignore transient layout drag error
    }
  }

  async function handleVerifyEdge(edgeId: string, verified: boolean) {
    try {
      await apiRequest(`/api/projects/${activeProjectId}/graph/edges/${edgeId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ verified }),
      });
      await queryClient.invalidateQueries({ queryKey: ['dependency-graph', activeProjectId] });
      setSelectedEdge(null);
      pushToast('success', verified ? 'Inferred dependency confirmed as verified.' : 'Marked as unverified.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Verification update failed.');
    }
  }

  async function handleAddNode(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/projects/${activeProjectId}/graph/nodes`, {
        method: 'POST',
        body: JSON.stringify({ name: newNodeName, nodeType: newNodeType, criticality: newNodeCrit }),
      });
      setNewNodeName('');
      setShowAddNode(false);
      await queryClient.invalidateQueries({ queryKey: ['dependency-graph', activeProjectId] });
      pushToast('success', 'Graph node added.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to add node.');
    }
  }

  async function handleAddEdge(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest(`/api/projects/${activeProjectId}/graph/edges`, {
        method: 'POST',
        body: JSON.stringify({ sourceNodeId: edgeSrc, targetNodeId: edgeTgt, relationshipType: edgeRel }),
      });
      setShowAddEdge(false);
      await queryClient.invalidateQueries({ queryKey: ['dependency-graph', activeProjectId] });
      pushToast('success', 'Verified dependency edge created.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to add edge.');
    }
  }

  function handleExportGraph() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dependency-graph-${activeProjectId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedApiNode = data.nodes.find((n) => n.id === selectedNodeId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">Dependency Explorer</h1>
          <p className="mt-1 text-sm text-slate-600">
            Click any node to highlight downstream BFS blast radius. Dashed amber links denote inferred dependencies awaiting human verification.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowAddNode((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add Node
          </button>
          <button
            type="button"
            onClick={() => setShowAddEdge((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" /> Link Nodes
          </button>
          <button
            type="button"
            onClick={handleExportGraph}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white rounded-md hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" /> Export JSON
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-4 text-xs">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nodes..."
          className="px-3 py-1.5 border border-slate-200 rounded-md w-48"
        />
        <select
          value={relFilter}
          onChange={(e) => setRelFilter(e.target.value)}
          className="px-2.5 py-1.5 border border-slate-200 rounded-md bg-white"
        >
          <option value="all">All Relationships</option>
          {['depends_on', 'implements', 'calls', 'reads_from', 'writes_to', 'tests', 'imports'].map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showInferred}
            onChange={(e) => setShowInferred(e.target.checked)}
          />
          <span>Show Inferred Edges ({data.metrics.inferredEdgeCount})</span>
        </label>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-slate-600 tabular-nums">BFS Depth: {bfsDepth}</span>
          <input
            type="range"
            min={1}
            max={6}
            value={bfsDepth}
            onChange={(e) => setBfsDepth(Number(e.target.value))}
          />
        </div>
      </div>

      {data.metrics.cycleCount > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-900">
          <strong>Circular Dependency Warning:</strong> Detected {data.metrics.cycleCount} cycle(s):{' '}
          {data.metrics.cycles.map((c) => c.join(' -> ')).join(' | ')}
        </div>
      )}

      {showAddNode && (
        <form onSubmit={handleAddNode} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end gap-3 text-xs">
          <div className="flex-1 min-w-[200px]">
            <label className="block font-medium text-slate-700 mb-1">Artifact / Module Name</label>
            <input
              type="text"
              required
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              placeholder="src/services/billing.ts"
              className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Node Type</label>
            <select
              value={newNodeType}
              onChange={(e) => setNewNodeType(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white"
            >
              {['requirement', 'module', 'source_file', 'function', 'api_endpoint', 'db_collection', 'test_case', 'external_service'].map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Criticality</label>
            <select
              value={newNodeCrit}
              onChange={(e) => setNewNodeCrit(e.target.value)}
              className="px-3 py-1.5 border border-slate-300 rounded-md bg-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <button type="submit" className="px-4 py-1.5 bg-blue-700 text-white font-semibold rounded-md">
            Save Node
          </button>
        </form>
      )}

      {showAddEdge && (
        <form onSubmit={handleAddEdge} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end gap-3 text-xs">
          <div className="flex-1 min-w-[180px]">
            <label className="block font-medium text-slate-700 mb-1">Source Node</label>
            <select
              required
              value={edgeSrc}
              onChange={(e) => setEdgeSrc(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
            >
              <option value="">Select source...</option>
              {data.nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Relationship</label>
            <select
              value={edgeRel}
              onChange={(e) => setEdgeRel(e.target.value)}
              className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
            >
              {['depends_on', 'implements', 'calls', 'reads_from', 'writes_to', 'tests', 'related_to'].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block font-medium text-slate-700 mb-1">Target Node</label>
            <select
              required
              value={edgeTgt}
              onChange={(e) => setEdgeTgt(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
            >
              <option value="">Select target...</option>
              {data.nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="px-4 py-1.5 bg-blue-700 text-white font-semibold rounded-md">
            Create Edge
          </button>
        </form>
      )}

      {/* Main Interactive Canvas + Inspector */}
      <div className="grid lg:grid-cols-12 gap-4">
        <div className="lg:col-span-9 h-[540px] bg-white border border-slate-200 rounded-lg overflow-hidden">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onEdgeClick={handleEdgeClick}
            onNodeDragStop={handleNodeDragStop}
            fitView
          >
            <Background color="#e2e8f0" gap={18} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-4 space-y-4 text-xs">
          <h2 className="text-sm font-semibold text-slate-900">Graph Inspector</h2>

          {selectedApiNode && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1.5">
              <p className="font-mono text-[11px] text-blue-700 uppercase">{selectedApiNode.nodeType}</p>
              <p className="font-semibold text-slate-900">{selectedApiNode.name}</p>
              <p className="text-slate-600">Criticality: {selectedApiNode.criticality}</p>
              <p className="text-red-700 font-medium tabular-nums">
                Highlighted BFS Impact: {impactedIds.size} connected node(s) within {bfsDepth} hops
              </p>
            </div>
          )}

          {selectedEdge && (
            <div className="p-3 bg-amber-50/50 border border-amber-200 rounded space-y-2">
              <p className="font-semibold text-slate-900">
                Edge: {selectedEdge.relationshipType}
              </p>
              <p className="text-slate-700">
                Status: {selectedEdge.isInferred ? 'Inferred (Unverified)' : 'Verified'} · Confidence:{' '}
                <span className="font-mono tabular-nums">{Math.round(selectedEdge.confidence * 100)}%</span>
              </p>
              <p className="text-slate-600">{selectedEdge.evidence}</p>
              {selectedEdge.isInferred && (
                <button
                  type="button"
                  onClick={() => handleVerifyEdge(selectedEdge.id, true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white font-semibold rounded w-full justify-center"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Confirm & Verify Edge
                </button>
              )}
            </div>
          )}

          {!selectedApiNode && !selectedEdge && (
            <p className="text-slate-500">
              Select a node to run real-time BFS downstream highlighting, or click an edge to inspect its evidence and confidence.
            </p>
          )}

          <div className="pt-3 border-t border-slate-200">
            <p className="font-semibold text-slate-800 mb-1.5">Topological Change Order</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-600 max-h-48 overflow-y-auto">
              {data.implementationOrder.slice(0, 10).map((name, i) => (
                <li key={i} className="truncate">{name}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
