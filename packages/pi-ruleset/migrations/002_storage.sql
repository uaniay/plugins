BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE agent_ruleset.rules ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE TABLE IF NOT EXISTS agent_ruleset.reference_documents (
  namespace text NOT NULL,
  name text NOT NULL,
  content text NOT NULL,
  PRIMARY KEY (namespace, name)
);
INSERT INTO agent_ruleset.schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
