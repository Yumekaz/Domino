-- Local integration harness schema for role B.
-- This is NOT a production migration and is not owned by A. It mirrors the
-- master specification's logical tables plus fields required to prove retrieval,
-- source provenance and observed contributor history. A's migration replaces it.

CREATE TABLE repositories (
  id UUID PRIMARY KEY,
  github_id BIGINT UNIQUE NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  html_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(owner, name)
);

CREATE TABLE index_snapshots (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  head_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  coverage JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(repo_id, head_sha)
);

CREATE TABLE entities (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  kind TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  title TEXT,
  source_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(repo_id, kind, canonical_key)
);

CREATE INDEX entities_repo_kind_idx ON entities(repo_id, kind);

CREATE TABLE edges (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  snapshot_id UUID NOT NULL REFERENCES index_snapshots(id),
  from_entity_id UUID NOT NULL REFERENCES entities(id),
  to_entity_id UUID NOT NULL REFERENCES entities(id),
  kind TEXT NOT NULL,
  verification TEXT NOT NULL,
  source_url TEXT,
  source_entity_id UUID REFERENCES entities(id),
  extractor TEXT,
  observed_at TIMESTAMPTZ,
  verification_detail TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX edges_snapshot_kind_from_idx ON edges(snapshot_id, kind, from_entity_id);
CREATE INDEX edges_snapshot_kind_to_idx ON edges(snapshot_id, kind, to_entity_id);

CREATE TABLE evidence_documents (
  id UUID PRIMARY KEY,
  repo_id UUID NOT NULL REFERENCES repositories(id),
  snapshot_id UUID NOT NULL REFERENCES index_snapshots(id),
  entity_id UUID NOT NULL REFERENCES entities(id),
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
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX evidence_documents_fts_idx ON evidence_documents USING GIN(search_tsv);
CREATE INDEX evidence_documents_snapshot_idx ON evidence_documents(snapshot_id);
CREATE INDEX evidence_documents_entity_idx ON evidence_documents(snapshot_id, entity_id);

CREATE TABLE file_contributors (
  repo_id UUID NOT NULL REFERENCES repositories(id),
  snapshot_id UUID NOT NULL REFERENCES index_snapshots(id),
  file_path TEXT NOT NULL,
  contributor_key TEXT NOT NULL,
  contributor_name TEXT NOT NULL,
  contributor_email TEXT NOT NULL,
  observed_commits INT NOT NULL,
  first_touch TIMESTAMPTZ,
  last_touch TIMESTAMPTZ,
  commit_shas JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY(snapshot_id, file_path, contributor_key)
);

CREATE INDEX file_contributors_snapshot_idx ON file_contributors(snapshot_id, file_path);
