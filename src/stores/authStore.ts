import { create } from 'zustand';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  jobTitle?: string;
  emailVerified: boolean;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  description?: string;
  role: string;
}

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AuthState {
  accessToken: string | null;
  user: UserInfo | null;
  organizations: OrganizationSummary[];
  activeOrgId: string | null;
  activeProjectId: string | null;
  authInitialized: boolean;
  toasts: ToastItem[];
  setSession: (payload: {
    accessToken: string;
    user: UserInfo;
    organizations: OrganizationSummary[];
  }) => void;
  setOrganizations: (orgs: OrganizationSummary[]) => void;
  setActiveOrgId: (orgId: string | null) => void;
  setActiveProjectId: (projectId: string | null) => void;
  setAuthInitialized: (val: boolean) => void;
  clearSession: () => void;
  pushToast: (type: ToastItem['type'], message: string) => void;
  dismissToast: (id: string) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  organizations: [],
  activeOrgId: null,
  activeProjectId: null,
  authInitialized: false,
  toasts: [],
  setSession: ({ accessToken, user, organizations }) =>
    set((state) => {
      const nextOrgId =
        state.activeOrgId && organizations.some((o) => o.id === state.activeOrgId)
          ? state.activeOrgId
          : organizations[0]?.id || null;
      return {
        accessToken,
        user,
        organizations,
        activeOrgId: nextOrgId,
        authInitialized: true,
      };
    }),
  setOrganizations: (organizations) =>
    set((state) => ({
      organizations,
      activeOrgId:
        state.activeOrgId && organizations.some((o) => o.id === state.activeOrgId)
          ? state.activeOrgId
          : organizations[0]?.id || null,
    })),
  setActiveOrgId: (activeOrgId) => set({ activeOrgId, activeProjectId: null }),
  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setAuthInitialized: (authInitialized) => set({ authInitialized }),
  clearSession: () =>
    set({
      accessToken: null,
      user: null,
      organizations: [],
      activeOrgId: null,
      activeProjectId: null,
      authInitialized: true,
    }),
  pushToast: (type, message) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4500);
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
