# Roadmap: AI Plugins

## Overview

每个 phase 产出一种类型的第一个工具，验证该类型的工作流。

## Phases

- [ ] **Phase 1: First Skill** - 写第一个有实际价值的 Agent Skill
- [ ] **Phase 2: First MCP Server** - 写第一个可运行的 MCP server
- [ ] **Phase 3: First Plugin** - 写第一个 Claude Code plugin
- [ ] **Phase 4: First Package** - 写第一个 Pi package

## Phase Details

### Phase 1: First Skill
**Goal**: 产出一个遵循 Agent Skills 标准、对 AI agent 有实际价值的 skill
**Requirements**: SKILL-01, SKILL-02, SKILL-03
**Success Criteria:**
  1. skills/ 下有一个完整的 skill 目录
  2. SKILL.md 有正确的 frontmatter
  3. 在 Claude Code 中可正常加载使用

### Phase 2: First MCP Server
**Goal**: 产出一个可通过 npx/uvx 运行的 MCP server
**Depends on**: Nothing
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04
**Success Criteria:**
  1. mcp-servers/ 下有一个完整的 server
  2. stdio transport 正常工作
  3. 至少一个 tool 可被 MCP client 调用

### Phase 3: First Plugin
**Goal**: 产出一个符合 Claude Code 规范的 plugin
**Depends on**: Nothing
**Requirements**: PLUG-01, PLUG-02
**Success Criteria:**
  1. plugins/ 下有一个完整的 plugin 目录
  2. plugin.json manifest 有效
  3. Claude Code 可加载该 plugin

### Phase 4: First Package
**Goal**: 产出一个可安装的 Pi package
**Depends on**: Nothing
**Requirements**: PKG-01, PKG-02
**Success Criteria:**
  1. packages/ 下有一个完整的 package
  2. pi manifest 结构正确
  3. 可通过 npm install 安装

## Progress

| Phase | Status | Completed |
|-------|--------|-----------|
| 1. First Skill | Not started | - |
| 2. First MCP Server | Not started | - |
| 3. First Plugin | Not started | - |
| 4. First Package | Not started | - |
