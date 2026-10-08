-- Bring an existing empty pre-v4 rules table to the final layout.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_ruleset.schema_migrations WHERE version = 4)
     AND EXISTS (SELECT 1 FROM agent_ruleset.rules) THEN
    RAISE EXCEPTION 'pi-ruleset migration 004 requires an empty rules table';
  END IF;
END
$block$;

ALTER TABLE agent_ruleset.rules
  ADD COLUMN IF NOT EXISTS customer_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS facility_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS facility_id text,
  ADD COLUMN IF NOT EXISTS facility_name text,
  ADD COLUMN IF NOT EXISTS item text,
  ADD COLUMN IF NOT EXISTS item_name text GENERATED ALWAYS AS (title) STORED,
  ADD COLUMN IF NOT EXISTS cycle text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS reference_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE agent_ruleset.rules
  ALTER COLUMN item SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN item SET NOT NULL;

ALTER TABLE agent_ruleset.rules DROP COLUMN IF EXISTS customer;
ALTER TABLE agent_ruleset.rules DROP COLUMN IF EXISTS facility;
ALTER TABLE agent_ruleset.rules DROP COLUMN IF EXISTS legacy_item;

DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'agent_ruleset.rules'::regclass AND conname = 'rules_customer_identity_chk') THEN
    ALTER TABLE agent_ruleset.rules ADD CONSTRAINT rules_customer_identity_chk CHECK (
      (customer_scope = 'all' AND customer_id IS NULL AND customer_name IS NULL) OR
      (customer_scope = 'specific' AND
       (NULLIF(btrim(customer_id), '') IS NOT NULL OR NULLIF(btrim(customer_name), '') IS NOT NULL) AND
       (customer_id IS NULL OR NULLIF(btrim(customer_id), '') IS NOT NULL) AND
       (customer_name IS NULL OR NULLIF(btrim(customer_name), '') IS NOT NULL))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'agent_ruleset.rules'::regclass AND conname = 'rules_facility_identity_chk') THEN
    ALTER TABLE agent_ruleset.rules ADD CONSTRAINT rules_facility_identity_chk CHECK (
      (facility_scope = 'all' AND facility_id IS NULL AND facility_name IS NULL) OR
      (facility_scope = 'specific' AND
       (NULLIF(btrim(facility_id), '') IS NOT NULL OR NULLIF(btrim(facility_name), '') IS NOT NULL) AND
       (facility_id IS NULL OR NULLIF(btrim(facility_id), '') IS NOT NULL) AND
       (facility_name IS NULL OR NULLIF(btrim(facility_name), '') IS NOT NULL))
    );
  END IF;
END
$block$;

CREATE UNIQUE INDEX IF NOT EXISTS rules_item_uidx ON agent_ruleset.rules (item);
CREATE INDEX IF NOT EXISTS rules_customer_identity_idx
  ON agent_ruleset.rules (namespace, customer_scope, customer_id, customer_name);
CREATE INDEX IF NOT EXISTS rules_facility_identity_idx
  ON agent_ruleset.rules (namespace, facility_scope, facility_id, facility_name);

DROP TABLE IF EXISTS agent_ruleset.rule_dimensions;
DROP TABLE IF EXISTS agent_ruleset.rule_references;

INSERT INTO agent_ruleset.schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
COMMIT;
