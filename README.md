# Mobile Agent Bridge

手机端通过 WebSocket 连接远程 AI 编码 Agent（OpenCode）的桥接服务。

```
手机 (React Native) ←──WS──→ Bridge (Node.js) ←──SDK──→ OpenCode Agent
```

---

## 项目结构

```
mobile-agent-bridge/
├── servers/bridge/                    # Bridge 服务器 (Node.js)
│   ├── src/
│   │   ├── server/                    # ws.ts, auth.ts, router.ts, fileHandler.ts
│   │   ├── adapters/                  # OpenCodeAdapter.ts
│   │   └── state/                     # project.ts (SSE 生命周期)
│   ├── __tests__/                     # 3 测试文件 (router/auth/fileHandler)
│   └── scripts/                       # E2E/验证脚本
├── apps/mobile/                       # React Native 客户端 (Android)
│   ├── src/
│   │   ├── screens/                   # 9 页面
│   │   ├── components/                # 6 UI 组件
│   │   ├── stores/                    # 12 Zustand Store
│   │   ├── services/                  # BridgeClient.ts
│   │   └── types/                     # 类型定义
│   ├── __tests__/                     # 29 测试文件
│   └── __mocks__/                     # Jest 全局 Mock
├── packages/shared/src/               # 共享协议类型
├── scripts/                           # 构建/部署/E2E 脚本
│   ├── e2e/                           # Mock Bridge、Layer Runner
│   ├── build-*.ps1/bat                # Android APK 构建
│   └── start_*.ps1/bat                # Bridge 服务器启动
├── docs/                              # 架构/需求/计划文档
│   ├── plans/                         # 实施计划
│   └── code-reference/                # 代码参考
├── logs/
│   ├── build/                         # 编译/测试日志
│   ├── dumps/                         # UI hierarchy dump (adb)
│   └── screenshots/                   # 测试截图
└── .maestro/
    ├── flows/                         # Maestro E2E 流程
    │   ├── l1-smoke/                  # Layer 1: 冒烟测试
    │   ├── l2-bridge-*.yaml           # Layer 2: Mock 集成测试
    │   ├── l3-*.yaml                  # Layer 3: UI 组件测试
    │   └── shared/                    # 公共连接步骤
    ├── bin/                           # Maestro 可执行文件（本地安装，不入库）
    └── lib/                           # Maestro 依赖库（本地安装，不入库）
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

#### 构建 Release APK

```bash
cd apps/mobile/android
./gradlew :app:assembleRelease   # 产物: app/build/outputs/apk/release/app-release.apk
```

> ⚠️ 首次构建前需先生成 `react-native-gradle-plugin` 的 jar（`build.gradle` 引用它来支持新架构 codegen）：
> `./gradlew tasks --all || true`，然后重新执行上面的构建命令。

#### GitHub Actions 自动构建

推送到 GitHub 后，`.github/workflows/build-android.yml` 会在每次 push/PR 时自动构建 APK 并作为 artifact 提供：
- 触发路径：`apps/mobile/**`、`packages/shared/**`
- 产物下载：Actions 页面 → 对应 run → Artifacts → `app-release.apk`
- 也可手动触发：Actions → "Build Android APK" → Run workflow

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

**共 46 个 RPC handler、12 个 Store、9 个 Screen、6 个 Component、20+ 个 SSE 事件类型。**

---

## 测试

### 单元测试

```bash
npm run bridge:test               # Bridge: 117 tests (3 test files)
cd apps/mobile && npx jest        # Mobile: 634 tests (29 test files)
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
│  12 Store        │                      │  JWT 认证         │                 │  会话持久化    │
│  9 Screen        │                      │  SSE→WS 转发      │                 │  LLM 推理      │
│  6 Component     │                      │  文件直接操作      │                 │  工具执行      │
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
