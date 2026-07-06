# AI Plugins

A collection of tools and extensions for AI agents — MCP servers, skills, packages, and plugins.

## Structure

```
mcp-servers/    # MCP protocol servers (Python/TypeScript)
skills/         # Agent skills (Markdown + code)
packages/       # Pi packages (extensions, prompts, themes)
plugins/        # Claude Code plugins (commands, agents, hooks)
```

## Adding a new tool

Drop a new directory under the appropriate category. Each tool is self-contained with its own `package.json` or `pyproject.toml`.

## Languages

- TypeScript (pnpm)
- Python (uv)
