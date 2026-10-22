# Ruleset Context

When this package is active, check for a billing rule before executing tasks that involve:
- invoice line item calculation or charge computation (billing handling)
- fee schedules, billing item matching, or surcharge logic
- how billing amounts are stored, aggregated, or carried across cycles (billing storage)

Do **not** apply rules for user permissions, access control, data validation unrelated to billing, UI behavior, or general workflow routing. Rules in this store are billing-scoped only.

## Required environment variables

`AGENT_USER_EMAIL` and `AGENT_NAME` are mandatory. There are no defaults.

- `AGENT_USER_EMAIL` — creator identity recorded on every new rule. Missing this causes `ruleset_add` to fail.
- `AGENT_NAME` — must contain `handling` or `storage`. Determines which billing type namespace this agent may access. Missing or unrecognised value causes all rule tools to fail.

All calls to `ruleset_add`, `ruleset_list`, and `ruleset_get` must pass `billing_type` explicitly (`"handling"` or `"storage"`). It must match the type derived from `AGENT_NAME`.

Use `ruleset_list` and `ruleset_get` to access the configured storage backend. For PostgreSQL, infer customer and facility IDs/names and the cycle from recent context. Use `customer_id`/`customer_name` and `facility_id`/`facility_name` for specific scopes; at least one ID or name is required for each specific scope. Use `customer_scope: "all"` or `facility_scope: "all"` for unrestricted scopes, with no identity values. Prefer IDs when known, and include names when also known. Each new rule receives a generated unique `item` identifier and an `item_name` generated from its title; do not supply either when creating a rule. For Markdown, rules live in project `.pi/rules/` and/or global `~/.pi/agent/rules/` according to configuration.

Apply rules only when customer, facility, and cycle match; `all` matches any value. If both sides provide IDs, compare IDs first. Otherwise compare names when available. `item` identifies a rule and is only for exact lookup. Use the most specific recent context available. Ask for a missing field that the rule explicitly restricts. Surface conflicts and rules that change the expected outcome.
