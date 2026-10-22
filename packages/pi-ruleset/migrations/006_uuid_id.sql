-- Change rules.id from text to uuid.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE agent_ruleset.rules
  DROP CONSTRAINT rules_pkey,
  ALTER COLUMN id TYPE uuid USING id::uuid,
  ADD PRIMARY KEY (namespace, id);

INSERT INTO agent_ruleset.schema_migrations(version) VALUES (6) ON CONFLICT DO NOTHING;
COMMIT;
