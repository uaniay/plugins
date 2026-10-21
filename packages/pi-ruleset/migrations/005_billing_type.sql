-- Add billing_type column to distinguish billing handling rules from billing storage rules.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE agent_ruleset.rules
  ADD COLUMN IF NOT EXISTS billing_type text NOT NULL DEFAULT 'handling'
    CHECK (billing_type IN ('handling', 'storage'));

CREATE INDEX IF NOT EXISTS rules_billing_type_idx
  ON agent_ruleset.rules (namespace, billing_type);

INSERT INTO agent_ruleset.schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;
COMMIT;
