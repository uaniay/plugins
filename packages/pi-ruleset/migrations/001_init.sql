-- pi-ruleset PostgreSQL schema
-- The schema must be created by the database administrator first:
--   CREATE SCHEMA billing_agent;
-- This migration only creates objects inside billing_agent.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS billing_agent.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_agent.rules (
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
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by_email text,
  updated_by_email text,
  source text NOT NULL DEFAULT 'postgres',
  PRIMARY KEY (namespace, id)
);

CREATE INDEX IF NOT EXISTS rules_namespace_status_idx
  ON billing_agent.rules (namespace, status);

CREATE INDEX IF NOT EXISTS rules_namespace_updated_idx
  ON billing_agent.rules (namespace, updated_at DESC);

CREATE TABLE IF NOT EXISTS billing_agent.rule_dimensions (
  namespace text NOT NULL,
  rule_id text NOT NULL,
  dimension_name text NOT NULL,
  dimension_value text NOT NULL,
  PRIMARY KEY (namespace, rule_id, dimension_name, dimension_value),
  FOREIGN KEY (namespace, rule_id)
    REFERENCES billing_agent.rules(namespace, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS rule_dimensions_lookup_idx
  ON billing_agent.rule_dimensions (namespace, dimension_name, dimension_value, rule_id);

CREATE TABLE IF NOT EXISTS billing_agent.rule_references (
  namespace text NOT NULL,
  rule_id text NOT NULL,
  reference text NOT NULL,
  PRIMARY KEY (namespace, rule_id, reference),
  FOREIGN KEY (namespace, rule_id)
    REFERENCES billing_agent.rules(namespace, id)
    ON DELETE CASCADE
);

INSERT INTO billing_agent.schema_migrations (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
COMMIT;
