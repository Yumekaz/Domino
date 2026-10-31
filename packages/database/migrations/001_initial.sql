CREATE TABLE repositories (
  id UUID PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT,
  visibility TEXT NOT NULL CHECK (visibility = 'public'),
  html_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX repositories_owner_name_idx ON repositories (lower(owner), lower(name));

-- A fresh snapshot ID is used for every import, even when the SHA is unchanged.
-- Earlier published snapshots must remain visible during a reindex.
CREATE TABLE index_snapshots (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  head_sha TEXT NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  branch TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','ready','partial','failed','cancelled')),
  coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (id, repo_id)
);
CREATE INDEX snapshots_repo_published_idx ON index_snapshots(repo_id, completed_at DESC)
  WHERE status IN ('ready','partial');

CREATE TABLE entities (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  kind TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  title TEXT,
  source_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(repo_id, kind, canonical_key),
  UNIQUE(id, repo_id)
);
CREATE INDEX entities_repo_kind_idx ON entities(repo_id, kind);

-- Immutable per-snapshot presentation of the identity records supplied by ingestion.
CREATE TABLE entity_versions (
  snapshot_id UUID NOT NULL,
  repo_id UUID NOT NULL,
  entity_id UUID NOT NULL,
  kind TEXT NOT NULL,
  title TEXT,
  source_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(snapshot_id, entity_id),
  FOREIGN KEY(snapshot_id, repo_id) REFERENCES index_snapshots(id, repo_id),
  FOREIGN KEY(entity_id, repo_id) REFERENCES entities(id, repo_id)
);
CREATE INDEX entity_versions_repo_kind_idx ON entity_versions(repo_id, snapshot_id, kind, entity_id);

CREATE TABLE edges (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  from_entity_id UUID NOT NULL,
  to_entity_id UUID NOT NULL,
  kind TEXT NOT NULL,
  verification TEXT NOT NULL CHECK (verification IN ('observed','derived','inferred')),
  source_url TEXT,
  source_entity_id UUID,
  extractor TEXT,
  observed_at TIMESTAMPTZ,
  verification_detail TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY(snapshot_id, repo_id) REFERENCES index_snapshots(id, repo_id),
  FOREIGN KEY(from_entity_id, repo_id) REFERENCES entities(id, repo_id),
  FOREIGN KEY(to_entity_id, repo_id) REFERENCES entities(id, repo_id),
  FOREIGN KEY(source_entity_id, repo_id) REFERENCES entities(id, repo_id)
);
CREATE INDEX edges_snapshot_kind_from_idx ON edges(snapshot_id, kind, from_entity_id);
CREATE INDEX edges_snapshot_kind_to_idx ON edges(snapshot_id, kind, to_entity_id);

-- B's source IDs are content-addressed and can recur in separate snapshots.
CREATE TABLE evidence_documents (
  id UUID NOT NULL,
  repo_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  entity_id UUID NOT NULL,
  source_url TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  content_sha TEXT NOT NULL,
  section_locator TEXT NOT NULL,
  body TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  line_start INT,
  line_end INT,
  source_timestamp TIMESTAMPTZ,
  revision TEXT NOT NULL,
  chunk_index INT NOT NULL,
  search_tsv TSVECTOR NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(snapshot_id, id),
  FOREIGN KEY(snapshot_id, repo_id) REFERENCES index_snapshots(id, repo_id),
  FOREIGN KEY(entity_id, repo_id) REFERENCES entities(id, repo_id)
);
CREATE INDEX evidence_documents_fts_idx ON evidence_documents USING GIN(search_tsv);
CREATE INDEX evidence_documents_snapshot_idx ON evidence_documents(snapshot_id);
CREATE INDEX evidence_documents_entity_idx ON evidence_documents(snapshot_id, entity_id);

CREATE TABLE file_contributors (
  repo_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  contributor_key TEXT NOT NULL,
  contributor_name TEXT NOT NULL,
  contributor_email TEXT NOT NULL,
  observed_commits INT NOT NULL CHECK(observed_commits >= 0),
  first_touch TIMESTAMPTZ,
  last_touch TIMESTAMPTZ,
  commit_shas JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY(snapshot_id, file_path, contributor_key),
  FOREIGN KEY(snapshot_id, repo_id) REFERENCES index_snapshots(id, repo_id)
);
CREATE INDEX file_contributors_snapshot_idx ON file_contributors(snapshot_id, file_path);

CREATE TABLE file_dependencies (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  importing_file TEXT NOT NULL,
  imported_file TEXT NOT NULL,
  dependency_kind TEXT NOT NULL,
  source_line INT CHECK(source_line > 0),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY(snapshot_id, repo_id) REFERENCES index_snapshots(id, repo_id),
  UNIQUE(snapshot_id, importing_file, imported_file, dependency_kind)
);
CREATE INDEX dependencies_reverse_idx ON file_dependencies(snapshot_id, imported_file);

CREATE TABLE analysis_runs (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  snapshot_id UUID,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(snapshot_id, repo_id) REFERENCES index_snapshots(id, repo_id)
);
CREATE INDEX analysis_runs_repo_date_idx ON analysis_runs(repo_id, created_at DESC);
CREATE UNIQUE INDEX analysis_runs_idempotency_idx ON analysis_runs(repo_id, kind, (input->>'idempotencyKey'))
  WHERE input ? 'idempotencyKey';

CREATE TABLE import_jobs (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  snapshot_id UUID NOT NULL UNIQUE,
  url TEXT NOT NULL,
  head_sha TEXT NOT NULL CHECK(head_sha ~ '^[0-9a-f]{40}$'),
  branch TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','ready','partial','failed','cancelled')),
  phase TEXT NOT NULL,
  progress NUMERIC CHECK(progress >= 0 AND progress <= 100),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_jobs_one_active_repo_idx ON import_jobs(repo_id)
  WHERE status IN ('queued','running');
