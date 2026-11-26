import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export function LandingPage() {
  const { user } = useAuthStore();
  const [imgError, setImgError] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 font-display"
          >
            RequirementRipple
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#capabilities" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#architecture" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Architecture
            </a>
            <a href="#methodology" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Methodology
            </a>
            <Link to="/login" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Sign In
            </Link>
          </nav>

          <div className="shrink-0">
            <Link
              to={user ? '/app' : '/register'}
              className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              {user ? 'Open Workspace' : 'Start Workspace'}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Split */}
        <section className="bg-slate-900 text-white border-b border-slate-800">
          <div className="max-w-[1200px] mx-auto px-6 py-16 lg:py-20 grid lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium text-blue-300 tracking-wide">
                Change Impact Engineering · Dependency Intelligence · Digital Twin
              </p>
              <h1
                className="mt-4 font-bold tracking-tight text-white leading-[1.12] font-display"
                style={{ fontSize: 'clamp(2.25rem, 3.8vw, 3.25rem)', textWrap: 'balance' }}
              >
                Predict software change blast radius before writing a single line of code.
              </h1>
              <p className="mt-5 text-base text-slate-300 leading-relaxed max-w-xl">
                RequirementRipple connects software requirements, AST-parsed source code, API routes, database models,
                and test suites into a unified dependency graph—so engineering teams quantify risks, catch conflicts,
                and simulate scenarios without altering production baselines.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to={user ? '/app' : '/register'}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap"
                >
                  <span>{user ? 'Go to Dashboard' : 'Create Organization Workspace'}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center px-4 py-2.5 text-sm font-medium text-slate-200 border border-slate-700 hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
                >
                  Sign In to Existing Team
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6 flex items-stretch">
              <div className="w-full rounded-lg overflow-hidden border border-slate-800 bg-slate-950 min-h-[280px] flex items-center justify-center">
                {!imgError ? (
                  <img
                    src="/src/assets/images/hero_dependency_architecture_1795668843696.jpg"
                    alt="Isometric software architecture and dependency graph blueprint"
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="p-8 text-center text-slate-400">
                    <Layers className="w-10 h-10 mx-auto mb-3 text-blue-400" />
                    <p className="text-sm font-medium text-slate-200">Unified Dependency Intelligence Model</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Mechanism-to-Outcome Strip */}
        <section id="capabilities" className="max-w-[1200px] mx-auto px-6 py-16 border-b border-slate-200">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 font-display">
              Deterministic algorithms backed by explainable intelligence
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Every score, impacted artifact, and risk classification cites exact graph hops, AST references, and
              historical incidents—never unverified black-box guesses.
            </p>
          </div>

          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <p className="text-xs font-mono font-medium text-blue-700">01. Requirement Intelligence</p>
              <h3 className="mt-2 text-base font-semibold text-slate-900">Ambiguity & Conflict Audit</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Detects subjective phrasing, missing negative paths, semantic duplicates, and contradictory SLAs across
                versioned requirements.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <p className="text-xs font-mono font-medium text-blue-700">02. Graph & AST Engine</p>
              <h3 className="mt-2 text-base font-semibold text-slate-900">Direct & Inferred Coupling</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Traverses requirements, source files, API routes, and DB models via BFS/DFS while separating verified
                links from inferred edges.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <p className="text-xs font-mono font-medium text-blue-700">03. Digital Twin & What-If</p>
              <h3 className="mt-2 text-base font-semibold text-slate-900">Isolated Virtual Simulation</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Forks your architecture into an isolated virtual graph to test removals, new dependencies, and failure
                ripples without touching real project data.
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-6">
              <p className="text-xs font-mono font-medium text-blue-700">04. Decision & QA Automation</p>
              <h3 className="mt-2 text-base font-semibold text-slate-900">Effort, Tests & Approvals</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Generates regression, security, and boundary test cases, surfaces past production incidents, and logs
                human-approved change decisions.
              </p>
            </div>
          </div>
        </section>

        {/* Architecture & Methodology */}
        <section id="architecture" className="max-w-[1200px] mx-auto px-6 py-16">
          <div className="grid lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5">
              <h2 id="methodology" className="text-2xl font-bold tracking-tight text-slate-900 font-display">
                10-Step Change Impact Workflow
              </h2>
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                When a developer or product manager proposes a requirement modification, RequirementRipple executes a
                reproducible ten-stage pipeline combining lexical diffing, graph traversal, AST correlation, and
                configurable effort estimation.
              </p>
            </div>
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg divide-y divide-slate-200">
              {[
                ['Step 1–3', 'Lexical & acceptance-criteria diff between original baseline and proposed change'],
                ['Step 4–6', 'BFS traversal of direct (hop 1) and indirect (hop >= 2) nodes plus AST code artifacts'],
                ['Step 7–8', 'Regression test case mapping, conflict detection, and coverage gap identification'],
                ['Step 9–10', 'Transparent impact scoring (0–100), effort hours estimate, and decision recommendation'],
              ].map(([step, desc]) => (
                <div key={step} className="px-5 py-4 flex items-baseline gap-5">
                  <span className="font-mono text-xs font-semibold text-blue-700 w-20 shrink-0">{step}</span>
                  <span className="text-sm text-slate-700">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>RequirementRipple · Software Change Impact & Dependency Intelligence Platform</span>
          <div className="flex items-center gap-6">
            <Link to="/login" className="hover:text-slate-900">Sign In</Link>
            <Link to="/register" className="hover:text-slate-900">Create Workspace</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
