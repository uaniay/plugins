# Requirements: AI Plugins

**Defined:** 2026-07-06
**Core Value:** 清晰有序地管理所有 AI 工具产物，方便复用和分享

## v1 Requirements

### Skills

- [ ] **SKILL-01**: 第一个 skill 遵循 Agent Skills 标准（SKILL.md + 有效 frontmatter）
- [ ] **SKILL-02**: skill 内容对 AI agent 有实际价值
- [ ] **SKILL-03**: 兼容 Claude Code、Cursor、Pi 等主流 agent

### MCP Servers

- [ ] **MCP-01**: 第一个 MCP server 实现至少一个 tool
- [ ] **MCP-02**: 支持 stdio transport
- [ ] **MCP-03**: 可通过 npx 或 uvx 直接运行
- [ ] **MCP-04**: README 包含安装和使用说明

### Plugins

- [ ] **PLUG-01**: 第一个 Claude Code plugin 包含有效的 plugin.json
- [ ] **PLUG-02**: plugin 至少包含一个 skill 或 command

### Packages

- [ ] **PKG-01**: 第一个 Pi package 结构正确（pi manifest + skills）
- [ ] **PKG-02**: 可通过 npm/git 安装

## v2 Requirements

- **ADV-01**: 更多 MCP servers 覆盖不同场景
- **ADV-02**: Skills 覆盖常见开发工作流
- **ADV-03**: CI 自动测试
- **ADV-04**: 发布到 npm/PyPI

## Out of Scope

| Feature | Reason |
|---------|--------|
| Package manager | 只写工具本身 |
| 共享库框架 | 不预设，需要时再抽 |
| 统一构建系统 | 各工具独立 |
| 文档站 | README 足够 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SKILL-01 | Phase 1 | Pending |
| SKILL-02 | Phase 1 | Pending |
| SKILL-03 | Phase 1 | Pending |
| MCP-01 | Phase 2 | Pending |
| MCP-02 | Phase 2 | Pending |
| MCP-03 | Phase 2 | Pending |
| MCP-04 | Phase 2 | Pending |
| PLUG-01 | Phase 3 | Pending |
| PLUG-02 | Phase 3 | Pending |
| PKG-01 | Phase 4 | Pending |
| PKG-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-06*
