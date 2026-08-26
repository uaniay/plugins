# Packages

Pi packages — each subdirectory is an independent package distributable via npm or git.

## Structure

```
packages/
├── <package-name>/
│   ├── package.json    # With "pi" manifest
│   ├── skills/         # Optional
│   ├── extensions/     # Optional
│   ├── prompts/        # Optional
│   └── README.md
```

## Packages

| Package | Description |
|---------|-------------|
| [pi-ruleset](./pi-ruleset) | Store and apply business rules as structured Markdown files |
