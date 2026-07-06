---
name: email-sender
description: Guide AI agents to compose and send emails properly using the mcp-email server
version: 0.2.0
triggers:
  - send email
  - compose email
  - email someone
  - write an email
  - mail
---

# Email Sender Skill

You have access to an email MCP server (`mcp-email`) that can send emails via SMTP or Resend.

## When to use

Use the `send_email` tool when the user asks you to:
- Send an email to someone
- Compose and deliver a message
- Notify someone via email
- Follow up with someone by email

## How to use

1. **Confirm with the user** before sending. Always show them:
   - Recipient(s)
   - Subject line
   - Body content
   - Attachments (if any)

2. **Compose the email:**
   - Write a clear, professional subject line
   - Structure the body with proper greeting and sign-off
   - Keep it concise unless the user asks for more
   - Use plain text by default; use HTML only if formatting is needed

3. **Call the tool:**
   ```json
   {
     "to": ["recipient@example.com"],
     "subject": "Subject here",
     "body": "Email body here",
     "cc": ["optional@example.com"],
     "attachments": [{"path": "/path/to/file.pdf", "filename": "report.pdf"}]
   }
   ```

4. **Report the result** to the user.

## Rules

- **Never send without confirmation.** Always show the draft and ask "Should I send this?"
- **Never guess the recipient.** If the user says "email John" but you don't know John's address, ask.
- **Respect privacy.** Don't include sensitive information unless the user explicitly provides it.
- **Multiple recipients are supported.** Pass them as an array in `to`.
- **CC/BCC are optional.** Use when the user asks to copy someone.

## Attachments

You can attach files by providing either:
- `path` — absolute path to a file on disk
- `content_base64` — base64-encoded content (for generated content)

Always include a `filename` for clarity.

## Common patterns

### Professional email
```
Subject: [Brief, specific topic]

Hi [Name],

[1-2 sentences with the key point]

[Any necessary details]

Best,
[User's name if known]
```

### Quick notification
```
Subject: [Action item or update]

[Direct message, 1-3 sentences]
```

### Email with attachment
Show the user: "I'll send [file] to [recipient] with subject [subject]. Send it?"

## Error handling

- If credentials are not configured, tell the user they need to set up the MCP server environment variables.
- If sending fails, report the error and suggest checking credentials or recipient address.
- If an attachment path doesn't exist, report which file was not found.
