---
name: ruleset
description: Manage business rules stored as per-day structured Markdown files with BM25 semantic retrieval
version: 0.3.0
triggers:
  - add rule
  - remove rule
  - delete rule
  - update rule
  - list rules
  - show rules
  - apply rules
  - check rules
  - get rule
  - find rule
  - record this as a rule
  - save this rule
  - remember this rule
  - this should be a rule
  - make this a rule
  - note this rule
  - according to the rule
  - based on the rule
  - follow the rule
  - use the rule
  - apply the rule
  - per the rule
  - as per our rule
  - rule says
  - 根据规则
  - 按照规则
  - 依据规则
  - 用规则计算
  - 规则要求
  - 规则规定
---

# Ruleset Skill

Business rules are stored as individual Markdown files under date-based directories (`./rules/YYYY-MM-DD/`). Rules are automatically injected into every agent turn — full content when fewer than 10 rules are active, index-only when 10 or more.

---

## Conversational rule capture

When the user says something like:
- "记录一条规则：所有退款必须在 24 小时内处理"
- "这应该作为规则保存下来"
- "以后遇到这种情况都要这样处理"
- "remember this rule" / "save this as a rule"

Extract the intent and call `ruleset_add` with:
- `title`: short imperative phrase
- `summary`: one sentence
- `description`: full context from the conversation
- `conditions`: inferred from the user's scenario
- `actions`: inferred from the user's intended outcome
- `priority`: infer from urgency language ("always", "never", "must" → high)
- `tags`: infer from domain keywords

Confirm with the user after saving: _"Rule saved: {id} — {title}"_

---

## Tools

| Tool | When to use |
|------|-------------|
| `ruleset_add` | User asks to add, record, save, or remember a rule |
| `ruleset_update` | User asks to change, edit, enable, or disable a rule |
| `ruleset_remove` | User asks to delete or remove a rule by ID |
| `ruleset_list` | User asks to see or list all rules |
| `ruleset_get` | Before applying a rule — fetch full content by ID or semantic query |
| `ruleset_add_reference` | User wants to attach a reference document to the ruleset |

---

## Rule loading on session start

Rules load automatically:
- **< 10 active rules**: full rule content injected into every agent turn — no extra call needed
- **≥ 10 active rules**: index injected; call `ruleset_get` with a semantic `query` to load relevant rules before applying

---

## Workflow: applying rules

1. Rules are already in context — check if any apply to the current task
2. If index-only mode: call `ruleset_get` with a descriptive query
3. Read conditions and actions fully before applying
4. Apply silently; surface to user only when the rule changes the expected outcome

---

## Workflow: user references a rule by name or topic

When the user says things like:
- "根据折扣规则计算这个订单"
- "按照访客权限规则处理"
- "用审批规则检查这笔订单"
- "according to the discount rule, calculate..."
- "apply the approval rule to this"

1. Extract the rule reference keyword from the user's message (e.g. "折扣", "审批", "访客权限")
2. If < 10 rules active, full content is already in context — find the matching rule directly, skip `ruleset_get`
3. If ≥ 10 rules: call `ruleset_get` with `query` set to the extracted keyword
4. Read the rule's conditions and actions, then execute the task using that logic
5. Cite which rule was applied: _"Applied rule {id}: {title}"_

If no matching rule is found: _"No rule found matching '{keyword}'. Use `ruleset_add` to create one."_

---

## Workflow: adding a rule

1. Call `ruleset_add` — BM25 similarity check runs automatically
2. If similar rules returned: decide whether to update existing or force-add new
3. Confirm to user after save

---

## Directory layout

```
rules/
├── RULES.md                      # Index — injected into context each turn
├── 2026-08-25/
│   ├── 001-discount-cap.md
│   └── 002-approval-flow.md
└── references/
    └── pricing-policy.md
```

---

## Rule priority

`high` → `medium` → `low`. Rules with `status: inactive` are skipped.

