# pi-ruleset

A Pi package for storing, managing, and applying business rules as structured per-day Markdown files.

## Install

```
pi install ./packages/pi-ruleset
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
