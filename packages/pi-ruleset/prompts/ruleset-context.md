# Ruleset Context

When this package is active, always check for a rule file before executing tasks that involve:
- pricing, discounts, or financial calculations
- user permissions or access control
- data validation or formatting
- workflow routing or approval chains

Use `ruleset_list` and `ruleset_get` to access the configured storage backend. For PostgreSQL, pass known customer/facility and other task dimensions. For Markdown, rules live in project `.pi/rules/` and/or global `~/.pi/agent/rules/` according to configuration.

Apply rules only when all required dimensions match (alternatives within one dimension use OR). Ask for missing task dimensions. Surface conflicts and rules that change the expected outcome.
