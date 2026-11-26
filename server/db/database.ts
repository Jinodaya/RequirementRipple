import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../config/env.ts';

let dbInstance: DatabaseSync | null = null;

export function getDb(customPath?: string): DatabaseSync {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const targetPath = customPath || env.DB_PATH;
  if (targetPath !== ':memory:') {
    const dir = path.dirname(path.resolve(targetPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initializeSchema(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function resetDbForTests(db: DatabaseSync): void {
  dbInstance = db;
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      job_title TEXT DEFAULT 'Software Architect',
      avatar_url TEXT DEFAULT '',
      email_verified INTEGER NOT NULL DEFAULT 0,
      email_verify_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      invited_email TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      invite_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(organization_id, invited_email)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      tech_stack_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL REFERENCES users(id),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      req_code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'draft',
      approval_status TEXT NOT NULL DEFAULT 'pending',
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      attachments_json TEXT NOT NULL DEFAULT '[]',
      author_id TEXT NOT NULL REFERENCES users(id),
      assignee_id TEXT REFERENCES users(id),
      version_number INTEGER NOT NULL DEFAULT 1,
      quality_score REAL DEFAULT 0,
      quality_breakdown_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, req_code)
    );

    CREATE TABLE IF NOT EXISTS requirement_versions (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      changed_by TEXT NOT NULL REFERENCES users(id),
      change_summary TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dependency_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      ref_id TEXT,
      node_type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      criticality TEXT NOT NULL DEFAULT 'medium',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      position_x REAL DEFAULT 0,
      position_y REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dependency_edges (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_node_id TEXT NOT NULL REFERENCES dependency_nodes(id) ON DELETE CASCADE,
      target_node_id TEXT NOT NULL REFERENCES dependency_nodes(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      is_inferred INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 1,
      confidence REAL NOT NULL DEFAULT 1.0,
      evidence TEXT DEFAULT '',
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repository_connections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'github',
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      repo_url TEXT NOT NULL,
      token_encrypted TEXT DEFAULT '',
      has_token INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      last_commit_sha TEXT DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'connected',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repository_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES repository_connections(id) ON DELETE SET NULL,
      branch TEXT NOT NULL,
      commit_sha TEXT DEFAULT '',
      file_count INTEGER NOT NULL DEFAULT 0,
      artifact_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repository_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      snapshot_id TEXT REFERENCES repository_snapshots(id) ON DELETE SET NULL,
      file_path TEXT NOT NULL,
      language TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT DEFAULT '',
      imports_json TEXT NOT NULL DEFAULT '[]',
      calls_json TEXT NOT NULL DEFAULT '[]',
      routes_json TEXT NOT NULL DEFAULT '[]',
      models_json TEXT NOT NULL DEFAULT '[]',
      linked_requirement_ids_json TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      line_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS change_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      cr_code TEXT NOT NULL,
      requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
      change_category TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT NOT NULL,
      original_snapshot_json TEXT NOT NULL DEFAULT '{}',
      proposed_title TEXT NOT NULL,
      proposed_description TEXT NOT NULL,
      proposed_acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'submitted',
      approval_status TEXT NOT NULL DEFAULT 'pending',
      analysis_status TEXT NOT NULL DEFAULT 'pending',
      requester_id TEXT NOT NULL REFERENCES users(id),
      reviewer_id TEXT REFERENCES users(id),
      decision_reason TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, cr_code)
    );

    CREATE TABLE IF NOT EXISTS impact_analyses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      change_request_id TEXT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
      semantic_diff_json TEXT NOT NULL DEFAULT '{}',
      direct_count INTEGER NOT NULL DEFAULT 0,
      indirect_count INTEGER NOT NULL DEFAULT 0,
      potential_count INTEGER NOT NULL DEFAULT 0,
      uncertain_count INTEGER NOT NULL DEFAULT 0,
      total_blast_radius INTEGER NOT NULL DEFAULT 0,
      impact_score REAL NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL DEFAULT 'low',
      confidence REAL NOT NULL DEFAULT 0,
      recommendation TEXT NOT NULL DEFAULT 'needs_further_analysis',
      explanation TEXT NOT NULL DEFAULT '',
      conflicts_json TEXT NOT NULL DEFAULT '[]',
      missing_dependencies_json TEXT NOT NULL DEFAULT '[]',
      effort_estimate_json TEXT NOT NULL DEFAULT '{}',
      scoring_breakdown_json TEXT NOT NULL DEFAULT '{}',
      ai_provider TEXT NOT NULL DEFAULT 'deterministic',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS impacted_artifacts (
      id TEXT PRIMARY KEY,
      impact_analysis_id TEXT NOT NULL REFERENCES impact_analyses(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      node_id TEXT REFERENCES dependency_nodes(id) ON DELETE SET NULL,
      artifact_name TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      impact_tier TEXT NOT NULL,
      relationship TEXT NOT NULL,
      hop_distance INTEGER NOT NULL DEFAULT 1,
      impact_reason TEXT NOT NULL,
      evidence TEXT NOT NULL,
      confidence REAL NOT NULL,
      risk_level TEXT NOT NULL,
      recommended_action TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_summary_json TEXT NOT NULL DEFAULT '{}',
      decided_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      mutations_json TEXT NOT NULL DEFAULT '[]',
      baseline_metrics_json TEXT NOT NULL DEFAULT '{}',
      simulated_metrics_json TEXT NOT NULL DEFAULT '{}',
      affected_nodes_json TEXT NOT NULL DEFAULT '[]',
      risk_delta REAL NOT NULL DEFAULT 0,
      report_summary TEXT DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      description TEXT DEFAULT '',
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL DEFAULT '{}',
      repo_sync_status TEXT NOT NULL DEFAULT 'synchronized',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      tc_code TEXT NOT NULL,
      requirement_id TEXT REFERENCES requirements(id) ON DELETE SET NULL,
      change_request_id TEXT REFERENCES change_requests(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      test_type TEXT NOT NULL,
      objective TEXT NOT NULL,
      preconditions TEXT DEFAULT '',
      input_data TEXT DEFAULT '',
      execution_steps_json TEXT NOT NULL DEFAULT '[]',
      expected_result TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      related_artifact TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'suggested',
      generated_by TEXT NOT NULL DEFAULT 'manual',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, tc_code)
    );

    CREATE TABLE IF NOT EXISTS test_executions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
      outcome TEXT NOT NULL,
      notes TEXT DEFAULT '',
      executed_by TEXT NOT NULL REFERENCES users(id),
      executed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS historical_changes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      change_request_id TEXT REFERENCES change_requests(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      original_requirement TEXT NOT NULL,
      approved_change TEXT NOT NULL,
      affected_artifacts_json TEXT NOT NULL DEFAULT '[]',
      actual_implementation TEXT DEFAULT '',
      tests_performed TEXT DEFAULT '',
      bugs_discovered_json TEXT NOT NULL DEFAULT '[]',
      actual_effort_hours REAL DEFAULT 0,
      estimated_effort_hours REAL DEFAULT 0,
      resolution TEXT DEFAULT '',
      lessons_learned TEXT DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'success',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      historical_change_id TEXT REFERENCES historical_changes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      affected_components_json TEXT NOT NULL DEFAULT '[]',
      resolution TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      author_id TEXT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT DEFAULT '',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_analysis_records (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      analysis_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(organization_id);
    CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
    CREATE INDEX IF NOT EXISTS idx_req_project ON requirements(project_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_project ON dependency_nodes(project_id);
    CREATE INDEX IF NOT EXISTS idx_edges_project ON dependency_edges(project_id);
    CREATE INDEX IF NOT EXISTS idx_edges_source ON dependency_edges(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON dependency_edges(target_node_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_project ON repository_artifacts(project_id);
    CREATE INDEX IF NOT EXISTS idx_cr_project ON change_requests(project_id);
    CREATE INDEX IF NOT EXISTS idx_impact_cr ON impact_analyses(change_request_id);
    CREATE INDEX IF NOT EXISTS idx_impacted_analysis ON impacted_artifacts(impact_analysis_id);
    CREATE INDEX IF NOT EXISTS idx_test_cases_project ON test_cases(project_id);
    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
  `);
}
