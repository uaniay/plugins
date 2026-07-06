---
name: email-sender
description: Guide AI agents to compose and send emails properly using the mcp-email server
version: 0.1.0
triggers:
  - send email
  - compose email
  - email someone
  - write an email
  - mail
---

# Email Sender Skill

You have access to an email MCP server (`mcp-email`) that can send emails via SMTP.

## When to use

Use the `send_email` tool when the user asks you to:
- Send an email to someone
- Compose and deliver a message
- Notify someone via email
- Follow up with someone by email

## How to use

1. **Confirm with the user** before sending. Always show them:
   - Recipient (to)
   - Subject line
   - Body content (formatted)

2. **Compose the email:**
   - Write a clear, professional subject line
   - Structure the body with proper greeting and sign-off
   - Keep it concise unless the user asks for a longer message
   - Use plain text by default; use HTML only if the user needs formatting (tables, links, etc.)

3. **Call the tool:**
   ```
   send_email(to="recipient@example.com", subject="...", body="...")
   ```

4. **Report the result** to the user.

## Rules

- **Never send without confirmation.** Always show the draft and ask "Should I send this?"
- **Never guess the recipient.** If the user says "email John" but you don't know John's address, ask.
- **Respect privacy.** Don't include sensitive information unless the user explicitly provides it.
- **One recipient per call.** For multiple recipients, make separate calls or ask the user to clarify.

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

## Error handling

- If SMTP credentials are not configured, tell the user they need to set up the MCP server with their SMTP credentials.
- If sending fails, report the error clearly and suggest checking credentials or recipient address.
