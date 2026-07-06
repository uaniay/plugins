import asyncio
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from os import environ

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

server = Server("mcp-email")


def get_smtp_config() -> dict:
    return {
        "host": environ.get("SMTP_HOST", "smtp.gmail.com"),
        "port": int(environ.get("SMTP_PORT", "587")),
        "username": environ.get("SMTP_USERNAME", ""),
        "password": environ.get("SMTP_PASSWORD", ""),
        "from_address": environ.get("SMTP_FROM", environ.get("SMTP_USERNAME", "")),
        "use_tls": environ.get("SMTP_USE_TLS", "true").lower() == "true",
    }


def send_email(to: str, subject: str, body: str, html: bool = False) -> str:
    config = get_smtp_config()

    if not config["username"] or not config["password"]:
        return "Error: SMTP_USERNAME and SMTP_PASSWORD environment variables are required"

    msg = MIMEMultipart("alternative")
    msg["From"] = config["from_address"]
    msg["To"] = to
    msg["Subject"] = subject

    content_type = "html" if html else "plain"
    msg.attach(MIMEText(body, content_type))

    try:
        if config["use_tls"]:
            context = ssl.create_default_context()
            with smtplib.SMTP(config["host"], config["port"]) as smtp:
                smtp.starttls(context=context)
                smtp.login(config["username"], config["password"])
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(config["host"], config["port"]) as smtp:
                smtp.login(config["username"], config["password"])
                smtp.send_message(msg)

        return f"Email sent to {to}"
    except smtplib.SMTPAuthenticationError:
        return "Error: SMTP authentication failed. Check username and password."
    except smtplib.SMTPException as e:
        return f"Error: Failed to send email — {e}"


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="send_email",
            description="Send an email via SMTP. Requires SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD environment variables.",
            inputSchema={
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Recipient email address",
                    },
                    "subject": {
                        "type": "string",
                        "description": "Email subject line",
                    },
                    "body": {
                        "type": "string",
                        "description": "Email body content",
                    },
                    "html": {
                        "type": "boolean",
                        "description": "Whether body is HTML (default: false, plain text)",
                        "default": False,
                    },
                },
                "required": ["to", "subject", "body"],
            },
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "send_email":
        result = send_email(
            to=arguments["to"],
            subject=arguments["subject"],
            body=arguments["body"],
            html=arguments.get("html", False),
        )
        return [TextContent(type="text", text=result)]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


def main():
    asyncio.run(run())


async def run():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    main()
