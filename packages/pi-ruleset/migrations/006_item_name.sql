BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Keep the generated display name synchronized with the rule title.
ALTER TABLE agent_ruleset.rules
  ADD COLUMN IF NOT EXISTS item_name text GENERATED ALWAYS AS (title) STORED;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'agent_ruleset' AND table_name = 'rules'
       AND column_name = 'item_name' AND is_generated = 'ALWAYS'
  ) THEN
    RAISE EXCEPTION 'agent_ruleset.rules.item_name must be a generated column';
  END IF;
END
$block$;

INSERT INTO agent_ruleset.schema_migrations(version) VALUES (6) ON CONFLICT DO NOTHING;
COMMIT;
