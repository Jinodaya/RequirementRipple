import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../services/apiClient';
import { useAuthStore, type OrganizationSummary, type UserInfo } from '../stores/authStore';

interface AuthResponse {
  accessToken: string;
  user: UserInfo;
  organizations: OrganizationSummary[];
  emailVerificationPreviewToken?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession, pushToast } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
        skipAuthRefresh: true,
      });
      setSession({
        accessToken: data.accessToken,
        user: data.user,
        organizations: data.organizations,
      });
      pushToast('success', `Welcome back, ${data.user.name}`);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4">
      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-lg p-8">
        <Link to="/" className="text-base font-bold text-slate-900 font-display">
          RequirementRipple
        </Link>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Sign in to your workspace</h1>
        <p className="mt-1 text-sm text-slate-600">
          Access requirement dependency graphs, change impact reports, and simulations.
        </p>

        {error && (
          <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Work Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="architect@company.com"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-slate-700">Password</label>
              <Link to="/forgot-password" className="text-xs text-blue-700 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-600 text-center">
          New team?{' '}
          <Link to="/register" className="text-blue-700 font-medium hover:underline">
            Create an account and organization
          </Link>
        </p>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const { setSession, setActiveProjectId, pushToast } = useAuthStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [jobTitle, setJobTitle] = useState('Principal Software Architect');
  const [organizationName, setOrganizationName] = useState('');
  const [seedReference, setSeedReference] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiRequest<AuthResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, jobTitle, organizationName }),
        skipAuthRefresh: true,
      });

      setSession({
        accessToken: data.accessToken,
        user: data.user,
        organizations: data.organizations,
      });

      if (seedReference && data.organizations[0]?.id) {
        const seeded = await apiRequest<{ projectId: string }>(
          `/api/orgs/${data.organizations[0].id}/projects/seed-reference`,
          { method: 'POST' }
        );
        setActiveProjectId(seeded.projectId);
      }

      pushToast('success', 'Workspace created successfully.');
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4">
      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-lg p-8">
        <Link to="/" className="text-base font-bold text-slate-900 font-display">
          RequirementRipple
        </Link>
        <h1 className="mt-4 text-xl font-bold text-slate-900">Create your organization workspace</h1>
        <p className="mt-1 text-sm text-slate-600">
          Set up your engineering account, RBAC organization, and initial project.
        </p>

        {error && (
          <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Mercer"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Work Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@acme-eng.io"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Role / Title</label>
            <input
              type="text"
              required
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Organization Name</label>
            <input
              type="text"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Acme Platform Engineering"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Password (min 8 characters)</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <label className="flex items-start gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={seedReference}
              onChange={(e) => setSeedReference(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-700"
            />
            <span className="text-xs text-slate-600 leading-snug">
              Provision the <strong>FinPay Core Ledger</strong> reference project (real requirements, AST-parsed code
              artifacts, dependency graph, and change impact report) so I can explore immediately.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors"
          >
            {loading ? 'Provisioning Workspace...' : 'Create Workspace'}
          </button>
        </form>

        <p className="mt-6 text-xs text-slate-600 text-center">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-700 font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [tokenPreview, setTokenPreview] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await apiRequest<{ message: string; resetTokenPreview?: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
        skipAuthRefresh: true,
      });
      setMessage(res.message);
      if (res.resetTokenPreview) setTokenPreview(res.resetTokenPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4">
      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-lg p-8">
        <h1 className="text-xl font-bold text-slate-900">Reset your password</h1>
        <p className="mt-1 text-sm text-slate-600">Enter your account email to generate a 30-minute reset token.</p>
        {error && <div className="mt-4 p-3 rounded bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>}
        {message && (
          <div className="mt-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-2">
            <p>{message}</p>
            {tokenPreview && (
              <div>
                <p className="font-semibold">Reset Token:</p>
                <code className="block mt-1 p-2 bg-white border border-emerald-200 rounded text-[11px] break-all font-mono">
                  {tokenPreview}
                </code>
                <Link
                  to={`/reset-password?token=${encodeURIComponent(tokenPreview)}`}
                  className="inline-block mt-2 text-blue-700 font-semibold hover:underline"
                >
                  Continue to Reset Password →
                </Link>
              </div>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
          />
          <button
            type="submit"
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
          >
            Generate Reset Token
          </button>
        </form>
        <p className="mt-4 text-xs text-center">
          <Link to="/login" className="text-slate-600 hover:text-slate-900">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const [token, setToken] = useState(params.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
        skipAuthRefresh: true,
      });
      setDone(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4">
      <div className="max-w-md w-full mx-auto bg-white border border-slate-200 rounded-lg p-8">
        <h1 className="text-xl font-bold text-slate-900">Set new password</h1>
        {error && <div className="mt-4 p-3 rounded bg-red-50 border border-red-200 text-xs text-red-800">{error}</div>}
        {done && (
          <div className="mt-4 p-3 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            Password updated. Redirecting to sign in...
          </div>
        )}
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Reset Token</label>
            <input
              type="text"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">New Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md"
          >
            Update Password
          </button>
        </form>
      </div>
    </div>
  );
}
