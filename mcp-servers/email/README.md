# mcp-email

MCP server for sending emails via SMTP.

## Installation

```bash
cd mcp-servers/email
uv sync
```

## Configuration

Set environment variables:

```bash
SMTP_HOST=smtp.gmail.com       # SMTP server host
SMTP_PORT=587                  # SMTP server port
SMTP_USERNAME=you@gmail.com    # Login username
SMTP_PASSWORD=your-app-password # Login password (use app passwords for Gmail)
SMTP_FROM=you@gmail.com        # From address (defaults to SMTP_USERNAME)
SMTP_USE_TLS=true              # Use STARTTLS (default: true)
```

## Usage

### With Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "email": {
      "command": "uv",
      "args": ["run", "--directory", "/path/to/mcp-servers/email", "mcp-email"],
      "env": {
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
| to | string | yes | Recipient email address |
| subject | string | yes | Email subject line |
| body | string | yes | Email body content |
| html | boolean | no | Whether body is HTML (default: plain text) |

## Gmail Setup

For Gmail, use an [App Password](https://myaccount.google.com/apppasswords):
1. Enable 2-Step Verification on your Google account
2. Generate an App Password for "Mail"
3. Use that as `SMTP_PASSWORD`
