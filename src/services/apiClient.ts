import { useAuthStore } from '../stores/authStore';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let refreshPromise: Promise<string | null> | null = null;

export async function attemptSessionRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const resp = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) {
        useAuthStore.getState().clearSession();
        return null;
      }
      const data = await resp.json();
      useAuthStore.getState().setSession({
        accessToken: data.accessToken,
        user: data.user,
        organizations: data.organizations || [],
      });
      return data.accessToken as string;
    } catch {
      useAuthStore.getState().clearSession();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { skipAuthRefresh?: boolean } = {}
): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let resp = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (resp.status === 401 && !options.skipAuthRefresh && !path.startsWith('/api/auth/login')) {
    const newToken = await attemptSessionRefresh();
    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      resp = await fetch(path, {
        ...options,
        headers,
        credentials: 'include',
      });
    }
  }

  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json() : await resp.text();

  if (!resp.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${resp.status}`;
    throw new ApiError(resp.status, message);
  }

  return data as T;
}
