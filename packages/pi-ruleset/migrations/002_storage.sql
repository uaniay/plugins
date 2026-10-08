BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE billing_agent.rules ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE TABLE IF NOT EXISTS billing_agent.reference_documents (
  namespace text NOT NULL,
  name text NOT NULL,
  content text NOT NULL,
  PRIMARY KEY (namespace, name)
);
INSERT INTO billing_agent.schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
COMMIT;
