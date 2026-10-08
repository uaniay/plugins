BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE agent_ruleset.rules
  ADD COLUMN IF NOT EXISTS customer_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS customer_id text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS facility_scope text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS facility_id text,
  ADD COLUMN IF NOT EXISTS facility_name text;

-- Earlier migrations may be replayed, or this migration may run alone.
ALTER TABLE agent_ruleset.rules
  ADD COLUMN IF NOT EXISTS customer text,
  ADD COLUMN IF NOT EXISTS facility text;

-- Old text values do not record whether they are IDs or names. Preserve them
-- as names; operators can later correct known IDs without losing the value.
UPDATE agent_ruleset.rules
   SET customer_scope = 'specific', customer_name = customer
 WHERE customer <> 'all' AND customer_scope = 'all'
   AND customer_id IS NULL AND customer_name IS NULL;
UPDATE agent_ruleset.rules
   SET facility_scope = 'specific', facility_name = facility
 WHERE facility <> 'all' AND facility_scope = 'all'
   AND facility_id IS NULL AND facility_name IS NULL;

ALTER TABLE agent_ruleset.rules DROP COLUMN IF EXISTS customer;
ALTER TABLE agent_ruleset.rules DROP COLUMN IF EXISTS facility;

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

CREATE INDEX IF NOT EXISTS rules_customer_identity_idx
  ON agent_ruleset.rules (namespace, customer_scope, customer_id, customer_name);
CREATE INDEX IF NOT EXISTS rules_facility_identity_idx
  ON agent_ruleset.rules (namespace, facility_scope, facility_id, facility_name);

INSERT INTO agent_ruleset.schema_migrations(version) VALUES (7) ON CONFLICT DO NOTHING;
COMMIT;
