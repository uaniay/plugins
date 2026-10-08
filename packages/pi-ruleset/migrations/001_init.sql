-- pi-ruleset PostgreSQL schema
-- The schema must be created by the database administrator first:
--   CREATE SCHEMA agent_ruleset;
-- This migration only creates objects inside agent_ruleset.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS agent_ruleset.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_ruleset.rules (
  id text NOT NULL,
  namespace text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL,
  description text NOT NULL,
  raw_description text,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer text NOT NULL DEFAULT 'all',
  facility text NOT NULL DEFAULT 'all',
  item text NOT NULL,
  cycle text NOT NULL DEFAULT 'all',
  reference_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by_email text,
  updated_by_email text,
  source text NOT NULL DEFAULT 'postgres',
  PRIMARY KEY (namespace, id)
);

CREATE INDEX IF NOT EXISTS rules_namespace_status_idx
  ON agent_ruleset.rules (namespace, status);

CREATE INDEX IF NOT EXISTS rules_namespace_updated_idx
  ON agent_ruleset.rules (namespace, updated_at DESC);

INSERT INTO agent_ruleset.schema_migrations (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
COMMIT;
