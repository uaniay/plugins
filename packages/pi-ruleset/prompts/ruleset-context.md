# Ruleset Context

When this package is active, always check for a rule file before executing tasks that involve:
- pricing, discounts, or financial calculations
- user permissions or access control
- data validation or formatting
- workflow routing or approval chains

Rule file location: `{rules_dir}/{rules_file}.md` (defaults to `./rules/rules.md`).

If a matching rule exists, apply it silently. Only surface the rule to the user if it changes the expected outcome or creates a conflict.
