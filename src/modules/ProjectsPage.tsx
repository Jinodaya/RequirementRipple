import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';
import { ConfirmDialog, EmptyState, StatusIndicator, TableSkeleton } from '../components/StatusText';

interface ProjectItem {
  id: string;
  keyPrefix: string;
  name: string;
  description: string;
  techStack: string[];
  status: string;
  requirementCount: number;
  pendingChangeCount: number;
  nodeCount: number;
  updatedAt: string;
}

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { activeOrgId, activeProjectId, setActiveProjectId, pushToast } = useAuthStore();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [keyPrefix, setKeyPrefix] = useState('');
  const [description, setDescription] = useState('');
  const [techInput, setTechInput] = useState('TypeScript, React, Node.js, Express');
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectItem | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['org-projects', activeOrgId],
    enabled: Boolean(activeOrgId),
    queryFn: () => apiRequest<{ projects: ProjectItem[] }>(`/api/orgs/${activeOrgId}/projects`),
  });

  const projects = data?.projects || [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrgId) return;
    setCreating(true);
    try {
      const stack = techInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiRequest<{ project: { id: string } }>(`/api/orgs/${activeOrgId}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name, keyPrefix, description, techStack: stack }),
      });
      await queryClient.invalidateQueries({ queryKey: ['org-projects', activeOrgId] });
      setActiveProjectId(res.project.id);
      setShowCreate(false);
      setName('');
      setKeyPrefix('');
      setDescription('');
      pushToast('success', 'Project created.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSeedReference() {
    if (!activeOrgId) return;
    setSeeding(true);
    try {
      const res = await apiRequest<{ projectId: string; projectName: string }>(
        `/api/orgs/${activeOrgId}/projects/seed-reference`,
        { method: 'POST' }
      );
      await queryClient.invalidateQueries({ queryKey: ['org-projects', activeOrgId] });
      setActiveProjectId(res.projectId);
      pushToast('success', `Provisioned reference project "${res.projectName}".`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to provision reference project.');
    } finally {
      setSeeding(false);
    }
  }

  async function handleToggleArchive(project: ProjectItem) {
    const nextStatus = project.status === 'archived' ? 'active' : 'archived';
    try {
      await apiRequest(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      await queryClient.invalidateQueries({ queryKey: ['org-projects', activeOrgId] });
      pushToast('success', `Project marked ${nextStatus}.`);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Update failed.');
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await apiRequest(`/api/projects/${deleteTarget.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmName }),
      });
      await queryClient.invalidateQueries({ queryKey: ['org-projects', activeOrgId] });
      if (activeProjectId === deleteTarget.id) setActiveProjectId(null);
      setDeleteTarget(null);
      setConfirmName('');
      pushToast('success', 'Project permanently deleted.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Deletion failed.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-display">Projects</h1>
          <p className="mt-1 text-sm text-slate-600">
            Each project maintains isolated requirements, dependency graphs, AST code indexes, and historical intelligence.
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleSeedReference}
            disabled={seeding}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-700" />
            <span>{seeding ? 'Provisioning...' : 'Load Reference Project'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Create Engineering Project</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Project Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cloud Checkout Gateway"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Key Prefix (2–8 chars)</label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={8}
                value={keyPrefix}
                onChange={(e) => setKeyPrefix(e.target.value.toUpperCase())}
                placeholder="CCG"
                className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Architecture Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Core services, regulatory constraints, and deployment scope..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Technology Stack (comma-separated)</label>
            <input
              type="text"
              value={techInput}
              onChange={(e) => setTechInput(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
            >
              {creating ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <TableSkeleton rows={4} />
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects in this organization"
          description="Create a blank project or load the FinPay Core Ledger reference project with pre-linked requirements, AST artifacts, and impact reports."
          actionLabel="Load FinPay Reference Project"
          onAction={handleSeedReference}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
          {projects.map((p) => {
            const isSelected = p.id === activeProjectId;
            return (
              <div key={p.id} className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveProjectId(p.id)}
                      className="text-base font-semibold text-slate-900 hover:text-blue-700 text-left truncate"
                    >
                      {p.name}
                    </button>
                    <StatusIndicator status={p.status} />
                    {isSelected && (
                      <span className="text-xs font-mono text-blue-700 font-semibold">Active Workspace</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600 line-clamp-2">{p.description || 'No description provided.'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono">{p.keyPrefix}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{p.requirementCount} requirements</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{p.nodeCount} graph nodes</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{p.pendingChangeCount} pending CRs</span>
                    {p.techStack.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{p.techStack.join(' / ')}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isSelected && (
                    <button
                      type="button"
                      onClick={() => setActiveProjectId(p.id)}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap"
                    >
                      Select Active
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleToggleArchive(p)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                  >
                    {p.status === 'archived' ? 'Restore' : 'Archive'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget(p);
                      setConfirmName('');
                    }}
                    className="p-1.5 text-slate-500 hover:text-red-700 rounded border border-transparent hover:border-red-200"
                    title="Delete project"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 shadow-lg">
            <h3 className="text-base font-semibold text-slate-900">Delete Project Safeguard</h3>
            <p className="mt-2 text-sm text-slate-600">
              Deleting <strong>{deleteTarget.name}</strong> permanently erases all requirements, dependency graphs,
              impact analyses, and test records. Type the exact project name below to confirm.
            </p>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={deleteTarget.name}
              className="mt-4 w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-md"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmName !== deleteTarget.name}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-md"
              >
                Confirm Permanent Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
