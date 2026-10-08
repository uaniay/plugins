BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE billing_agent.rules DROP COLUMN IF EXISTS priority;

INSERT INTO billing_agent.schema_migrations(version)
VALUES (3)
ON CONFLICT (version) DO NOTHING;
COMMIT;
