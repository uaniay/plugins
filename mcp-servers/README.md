# MCP Servers

Model Context Protocol servers — each subdirectory is an independent server.

## Structure

```
mcp-servers/
├── <server-name>/
│   ├── package.json or pyproject.toml
│   ├── src/
│   └── README.md
```

## Creating a new server

```bash
# TypeScript
mkdir mcp-servers/my-server && cd mcp-servers/my-server
pnpm init
pnpm add @modelcontextprotocol/sdk zod

# Python
mkdir mcp-servers/my-server && cd mcp-servers/my-server
uv init
uv add mcp
```
