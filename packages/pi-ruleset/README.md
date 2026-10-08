# pi-ruleset

A Pi package for storing, managing, and applying business rules as structured per-day Markdown files.

## Install

```
pi install pi-ruleset@latest
```

## Features

- Rules stored as individual `.md` files under date-based directories (`YYYY-MM-DD/`)
- Central `RULES.md` index injected into every LLM context turn
- Semantic + algorithmic similarity detection on `ruleset_add` — prevents duplicates
- `ruleset_get` with natural language query for relevant rule retrieval before applying
- `references/` directory for reference documents linked from rules
- Soft-delete via `.archive/` — rules are never permanently lost

## Tools

| Tool | Description |
|------|-------------|
| `ruleset_add` | Add a rule with two-layer duplicate detection |
| `ruleset_update` | Update fields of an existing rule by ID |
| `ruleset_remove` | Archive a rule (recoverable) |
| `ruleset_list` | List all rules from the index |
| `ruleset_get` | Fetch full rule(s) by ID or semantic query |
| `ruleset_add_reference` | Add a reference Markdown doc to `references/` |

## Directory layout

```
rules/
├── RULES.md                      # Index
├── 2026-08-25/
│   ├── 001-discount-cap.md       # Each rule is an independent file
│   └── 002-approval-flow.md
└── references/
    └── pricing-policy.md         # Reference documents
```

## Similarity detection

When calling `ruleset_add`, the extension runs:

1. **Jaccard unigram similarity** on titles
2. **Bigram similarity** on title + summary combined
3. **Tag overlap score**

Weighted composite score ≥ 35% triggers a warning with candidate rules. The LLM then decides whether to update an existing rule or force-add a new one.

## Rule file format

```markdown
# 001: Discount Cap

- **Status:** active
- **Priority:** high
- **Tags:** pricing, discount
- **Created:** 2026-08-25
- **Updated:** 2026-08-25

## Summary

Maximum discount for any single order is 30%.

## Description

No order may receive a discount exceeding 30% unless explicitly approved by a manager.

## Conditions

- Order contains a discount field
- Discount value exceeds 30%

## Actions

- Cap the discount at 30%
- Notify the user that the maximum discount has been applied

## References

- [Pricing Policy](../references/pricing-policy.md)
```

## Configuration

All tools accept an optional `rules_dir` parameter to use a different base directory, enabling separate rulesets per domain.

## PostgreSQL storage

PostgreSQL storage supports add/list/get/update/archive/restore and reference documents. All queries use the configured schema and namespace. Runtime never executes DDL or falls back to Markdown when a database operation fails.

```json
{
  "pi-ruleset": {
    "storage": "postgres",
    "postgres": {
      "migration": "manual"
    }
  }
}
```

Set the connection fields separately in the process environment:

```sh
DB_HOST=bnp-prod-pgsql.czks4iqomak3.us-west-2.rds.amazonaws.com
DB_PORT=5432
DB_USER=aurora_user
DB_NAME=aurora
DB_PASSWORD=your-password
AGENT_NAME=default
```

The runtime passes the `DB_*` values separately to the PostgreSQL client. `DB_PORT` must be an integer from 1 through 65535. `AGENT_NAME` is used as the ruleset namespace; when it is unset, empty, or whitespace-only, the namespace defaults to `default`. The PostgreSQL schema defaults to `agent_ruleset` when omitted from the configuration.

`migration: manual` means the runtime never executes DDL or migration SQL. A database administrator must create the schema and apply the SQL files under `migrations/` before PostgreSQL storage is enabled.

Put the configuration above under the project's `.pi/settings.json`. Instances with the same database, schema, and `AGENT_NAME` share rules. Use different agent names for independent rulesets. PostgreSQL mode uses one namespace; `mode`, `rules_dir` and `target` are Markdown concepts (the latter two are rejected in PostgreSQL tools).

For the existing `agent_ruleset` schema, run in order:

```sh
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f migrations/001_init.sql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f migrations/002_storage.sql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f migrations/003_remove_priority.sql
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f migrations/004_fixed_match_fields.sql
```

The scripts are transactional and repeatable. A new installation creates the final table directly. Version 4 upgrades an existing empty pre-v4 table to the same layout and removes the obsolete dimension/reference tables; it rejects a nonempty table because there is no old rule data to migrate. PostgreSQL 13+ is required for `gen_random_uuid()`. PostgreSQL stores reference names as JSONB and does not persist priority; the Markdown backend retains its priority format. Runtime requires version 4 and only needs schema USAGE plus SELECT/INSERT/UPDATE/DELETE on its tables (SELECT suffices on schema_migrations); migration credentials may be separate.

PostgreSQL rules match on customer, facility, and cycle. Customer and facility each use a scope (`all` or `specific`) and separate nullable ID/name columns. For `all`, both identity columns must be NULL. For `specific`, at least one ID or name must be nonempty; both may be stored. Omitted scope and identity values mean `all`. `cycle` is `all` or a specified value. `item` is a unique generated rule identifier, not a business-item matching field. `item_name` is generated from the rule title and stays synchronized with it.

Use `customer_id`/`customer_name`, `facility_id`/`facility_name`, and `cycle` with `ruleset_list` or `ruleset_get` to retrieve applicable rules. When both sides have IDs, IDs determine the match; otherwise matching names may be used. The legacy `customer` and `facility` string parameters remain accepted as names. An optional `item` filters by exact generated identifier. Omit filters to inspect all rules. PostgreSQL results are ordered by specificity and update time; sorting does not silently override conflicting rules.

For new rules, use explicit ID/name parameters. The legacy `customer`/`facility` shorthand is interpreted as a name. Names can change or collide; prefer stable IDs when available.

Creation/update timestamps use UTC instants. Creator/editor email comes from the configured authenticated `user_context` API when available; otherwise it remains unknown (NULL). It is not an access-control mechanism. `ruleset_remove` archives without deleting data; `ruleset_restore` restores a known archived ID. `ruleset_add_reference` stores document content in PostgreSQL; use `ruleset_get_reference` to read it.

Search remains lexical BM25 in memory, with a single-rule fallback and Chinese character tokenization. All namespace candidates are currently loaded, so pagination and database-side search are future scalability improvements. Existing Markdown data is not automatically imported or synchronized.

Validation:

```sh
npm ci
npm run typecheck
npm test
# Disposable test database ONLY: integration tests create agent_ruleset tables.
PI_RULESET_TEST_DATABASE_URL='postgresql://...' npm test
```

Without the test URL, integration cases are skipped. Never point the test URL at the shared production database.
