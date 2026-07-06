# AI Plugins

## What This Is

一个收纳仓库，存放用 AI coding agent 生成的各种工具和插件。包括 MCP servers、skills、Pi packages、Claude Code plugins。按类型分目录，每个工具独立、可独立发布。

## Core Value

清晰有序地管理所有 AI 工具产物，方便复用和分享。

## Context

- 日常用 Claude Code 等 agent 写工具，产物统一放这里
- 语言混合：TypeScript 和 Python，按工具需求选择
- 每个工具自成一体，有自己的 package.json 或 pyproject.toml
- 开源，独立发布到 npm 或 PyPI
- 不做平台、不做 package manager、不做共享库框架

**目录结构：**

```
plugins/
├── mcp-servers/    # MCP protocol servers（Python/TS）
├── skills/         # Agent skills（Markdown + code）
├── packages/       # Pi packages（extensions, prompts, themes）
├── plugins/        # Claude Code plugins（commands, agents, hooks）
```

## Constraints

- **独立性**: 每个工具自包含，不强制共享依赖
- **简单**: 不需要 monorepo 构建编排，各自管理
- **灵活**: 语言和工具链由具体工具决定

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 扁平分类目录 | 简单直观，按类型分即可 | ✓ Good |
| 不做 monorepo workspace | 工具间不互相依赖，没必要 | ✓ Good |
| 不做共享库 | 需要时再抽，不预设 | — Pending |

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 第一个 skill 完成并可用
- [ ] 第一个 MCP server 完成并可运行
- [ ] 第一个 Claude Code plugin 完成
- [ ] 第一个 Pi package 完成

### Out of Scope

- 共享库框架 — 不预设，需要时再抽
- Package manager / installer — 只写工具本身
- 统一构建系统 — 各工具独立管理

---
*Last updated: 2026-07-06 after initialization*
