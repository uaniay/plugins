BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE agent_ruleset.rules DROP COLUMN IF EXISTS priority;

INSERT INTO agent_ruleset.schema_migrations(version)
VALUES (3)
ON CONFLICT (version) DO NOTHING;
COMMIT;
