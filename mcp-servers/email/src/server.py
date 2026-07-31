import base64
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from os import environ
from pathlib import Path

import httpx
from mcp.server import MCPServer

server = MCPServer("mcp-email")


def get_provider() -> str:
    return environ.get("EMAIL_PROVIDER", "smtp").lower()


def get_smtp_config() -> dict:
    return {
        "host": environ.get("SMTP_HOST", "smtp.gmail.com"),
        "port": int(environ.get("SMTP_PORT", "587")),
        "username": environ.get("SMTP_USERNAME", ""),
        "password": environ.get("SMTP_PASSWORD", ""),
        "from_address": environ.get("SMTP_FROM", environ.get("SMTP_USERNAME", "")),
        "use_tls": environ.get("SMTP_USE_TLS", "true").lower() == "true",
        "use_ssl": environ.get("SMTP_USE_SSL", "false").lower() == "true",
    }


def get_resend_config() -> dict:
    return {
        "api_key": environ.get("RESEND_API_KEY", ""),
        "from_address": environ.get("RESEND_FROM", ""),
    }


def send_via_smtp(
    to: list[str],
    subject: str,
    body: str,
    html: bool = False,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    attachments: list[dict] | None = None,
) -> str:
    config = get_smtp_config()

    if not config["username"] or not config["password"]:
        return "Error: SMTP_USERNAME and SMTP_PASSWORD environment variables are required"

    msg = MIMEMultipart("mixed")
    msg["From"] = config["from_address"]
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    if cc:
        msg["Cc"] = ", ".join(cc)

    content_type = "html" if html else "plain"
    msg.attach(MIMEText(body, content_type))

    if attachments:
        for att in attachments:
            part = MIMEBase("application", "octet-stream")
            if "path" in att:
                file_path = Path(att["path"])
                if not file_path.exists():
                    return f"Error: Attachment not found — {att['path']}"
                part.set_payload(file_path.read_bytes())
                filename = att.get("filename", file_path.name)
            elif "content_base64" in att:
                part.set_payload(base64.b64decode(att["content_base64"]))
                filename = att.get("filename", "attachment")
            else:
                continue
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", f"attachment; filename=\"{filename}\"")
            msg.attach(part)

    all_recipients = list(to)
    if cc:
        all_recipients.extend(cc)
    if bcc:
        all_recipients.extend(bcc)

    try:
        if config["use_ssl"]:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(config["host"], config["port"], context=context) as smtp:
                smtp.login(config["username"], config["password"])
                smtp.sendmail(config["from_address"], all_recipients, msg.as_string())
        elif config["use_tls"]:
            context = ssl.create_default_context()
            with smtplib.SMTP(config["host"], config["port"]) as smtp:
                smtp.starttls(context=context)
                smtp.login(config["username"], config["password"])
                smtp.sendmail(config["from_address"], all_recipients, msg.as_string())
        else:
            with smtplib.SMTP(config["host"], config["port"]) as smtp:
                smtp.login(config["username"], config["password"])
                smtp.sendmail(config["from_address"], all_recipients, msg.as_string())

        return f"Email sent to {', '.join(to)}"
    except smtplib.SMTPAuthenticationError:
        return "Error: SMTP authentication failed. Check username and password."
    except smtplib.SMTPException as e:
        return f"Error: Failed to send email — {e}"


def send_via_resend(
    to: list[str],
    subject: str,
    body: str,
    html: bool = False,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    attachments: list[dict] | None = None,
) -> str:
    config = get_resend_config()

    if not config["api_key"]:
        return "Error: RESEND_API_KEY environment variable is required"
    if not config["from_address"]:
        return "Error: RESEND_FROM environment variable is required (e.g. you@yourdomain.com)"

    payload: dict = {
        "from": config["from_address"],
        "to": to,
        "subject": subject,
    }

    if html:
        payload["html"] = body
    else:
        payload["text"] = body

    if cc:
        payload["cc"] = cc
    if bcc:
        payload["bcc"] = bcc

    if attachments:
        att_list = []
        for att in attachments:
            if "path" in att:
                file_path = Path(att["path"])
                if not file_path.exists():
                    return f"Error: Attachment not found — {att['path']}"
                content = base64.b64encode(file_path.read_bytes()).decode()
                filename = att.get("filename", file_path.name)
            elif "content_base64" in att:
                content = att["content_base64"]
                filename = att.get("filename", "attachment")
            else:
                continue
            att_list.append({"filename": filename, "content": content})
        if att_list:
            payload["attachments"] = att_list

    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        if resp.status_code in (200, 201):
            return f"Email sent to {', '.join(to)} (via Resend)"
        else:
            return f"Error: Resend API returned {resp.status_code} — {resp.text}"
    except httpx.HTTPError as e:
        return f"Error: Failed to send email via Resend — {e}"


@server.tool()
def send_email(
    to: list[str],
    subject: str,
    body: str,
    html: bool = False,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    attachments: list[dict] | None = None,
) -> str:
    """Send an email. Supports SMTP and Resend providers. Set EMAIL_PROVIDER=resend to use Resend API.

    Args:
        to: Recipient email addresses
        subject: Email subject line
        body: Email body content
        html: Whether body is HTML (default: false, plain text)
        cc: CC recipients (optional)
        bcc: BCC recipients (optional)
        attachments: File attachments (optional). Each item needs 'path' or 'content_base64', plus optional 'filename'.
    """
    if isinstance(to, str):
        to = [to]
    provider = get_provider()
    if provider == "resend":
        return send_via_resend(to, subject, body, html, cc, bcc, attachments)
    return send_via_smtp(to, subject, body, html, cc, bcc, attachments)


def main():
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
