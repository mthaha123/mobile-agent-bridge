# Mobile Agent Bridge

手机端通过 WebSocket 连接远程 AI 编码 Agent（OpenCode）的桥接服务。

```
手机 (React Native) ←──WS──→ Bridge (Node.js) ←──SDK──→ OpenCode Agent
```

---

## 项目结构

```
mobile-agent-bridge/
├── servers/bridge/              # Bridge 服务器 (Node.js + ws + @opencode-ai/sdk)
│   ├── src/server/              # WS 服务、JWT 认证、RPC 路由、文件操作
│   ├── src/adapters/            # OpenCode SDK 适配器
│   ├── src/state/               # 项目状态、SSE 生命周期
│   └── __tests__/               # 路由/认证/文件 handler 测试 (117 tests)
├── apps/mobile/                 # React Native 客户端 (Android)
│   ├── src/screens/             # 9 个页面 (Chat/Sessions/Connect/Settings 等)
│   ├── src/components/          # 6 个组件 (Markdown/ToolRenderer/AppProvider 等)
│   ├── src/stores/              # 11 个 Zustand Store
│   ├── src/services/            # BridgeClient (WS 客户端)
│   └── __tests__/               # Store/Screen/Component 测试 (571 tests)
├── packages/shared/             # 共享协议类型
├── scripts/                     # 构建/部署/E2E 脚本
│   └── e2e/                     # Mock Bridge、Layer Runner、RPC 测试
├── docs/                        # 设计文档
│   └── plans/                   # 实施计划
├── logs/
│   ├── build/                   # 编译/测试日志
│   ├── dumps/                   # UI hierarchy dump (adb)
│   └── screenshots/             # 测试截图
└── .maestro/flows/              # Maestro E2E flows
    ├── l1-smoke/                # Layer 1: 冒烟测试
    ├── l2-bridge-*.yaml         # Layer 2: Mock Bridge 集成测试
    └── l3-*.yaml                # Layer 3: UI 组件专项测试
```

---

## 快速开始

### 1. Bridge 服务器

```bash
cd servers/bridge
pnpm install
pnpm dev          # 启动 WS 服务器 (默认 :8080)
```

环境变量：
- `BRIDGE_PORT` — WS 端口（默认 `8080`）
- `BRIDGE_PASSWORD` — 连接密码（为空则不校验）
- `OPENCODE_URL` — OpenCode 服务端地址（默认 `http://localhost:4096`）

### 2. 手机客户端

```bash
cd apps/mobile
pnpm install
npx react-native run-android
```

### 3. E2E 验证（无需模拟器）

```bash
npm run e2e:test-rpcs     # 验证 5 个核心 RPC (9 断言)
```

---

## 核心功能

| 功能 | Bridge RPC | 客户端界面 |
|------|-----------|-----------|
| 连接/认证 | `auth.login/refresh/logout` | ConnectScreen |
| 会话管理 | `session.create/list/get/messages/delete/rename` | SessionsScreen |
| 消息通信 | `message.send/abort` + `message.shell/command` | ChatScreen |
| 流式显示 | SSE → WS notify (`text.delta`, `tool.called`, 等) | MarkdownRenderer |
| 工具审批 | `permission.reply` + 事件推送 | ToolApprovalSheet |
| 问答交互 | `question.reply/reject` | QuestionSheet |
| 文件浏览 | `file.list/read/search/info` | FileBrowserScreen |
| 配置查看 | `config.get/agents/providers` | SettingsScreen |
| 配置编辑 | `config.update` | SettingsScreen (JSON 编辑) |
| 权限管理 | `permission.saved.list/remove` | SettingsScreen |
| 项目切换 | `project.switch/current/list` | SessionsScreen |
| Agent/模型切换 | `session.switchAgent/switchModel` | ChatScreen / SlashSheet |
| 会话 Fork | `session.fork/children` | SessionInfoModal |

**共 46 个 RPC handler，40 个客户端调用接口，20+ 个 SSE 事件类型。**

---

## 测试

### 单元测试

```bash
npm run bridge:test               # Bridge: 117 tests
cd apps/mobile && npx jest        # Mobile: 571 tests
```

### E2E 测试

| 命令 | 说明 | 依赖 |
|------|------|------|
| `npm run e2e:test-rpcs` | RPC 协议验证（Node.js） | 无 |
| `npm run e2e:mock` | 启动 Mock Bridge | 无 |
| `npm run e2e:l1` | Layer 1 冒烟（Maestro） | 模拟器 |
| `npm run e2e:l2` | Layer 2 Mock 集成（Maestro）| 模拟器 |
| `npm run e2e:l3` | Layer 3 UI 组件（Maestro）| 模拟器 |
| `npm run e2e:all` | L1+L2+L3 全量 | 模拟器 |

---

## 架构

```
┌─────────────────┐     WS (一条连接)     ┌──────────────────┐     HTTP+SSE     ┌────────────────┐
│  手机客户端      │ ◄───────────────────► │  Bridge 服务器    │ ◄──────────────► │  OpenCode      │
│  (React Native)  │    req/res/notify     │  (Node.js)       │    @opencode-ai  │  Agent 服务    │
│                  │                      │  46 RPC handler   │    /sdk v2      │                │
│  9 screens       │                      │  JWT 认证         │                 │  会话持久化    │
│  6 components    │                      │  SSE→WS 转发      │                 │  LLM 推理      │
│  11 stores       │                      │  文件直接操作      │                 │  工具执行      │
└─────────────────┘                      └──────────────────┘                 └────────────────┘
```

### 协议

手机端只连一条 WebSocket，三种 JSON 帧：

| 帧类型 | 方向 | 用途 |
|--------|------|------|
| `req` | 手机 → Bridge | RPC 请求（带 `id` 匹配响应） |
| `res` | Bridge → 手机 | RPC 响应（`ok`/`error`） |
| `notify` | Bridge → 手机 | SSE 事件推送（透传事件名） |

---

## 设计文档

| 文档 | 内容 |
|------|------|
| `docs/STATUS.md` | 开发进度与待办 |
| `docs/03-architecture-design.md` | 架构与接口规格 |
| `docs/02-mobile-ui-feature-requirements.md` | UI 需求 |
| `docs/01-agent-systems-comparison.md` | OpenCode/Hermes/OpenClaw 对比 |
| `AGENTS.md` | AI 开发约束 |

---

## 技术栈

| 组件 | 技术 |
|------|------|
| Bridge 运行时 | Node.js 18+ |
| WebSocket | `ws` |
| SDK | `@opencode-ai/sdk` v2 |
| JWT | `jsonwebtoken` |
| 手机框架 | React Native + TypeScript |
| 状态管理 | Zustand |
| 测试框架 | Jest |
| E2E (Android) | Maestro (原生 Windows) |
