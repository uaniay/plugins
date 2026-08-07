---
name: mcp-tool-reference
description: MCP email server tool schema, parameters, and SMTP configuration reference
---

# MCP Email Tool Reference

## Tool: `send_email`

### Schema

```json
{
  "to": ["recipient@example.com"],
  "subject": "Subject here",
  "body": "Email body — plain text or HTML",
  "cc": ["optional@example.com"],
  "bcc": ["hidden@example.com"],
  "attachments": [
    {
      "path": "/absolute/path/to/file.pdf",
      "filename": "report.pdf"
    }
  ]
}
```

### Parameters

| Parameter     | Type            | Required | Notes                                          |
|---------------|-----------------|----------|------------------------------------------------|
| `to`          | `string[]`      | Yes      | One or more recipient addresses                |
| `subject`     | `string`        | Yes      | Max 998 chars (RFC 5322); keep under 60        |
| `body`        | `string`        | Yes      | Plain text or HTML string                      |
| `cc`          | `string[]`      | No       | Carbon copy recipients                         |
| `bcc`         | `string[]`      | No       | Blind carbon copy — recipients cannot see this |
| `attachments` | `Attachment[]`  | No       | See Attachments section below                  |

### Attachments

Each attachment object supports:

| Field            | Type     | Notes                                         |
|------------------|----------|-----------------------------------------------|
| `path`           | `string` | Absolute file path on disk                    |
| `filename`       | `string` | Display name shown in email client            |
| `content_base64` | `string` | Use instead of `path` for generated content   |
| `mime_type`      | `string` | Optional; inferred from filename if omitted   |

## SMTP Configuration

Environment variables for the MCP server:

| Variable          | Purpose                                               | Default              |
|-------------------|-------------------------------------------------------|----------------------|
| `SMTP_HOST`       | Mail server hostname                                  | —                    |
| `SMTP_PORT`       | Server port                                           | `587`                |
| `SMTP_USERNAME`   | Auth username (usually the email address)             | —                    |
| `SMTP_PASSWORD`   | Auth password or app password                         | —                    |
| `SMTP_FROM`       | Sender address override                               | `SMTP_USERNAME`      |
| `SMTP_USE_TLS`    | Enable STARTTLS (port 587)                            | `true`               |
| `SMTP_USE_SSL`    | Enable direct SSL (port 465); set `TLS=false`         | `false`              |

### Provider Quick Reference

| Provider  | Host                    | Port | TLS    | SSL    |
|-----------|-------------------------|------|--------|--------|
| Gmail     | `smtp.gmail.com`        | 587  | `true` | `false`|
| Gmail     | `smtp.gmail.com`        | 465  | `false`| `true` |
| Outlook   | `smtp.office365.com`    | 587  | `true` | `false`|
| Resend    | `smtp.resend.com`       | 465  | `false`| `true` |
| Mailgun   | `smtp.mailgun.org`      | 587  | `true` | `false`|

## Error Codes

| Error                          | Likely cause                              | Action                                    |
|--------------------------------|-------------------------------------------|-------------------------------------------|
| `Authentication failed`        | Wrong credentials or app password needed  | Check `SMTP_USERNAME` / `SMTP_PASSWORD`   |
| `Connection refused`           | Wrong host or port                        | Verify `SMTP_HOST` and `SMTP_PORT`        |
| `TLS handshake error`          | TLS/SSL mismatch                          | Check `SMTP_USE_TLS` / `SMTP_USE_SSL`     |
| `Attachment not found`         | Invalid file path                         | Verify path exists before sending         |
| `Recipient address rejected`   | Invalid or blocked address                | Confirm address with user                 |
