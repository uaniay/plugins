# Plugins

Claude Code plugins — each subdirectory is an independent plugin.

## Structure

```
plugins/
├── <plugin-name>/
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── commands/       # Slash commands (optional)
│   ├── agents/         # Specialized agents (optional)
│   ├── skills/         # Skills (optional)
│   ├── hooks/          # Event handlers (optional)
│   └── README.md
```
