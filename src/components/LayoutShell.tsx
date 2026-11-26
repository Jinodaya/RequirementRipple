import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  FolderKanban,
  FileText,
  GitPullRequest,
  Activity,
  Network,
  Layers,
  FlaskConical,
  BrainCircuit,
  CheckSquare,
  History,
  FileBarChart2,
  GitBranch,
  Users,
  Settings,
  Bell,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { apiRequest } from '../services/apiClient';

interface ProjectListItem {
  id: string;
  keyPrefix: string;
  name: string;
  status: string;
}

const NAV_ITEMS = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/projects', label: 'Projects', icon: FolderKanban },
  { to: '/app/requirements', label: 'Requirements', icon: FileText },
  { to: '/app/changes', label: 'Change Requests', icon: GitPullRequest },
  { to: '/app/impact', label: 'Impact Analysis', icon: Activity },
  { to: '/app/dependencies', label: 'Dependency Explorer', icon: Network },
  { to: '/app/digital-twin', label: 'Digital Twin', icon: Layers },
  { to: '/app/simulator', label: 'Scenario Simulator', icon: FlaskConical },
  { to: '/app/intelligence', label: 'AI Intelligence', icon: BrainCircuit },
  { to: '/app/tests', label: 'Test Management', icon: CheckSquare },
  { to: '/app/history', label: 'Historical Intelligence', icon: History },
  { to: '/app/reports', label: 'Reports', icon: FileBarChart2 },
  { to: '/app/repository', label: 'Integrations', icon: GitBranch },
  { to: '/app/team', label: 'Team Management', icon: Users },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];

export function LayoutShell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    user,
    organizations,
    activeOrgId,
    activeProjectId,
    setActiveOrgId,
    setActiveProjectId,
    clearSession,
  } = useAuthStore();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: projectsData } = useQuery({
    queryKey: ['org-projects', activeOrgId],
    enabled: Boolean(activeOrgId),
    queryFn: () => apiRequest<{ projects: ProjectListItem[] }>(`/api/orgs/${activeOrgId}/projects`),
  });

  const { data: notifData, refetch: refetchNotifs } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      apiRequest<{
        notifications: Array<{
          id: string;
          title: string;
          message: string;
          link: string;
          isRead: number;
          createdAt: string;
        }>;
      }>('/api/auth/notifications'),
  });

  const projects = projectsData?.projects || [];

  useEffect(() => {
    if (projects.length > 0 && (!activeProjectId || !projects.some((p) => p.id === activeProjectId))) {
      setActiveProjectId(projects[0].id);
    }
  }, [projects, activeProjectId, setActiveProjectId]);

  const activeOrg = organizations.find((o) => o.id === activeOrgId);
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const unreadCount = (notifData?.notifications || []).filter((n) => !n.isRead).length;

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    clearSession();
    queryClient.clear();
    navigate('/login');
  }

  async function handleMarkRead(id: string, link: string) {
    await apiRequest(`/api/auth/notifications/${id}/read`, { method: 'PATCH' });
    refetchNotifs();
    setNotifOpen(false);
    if (link) navigate(link);
  }

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-200 select-none">
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <NavLink to="/app" className="text-base font-bold tracking-tight text-white whitespace-nowrap">
          RequirementRipple
        </NavLink>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-slate-400 hover:text-white"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <img
            src="/src/assets/images/avatar_architect_profile_1795668844683.jpg"
            alt={user?.name || 'User profile'}
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-full object-cover bg-slate-700 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white truncate">{user?.name}</p>
            <p className="text-[11px] text-slate-400 truncate">{activeOrg?.role || 'Member'}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            className="p-1.5 text-slate-400 hover:text-white rounded"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-800 bg-slate-900 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 h-full">{sidebarContent}</div>
          <div className="flex-1 bg-slate-950/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Organization & Project Breadcrumb Selectors */}
            <div className="flex items-center gap-2 text-sm min-w-0">
              <select
                aria-label="Select organization"
                value={activeOrgId || ''}
                onChange={(e) => setActiveOrgId(e.target.value || null)}
                className="text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 max-w-[160px] truncate"
              >
                {organizations.length === 0 && <option value="">No organization</option>}
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>

              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

              <select
                aria-label="Select active project"
                value={activeProjectId || ''}
                onChange={(e) => setActiveProjectId(e.target.value || null)}
                className="text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 max-w-[210px] truncate"
              >
                {projects.length === 0 && <option value="">No project selected</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.keyPrefix} · {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeProject && (
              <button
                type="button"
                onClick={() => navigate('/app/changes')}
                className="hidden sm:inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                New Change Request
              </button>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className="relative p-2 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-700 text-white text-[10px] font-mono tabular-nums flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-lg z-40">
                  <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">Notifications</span>
                    <span className="text-xs text-slate-500 tabular-nums">{unreadCount} unread</span>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {(notifData?.notifications || []).length === 0 ? (
                      <p className="p-4 text-xs text-slate-500">No notifications yet.</p>
                    ) : (
                      (notifData?.notifications || []).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => handleMarkRead(n.id, n.link)}
                          className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${
                            n.isRead ? 'opacity-65' : 'bg-blue-50/30'
                          }`}
                        >
                          <p className="text-xs font-medium text-slate-900">{n.title}</p>
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
