BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE agent_ruleset.rules ADD COLUMN IF NOT EXISTS customer text;
ALTER TABLE agent_ruleset.rules ADD COLUMN IF NOT EXISTS facility text;
ALTER TABLE agent_ruleset.rules ADD COLUMN IF NOT EXISTS item text;
ALTER TABLE agent_ruleset.rules ADD COLUMN IF NOT EXISTS cycle text;
ALTER TABLE agent_ruleset.rules ADD COLUMN IF NOT EXISTS reference_names jsonb;

DO $block$
BEGIN
  IF to_regclass('agent_ruleset.rule_dimensions') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE agent_ruleset.rules r
      SET customer = COALESCE((SELECT dimension_value FROM agent_ruleset.rule_dimensions d WHERE d.namespace=r.namespace AND d.rule_id=r.id AND d.dimension_name='customer' ORDER BY dimension_value LIMIT 1), 'all'),
          facility = COALESCE((SELECT dimension_value FROM agent_ruleset.rule_dimensions d WHERE d.namespace=r.namespace AND d.rule_id=r.id AND d.dimension_name IN ('facility','location') ORDER BY dimension_value LIMIT 1), 'all'),
          item = COALESCE((SELECT dimension_value FROM agent_ruleset.rule_dimensions d WHERE d.namespace=r.namespace AND d.rule_id=r.id AND d.dimension_name='item' ORDER BY dimension_value LIMIT 1), 'all'),
          cycle = COALESCE((SELECT dimension_value FROM agent_ruleset.rule_dimensions d WHERE d.namespace=r.namespace AND d.rule_id=r.id AND d.dimension_name='cycle' ORDER BY dimension_value LIMIT 1), 'all')
      WHERE customer IS NULL OR facility IS NULL OR item IS NULL OR cycle IS NULL
    $sql$;
  END IF;
  IF to_regclass('agent_ruleset.rule_references') IS NOT NULL THEN
    EXECUTE $sql$
      UPDATE agent_ruleset.rules r
      SET reference_names = COALESCE((SELECT jsonb_agg(reference ORDER BY reference) FROM agent_ruleset.rule_references rr WHERE rr.namespace=r.namespace AND rr.rule_id=r.id), '[]'::jsonb)
      WHERE reference_names IS NULL
    $sql$;
  END IF;
END
$block$;

UPDATE agent_ruleset.rules
SET customer=COALESCE(customer,'all'), facility=COALESCE(facility,'all'), item=COALESCE(item,'all'), cycle=COALESCE(cycle,'all'), reference_names=COALESCE(reference_names,'[]'::jsonb);

ALTER TABLE agent_ruleset.rules ALTER COLUMN customer SET DEFAULT 'all';
ALTER TABLE agent_ruleset.rules ALTER COLUMN customer SET NOT NULL;
ALTER TABLE agent_ruleset.rules ALTER COLUMN facility SET DEFAULT 'all';
ALTER TABLE agent_ruleset.rules ALTER COLUMN facility SET NOT NULL;
ALTER TABLE agent_ruleset.rules ALTER COLUMN item DROP DEFAULT;
ALTER TABLE agent_ruleset.rules ALTER COLUMN item SET NOT NULL;
ALTER TABLE agent_ruleset.rules ALTER COLUMN cycle SET DEFAULT 'all';
ALTER TABLE agent_ruleset.rules ALTER COLUMN cycle SET NOT NULL;
ALTER TABLE agent_ruleset.rules ALTER COLUMN reference_names SET DEFAULT '[]'::jsonb;
ALTER TABLE agent_ruleset.rules ALTER COLUMN reference_names SET NOT NULL;

CREATE INDEX IF NOT EXISTS rules_match_fields_idx
  ON agent_ruleset.rules (namespace, customer, facility, item, cycle);

DROP TABLE IF EXISTS agent_ruleset.rule_dimensions;
DROP TABLE IF EXISTS agent_ruleset.rule_references;

INSERT INTO agent_ruleset.schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
COMMIT;
