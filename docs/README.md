# Mobile Agent Bridge — 设计文档

## 项目概述

手机通过 WebSocket 连接 Bridge 服务器，Bridge 通过 SDK 连接 Agent 服务器（OpenCode/Hermes/OpenClaw）。

```
手机 (React Native) ←──WS──→ Bridge (Node.js) ←──SDK──→ Agent (OpenCode)
```

## 快速导航

| 文档 | 用途 | 适合谁 |
|------|------|--------|
| [**STATUS.md**](./STATUS.md) | 开发进度：已完成/未完成/测试覆盖 | 所有人 |
| [**03-architecture-design.md**](./03-architecture-design.md) | 三层架构、协议格式、接口规格 | 开发者 |
| [**02-mobile-ui-feature-requirements.md**](./02-mobile-ui-feature-requirements.md) | 手机端 UI 功能需求 | 开发者 |
| [**05-tui-comparison.md**](./05-tui-comparison.md) | TUI 源码对比 + 插件系统 + 接口全量分析 | 开发者 |
| [**04-development-plan.md**](./04-development-plan.md) | 分阶段开发计划 | 项目管理 |
| [**01-agent-systems-comparison.md**](./01-agent-systems-comparison.md) | OpenCode/Hermes/OpenClaw 对比 | 调研 |
| [**code-reference/**](./code-reference/) | Bridge 适配器 + 客户端实现代码 | 开发者 |
| [**plans/**](./plans/) | 详细实施计划 | 开发者 |

## 按需阅读

**想了解项目做了什么？**
→ [STATUS.md](./STATUS.md)

**想了解接口规格？**
→ [03-architecture-design.md §1.5-§1.6](./03-architecture-design.md)（协议格式 + SDK 映射）

**想了解手机端要做什么？**
→ [02-mobile-ui-feature-requirements.md §3](./02-mobile-ui-feature-requirements.md)（功能规格）

**想了解 Bridge 怎么实现？**
→ [03-architecture-design.md §1.3](./03-architecture-design.md)（代理 vs 直接实现）
→ [code-reference/bridge-adapters.md](./code-reference/bridge-adapters.md)（OpenCode 适配器代码）

**想了解下一步做什么？**
→ [STATUS.md → 未完成](./STATUS.md)

---

*文档版本：2.0*
*最后更新：2026-07-13*
