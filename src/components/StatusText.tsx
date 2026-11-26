import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  X,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export function StatusIndicator({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (
    ['approved', 'passed', 'active', 'synchronized', 'synced', 'success', 'low'].includes(normalized)
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
      </span>
    );
  }
  if (
    ['critical', 'rejected', 'failed', 'incident', 'rollback', 'high'].includes(normalized)
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
      </span>
    );
  }
  if (
    ['pending', 'in_review', 'medium', 'clarification_requested', 'suggested', 'warning', 'needs_further_analysis', 'request_clarification', 'stale_repository'].includes(normalized)
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="capitalize">{status.replace(/_/g, ' ')}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" />
      <span className="capitalize">{status.replace(/_/g, ' ')}</span>
    </span>
  );
}

export function ToastContainer() {
  const { toasts, dismissToast } = useAuthStore();
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-lg border bg-white shadow-sm text-sm ${
            t.type === 'error'
              ? 'border-red-200 text-red-900'
              : t.type === 'success'
              ? 'border-emerald-200 text-emerald-900'
              : 'border-slate-200 text-slate-900'
          }`}
        >
          {t.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          ) : t.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          )}
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
      {Array.from({ length: rows }).map((_, idx) => (
        <div key={idx} className="px-4 py-3.5 flex items-center gap-4 animate-pulse">
          <div className="h-3.5 w-24 bg-slate-200 rounded" />
          <div className="h-3.5 flex-1 bg-slate-100 rounded" />
          <div className="h-3.5 w-20 bg-slate-200 rounded" />
          <div className="h-3.5 w-16 bg-slate-100 rounded" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-6 shadow-lg">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{description}</p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-md whitespace-nowrap ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-700 hover:bg-blue-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 max-w-xl mx-auto mt-12 bg-white border border-red-200 rounded-lg">
          <h2 className="text-lg font-semibold text-red-900">Interface Render Error</h2>
          <p className="mt-2 text-sm text-slate-600">{this.state.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="mt-4 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-md"
          >
            Retry View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
