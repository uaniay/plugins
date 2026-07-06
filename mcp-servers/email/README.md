# mcp-email

MCP server for sending emails. Supports SMTP and Resend providers.

## Installation

```bash
cd mcp-servers/email
uv sync
```

## Providers

Set `EMAIL_PROVIDER` to choose the backend:

| Provider | Value | Required env vars |
|----------|-------|-------------------|
| SMTP (default) | `smtp` | `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` |
| Resend | `resend` | `RESEND_API_KEY`, `RESEND_FROM` |

### SMTP Configuration

```bash
EMAIL_PROVIDER=smtp            # or omit (default)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=you@gmail.com        # defaults to SMTP_USERNAME
SMTP_USE_TLS=true              # default: true
```

### Resend Configuration

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM=you@yourdomain.com
```

## Usage

### With Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "email": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/mcp-servers/email", "mcp-email"],
      "env": {
        "EMAIL_PROVIDER": "smtp",
        "SMTP_HOST": "smtp.gmail.com",
        "SMTP_PORT": "587",
        "SMTP_USERNAME": "you@gmail.com",
        "SMTP_PASSWORD": "your-app-password"
      }
    }
  }
}
```

### Tools

**send_email** — Send an email

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| to | string[] | yes | Recipient email addresses |
| subject | string | yes | Email subject line |
| body | string | yes | Email body content |
| html | boolean | no | Whether body is HTML (default: plain text) |
| cc | string[] | no | CC recipients |
| bcc | string[] | no | BCC recipients |
| attachments | object[] | no | File attachments (see below) |

**Attachments format:**

```json
{
  "path": "/absolute/path/to/file.pdf",
  "filename": "report.pdf"
}
```

Or with base64 content:

```json
{
  "content_base64": "SGVsbG8gd29ybGQ=",
  "filename": "hello.txt"
}
```

## Gmail Setup

For Gmail, use an [App Password](https://myaccount.google.com/apppasswords):
1. Enable 2-Step Verification on your Google account
2. Generate an App Password for "Mail"
3. Use that as `SMTP_PASSWORD`

## Resend Setup

1. Sign up at [resend.com](https://resend.com)
2. Add and verify your domain
3. Create an API key
4. Set `RESEND_API_KEY` and `RESEND_FROM`
