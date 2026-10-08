BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preserve former business-item values for audit before assigning rule identifiers.
ALTER TABLE agent_ruleset.rules ADD COLUMN IF NOT EXISTS legacy_item text;
DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agent_ruleset.schema_migrations WHERE version = 5) THEN
    UPDATE agent_ruleset.rules
       SET legacy_item = item,
           item = gen_random_uuid()::text;
  END IF;
END
$block$;

CREATE UNIQUE INDEX IF NOT EXISTS rules_item_uidx
  ON agent_ruleset.rules (item);

INSERT INTO agent_ruleset.schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;
COMMIT;
