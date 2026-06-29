# Mobile Agent Bridge - 设计文档

## 概述

本项目是一个连接 AI 编码 Agent 服务器（OpenCode、Hermes、OpenClaw）的手机客户端桥接工具。提供移动优先的界面，用于与远程服务器上运行的编码 Agent 进行交互。

## 架构

```
┌─────────────────┐    WebSocket    ┌─────────────────┐    SDK/HTTP    ┌──────────────┐
│  手机客户端      │◀══════════════▶│  Bridge 服务器   │◀═════════════▶│ Agent 服务器  │
│  (React Native) │   JSON帧       │  (Node.js)      │  @opencode-ai │  (OpenCode)  │
│  (ArkUI 鸿蒙)   │   双向推送      │  +内网穿透       │  /sdk         │              │
└─────────────────┘                └─────────────────┘                └──────────────┘
```

## 文档清单

| 文档 | 描述 | 状态 |
|------|------|------|
| [01-agent-systems-comparison.md](./01-agent-systems-comparison.md) | OpenCode、Hermes、OpenClaw 三方对比 | ✅ 完成 |
| [02-mobile-ui-feature-requirements.md](./02-mobile-ui-feature-requirements.md) | 手机端 UI 功能需求规格 | ✅ 完成 |
| [03-architecture-design.md](./03-architecture-design.md) | 技术架构设计 | ✅ 完成 |
| [04-development-plan.md](./04-development-plan.md) | 分阶段开发计划 | ✅ 完成 |

## 快速开始

### 核心功能（Phase 1）

1. **服务器连接** - 通过 HTTP/SSE 连接 OpenCode 服务器
2. **聊天界面** - 发送消息，接收流式响应
3. **会话管理** - 创建、切换、删除会话

### 增强功能（Phase 2）

4. **工具审批** - 批准/拒绝 Agent 工具执行
5. **文件浏览器** - 导航项目目录
6. **文件查看器** - 查看带语法高亮的代码

### 高级功能（Phase 3）

7. **离线模式** - 缓存会话供离线使用
8. **推送通知** - Agent 需要输入时通知
9. **语音输入** - 免提交互

## 技术栈

| 组件 | 技术 |
|------|------|
| 移动端（Android/iOS） | React Native + TypeScript |
| 移动端（HarmonyOS） | ArkUI (ArkTS) |
| 状态管理 | Zustand |
| HTTP 客户端 | Axios |
| Markdown | react-native-markdown |
| Bridge 服务器 | Node.js + Express |
| 数据库 | SQLite |

## 开发时间线

- **第 1-4 周**: Phase 1 - 核心 MVP
- **第 5-8 周**: Phase 2 - 增强功能
- **第 9-12 周**: Phase 3 - 生产就绪

## 开始开发

详细实施计划请参见 [04-development-plan.md](./04-development-plan.md)。

## 许可证

MIT
