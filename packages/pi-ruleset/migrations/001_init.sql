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
  customer_scope text NOT NULL DEFAULT 'all',
  customer_id text,
  customer_name text,
  facility_scope text NOT NULL DEFAULT 'all',
  facility_id text,
  facility_name text,
  item text NOT NULL DEFAULT gen_random_uuid()::text,
  item_name text GENERATED ALWAYS AS (title) STORED,
  cycle text NOT NULL DEFAULT 'all',
  reference_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by_email text,
  updated_by_email text,
  source text NOT NULL DEFAULT 'postgres',
  archived_at timestamptz,
  PRIMARY KEY (namespace, id),
  CONSTRAINT rules_customer_identity_chk CHECK (
    (customer_scope = 'all' AND customer_id IS NULL AND customer_name IS NULL) OR
    (customer_scope = 'specific' AND
     (NULLIF(btrim(customer_id), '') IS NOT NULL OR NULLIF(btrim(customer_name), '') IS NOT NULL) AND
     (customer_id IS NULL OR NULLIF(btrim(customer_id), '') IS NOT NULL) AND
     (customer_name IS NULL OR NULLIF(btrim(customer_name), '') IS NOT NULL))
  ),
  CONSTRAINT rules_facility_identity_chk CHECK (
    (facility_scope = 'all' AND facility_id IS NULL AND facility_name IS NULL) OR
    (facility_scope = 'specific' AND
     (NULLIF(btrim(facility_id), '') IS NOT NULL OR NULLIF(btrim(facility_name), '') IS NOT NULL) AND
     (facility_id IS NULL OR NULLIF(btrim(facility_id), '') IS NOT NULL) AND
     (facility_name IS NULL OR NULLIF(btrim(facility_name), '') IS NOT NULL))
  )
);

CREATE INDEX IF NOT EXISTS rules_namespace_status_idx
  ON agent_ruleset.rules (namespace, status);

CREATE INDEX IF NOT EXISTS rules_namespace_updated_idx
  ON agent_ruleset.rules (namespace, updated_at DESC);

INSERT INTO agent_ruleset.schema_migrations (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;
COMMIT;
