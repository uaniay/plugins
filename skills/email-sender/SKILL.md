---
name: email-sender
description: Guide AI agents to compose and send emails properly using the mcp-email server
version: 0.3.0
triggers:
  - send email
  - compose email
  - email someone
  - write an email
  - mail
---

# Email Sender Skill

You have access to an email MCP server (`mcp-email`) that can send emails via SMTP or Resend.

---

## Groups

- [Composition](#composition) — when and how to compose emails
- [Formatting Rules](#formatting-rules) — structure, links, tables, code
- [Tool Usage](#tool-usage) — MCP tool schema and parameters
- [Safety](#safety) — confirmation, privacy, validation
- [Scripts](#scripts) — available automation scripts

---

## Composition

Use the `send_email` tool when the user asks to send, compose, notify, or follow up by email.

**Workflow:**
1. Draft the email following → [email-format.md](references/email-format.md)
2. Validate the draft using → [scripts/validate-email-draft.py](scripts/validate-email-draft.py)
3. Show the draft to the user and ask: _"Should I send this?"_
4. Call the MCP tool — see → [mcp-tool-reference.md](references/mcp-tool-reference.md)
5. Report success or error to the user

---

## Formatting Rules

### Structure & Templates
→ [email-format.md](references/email-format.md)

- Every email must follow: Subject → Greeting → Body → Closing → Sign-off
- Always end with `Best regards,` — never omit
- Use the appropriate template: Standard / Notification / Data / Follow-up

### Links
→ [link-formatting.md](references/link-formatting.md)

- Never embed raw URLs mid-sentence
- HTML email: use `<a href="...">Label</a>` with descriptive text
- Plain text: place URL on its own line with a `Label: url` format
- 2+ links: group as a labeled list before the sign-off
- Never use URL shorteners; always use `https://`

### Tables & Data
→ [data-tables.md](references/data-tables.md)

- Wrap all tables in HTML `<table>` (HTML email) or markdown `| col |` syntax (plain text)
- Never use tab-separated or space-aligned raw data
- Numeric columns → right-align
- Wrap all code/commands in `<pre><code>` or triple backticks

---

## Tool Usage

→ [mcp-tool-reference.md](references/mcp-tool-reference.md)

Minimal call:
```json
{
  "to": ["recipient@example.com"],
  "subject": "Subject here",
  "body": "Email body"
}
```

Full call with all optional fields: see reference doc above.

---

## Safety

- **Never send without confirmation.** Always show the draft first.
- **Never guess the recipient.** If address is unknown, ask the user.
- **Respect privacy.** Don't include sensitive data unless the user explicitly provides it.
- If credentials are not configured, tell the user to set up MCP server env vars — see → [mcp-tool-reference.md](references/mcp-tool-reference.md)

---

## Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| [build-html-email.py](scripts/build-html-email.py) | Convert plain-text draft to styled HTML email | `python3 build-html-email.py --input draft.txt --output email.html` |
| [validate-email-draft.py](scripts/validate-email-draft.py) | Validate draft against formatting rules before sending | `python3 validate-email-draft.py --input draft.txt` |

Run the validator before every send to catch missing sign-offs, bare URLs, insecure links, and unformatted tables.
