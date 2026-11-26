import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore';
import { attemptSessionRefresh } from './services/apiClient';
import { ErrorBoundary, ToastContainer } from './components/StatusText';
import { LayoutShell } from './components/LayoutShell';
import { LandingPage } from './pages/LandingPage';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from './pages/AuthPages';
import { OverviewDashboard } from './modules/OverviewDashboard';
import { ProjectsPage } from './modules/ProjectsPage';
import { RequirementDetailPage, RequirementsListPage } from './modules/RequirementsModule';
import { ChangeRequestsPage, ImpactAnalysisDetailPage } from './modules/ChangeRequestsModule';
import { DependencyExplorerPage } from './modules/DependencyExplorerPage';
import { DigitalTwinPage, ScenarioSimulatorPage } from './modules/DigitalTwinAndSimulator';
import { AiIntelligencePage, RepositoryExplorerPage } from './modules/IntelligenceAndRepoModule';
import {
  HistoricalIntelligencePage,
  ReportsPage,
  SettingsPage,
  TeamManagementPage,
  TestManagementPage,
} from './modules/TestingHistoryReportsTeam';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, authInitialized } = useAuthStore();
  if (!authInitialized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Restoring workspace session...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function NotFoundPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <p className="font-mono text-sm font-semibold text-blue-700">404</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900 font-display">Page not found</h1>
      <p className="mt-1 text-sm text-slate-600">The requested RequirementRipple route does not exist.</p>
      <a href="/app" className="mt-5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md">
        Return to Workspace
      </a>
    </div>
  );
}

export default function App() {
  const { authInitialized, setAuthInitialized } = useAuthStore();

  useEffect(() => {
    if (!authInitialized) {
      attemptSessionRefresh().finally(() => {
        setAuthInitialized(true);
      });
    }
  }, [authInitialized, setAuthInitialized]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <LayoutShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<OverviewDashboard />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="requirements" element={<RequirementsListPage />} />
              <Route path="requirements/:reqId" element={<RequirementDetailPage />} />
              <Route path="changes" element={<ChangeRequestsPage />} />
              <Route path="changes/:crId" element={<ImpactAnalysisDetailPage />} />
              <Route path="impact" element={<ImpactAnalysisDetailPage />} />
              <Route path="dependencies" element={<DependencyExplorerPage />} />
              <Route path="digital-twin" element={<DigitalTwinPage />} />
              <Route path="simulator" element={<ScenarioSimulatorPage />} />
              <Route path="intelligence" element={<AiIntelligencePage />} />
              <Route path="tests" element={<TestManagementPage />} />
              <Route path="history" element={<HistoricalIntelligencePage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="repository" element={<RepositoryExplorerPage />} />
              <Route path="team" element={<TeamManagementPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          <ToastContainer />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
