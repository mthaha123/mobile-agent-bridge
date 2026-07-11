# 开发计划：Mobile Agent Bridge

## 摘要

本文档描述了构建 **手机（WS）→ Bridge（Node.js + SDK）→ Agent（OpenCode）** 三层架构的分阶段开发计划。适合个人开发者单线程执行。

---

## 1. 开发理念

| 原则 | 描述 |
|------|------|
| **尽早交付价值** | Phase 1 交付可用的聊天+审批功能 |
| **单线程可执行** | 每个阶段一个人可完成，不依赖多角色 |
| **迭代验证** | 每完成一个子任务即可起身验证 |
| **不做完美主义** | 够用就好，未来可重构 |

---

## 2. 总体架构

```
手机 ←──WS 一条连接──→ Bridge ←──SDK──→ OpenCode serve
   call/res/event          WS 服务       HTTP+SSE
                           JWT 认证
                           SSE→WS 转发
                           文件直接 fs
```

**手机不需要 HTTP、SSE、SDK**。Bridge 是 Node.js 服务，唯一必须的依赖是 `@opencode-ai/sdk` v2。

---

## 3. Phase 1：核心 MVP（建议 4 周）

### 3.1 目标

> 手机连接 Bridge → Bridge 连接 OpenCode → 可聊天、流式显示、会话 CRUD、审批工具。

### 3.2 组件分解

| 组件 | 依赖 | 产出 |
|------|------|------|
| **Bridge WS 服务器** | `ws` + `jsonwebtoken` | WS 连接管理 + JWT 认证 |
| **Bridge RPC 路由** | 纯逻辑 | 方法前缀分发（session./message./auth./等） |
| **OpenCode 适配器** | `@opencode-ai/sdk` | SDK 调用 + SSE→WS 事件转发 + AbortController |
| **手机 BridgeClient** | 原生 WebSocket | call/event 模式封装 |
| **手机 UI 层** | React Native | 聊天、会话列表、审批 |

### 3.3 详细任务

#### 第 1 周：Bridge 骨架

| 任务 | 描述 |
|------|------|
| 1.1 | 初始化 Bridge Node.js 项目（TypeScript + ts-node-dev） |
| 1.2 | 实现 WS 服务器：`wss://0.0.0.0:8080/ws`，维护 `Map<connID, WebSocket>` |
| 1.3 | 实现 JWT 认证：`auth.login` 签发 token，WS 连接时验证 |
| 1.4 | 实现 RPC 路由：收到 `req` 帧 → 按 method 前缀分发到处理器 → 返回 `res` 帧 |
| 1.5 | 实现 `health.ping` 和错误帧格式 |

**验证：** 用 `wscat` 连接 Bridge，发 `auth.login` → 拿到 token，发未知方法 → 收到 error。

#### 第 2 周：OpenCode 集成 + SSE 事件流

| 任务 | 描述 |
|------|------|
| 2.1 | 集成 `@opencode-ai/sdk` v2，实现 `createOpencodeClient({ baseUrl, directory })` |
| 2.2 | 实现 SSE 事件订阅：AbortController + `sseMaxRetryAttempts: 0` + 重试循环 |
| 2.3 | SSE 事件 → WS `event` 帧转发：从 SSE `for await` 循环直接 `ws.send({ type: "event", ... })` |
| 2.4 | 实现代理方法：`session.create/list/get/delete`、`message.send` |
| 2.5 | 接入真实 OpenCode serve 实例，验证端到端 SSE 事件推送 |

**验证：** 手机（或 wscat 模拟）发 `session.create` → 收到 `res` → OpenCode 产生事件 → 收到 `event` 帧。

#### 第 3 周：手机端 BridgeClient + 基础 UI

| 任务 | 描述 |
|------|------|
| 3.1 | 初始化 React Native 项目 |
| 3.2 | 实现 `BridgeClient` 类：`connect()`、`call()`、`on()`、自动重连 |
| 3.3 | 连接设置页面（服务器 URL + 密码） |
| 3.4 | 聊天页面：消息列表 + 输入框 + 发送 |
| 3.5 | 流式令牌显示：监听 `message.part.updated` 事件实时追加文本 |

**验证：** 手机连接 Bridge → 输入消息 → Agent 回复流式显示在屏幕上。

#### 第 4 周：会话管理 + 工具审批 + 打磨

| 任务 | 描述 |
|------|------|
| 4.1 | 会话列表页面（创建、切换、删除会话） |
| 4.2 | 工具审批 UI：`permission.asked` 事件弹出 → 用户点击允许/拒绝/始终允许 |
| 4.3 | 错误处理：网络断开自动重连、请求超时、重试逻辑 |
| 4.4 | 状态管理：Zustand store（connection、sessions、messages、ui） |
| 4.5 | 集成测试：Bridge + RN 模拟器 + OpenCode serve |

### 3.4 Phase 1 交付物

| 组件 | 文件 |
|------|------|
| Bridge 服务器 | `servers/bridge/src/index.ts` + `ws.ts` + `router.ts` + `auth.ts` + `opencode-adapter.ts` |
| 手机客户端 | `apps/mobile/src/services/BridgeClient.ts` + `screens/` + `stores/` |
| 端到端验证脚本 | `servers/bridge/scripts/e2e.sh`（wscat 模拟） |

### 3.5 验证清单

| 场景 | 操作 | 预期 |
|------|------|------|
| 连接 | 输入 URL + 密码 | 状态变为"已连接" |
| 创建会话 | 点击 + 输入标题 | 新会话出现在列表 |
| 发送消息 | 输入文本 → 发送 | 消息出现、Agent 流式回复 |
| 切换会话 | 点击另一个会话 | 消息历史正确加载 |
| 审批工具 | Agent 请求工具 → 点击批准 | 工具执行、回复继续 |
| 断开重连 | 关闭 OpenCode → 重新启动 | Bridge 自动重连 SSE |

---

## 4. Phase 2：增强功能（建议 4-5 周）

### 4.1 目标

> 文件浏览、14 种工具渲染器、项目切换、Shell 模式。

### 4.2 详细任务

#### 第 5 周：文件操作（Bridge 直接实现）

| 任务 | 描述 |
|------|------|
| 5.1 | Bridge `file.list`：`fs.readdir` + 文件元信息 |
| 5.2 | Bridge `file.read`：`fs.readFile` + 编码检测 |
| 5.3 | Bridge `file.search`：HTTP 调 OpenCode `/find` 接口 |
| 5.4 | 手机端文件浏览器 UI（目录树 + Git 状态） |
| 5.5 | 手机端文件查看器 UI（语法高亮 + 行号） |

#### 第 6 周：工具专用渲染器

| 任务 | 描述 |
|------|------|
| 6.1 | Shell 渲染器：命令 + 输出折叠 + 状态 |
| 6.2 | Read/Write/Edit 渲染器：文件路径 + diff 预览 |
| 6.3 | Glob/Grep 渲染器：搜索模式 + 结果列表 |
| 6.4 | WebFetch/WebSearch 渲染器：URL + 摘要 |
| 6.5 | Task/Question/Skill/TodoWrite 渲染器 |

#### 第 7 周：项目切换 + Shell 模式

| 任务 | 描述 |
|------|------|
| 7.1 | Bridge `project.switch`：abort 旧 SSE → 重建 client → 新 SSE |
| 7.2 | Bridge `project.current`（已实现）/`project.list`（Phase 3） |
| 7.3 | 手机端项目选择 UI（调用已存在的 `project.switch`） |
| 7.4 | Shell 模式：`!` 开头检测 → `message.shell`（Bridge 侧 `session.shell()` 已实现） |
| 7.5 | 斜杠命令：`/model`、`/agent` 等（手机端逻辑；Bridge 侧 `session.command()` 已实现） |

**注：Bridge 侧 `session.diff`/`session.todo`/`session.fork`/`session.revert`/`session.unrevert`/`question.reply`/`question.reject`/`message.shell`/`message.command` 已在 Phase 1 实现。Phone 侧 UI 渲染器仍为 Phase 2 独立任务。**

#### 第 8 周：Markdown + Question + 打磨

| 任务 | 描述 |
|------|------|
| 8.1 | Markdown 渲染（代码块 + 表格 + 图片） |
| 8.2 | Question 多步向导（`question.v2.asked` 事件 → 表单式 UI；Bridge 侧 `question.reply/reject` 已实现） |
| 8.3 | 思考/推理折叠组件（`session.next.reasoning.delta` 事件已转发） |
| 8.4 | 集成测试 + Bug 修复 |

### 4.3 Phase 2 交付物

- 文件浏览器 + 文件查看器
- 14 种工具渲染组件
- 项目目录切换
- Shell 模式 + 斜杠命令
- Markdown 渲染 + Question 向导

---

## 5. Phase 3：生产就绪（建议 4 周）

### 5.1 目标

> 多 Agent 支持、离线缓存、通知、语音输入。

### 5.2 详细任务

| 周次 | 任务 |
|------|------|
| 第 9 周 | Hermes 适配器 + OpenClaw 适配器 + Agent 类型选择 UI |
| 第 10 周 | 离线缓存（AsyncStorage/SQLite）+ 断线消息队列 |
| 第 11 周 | 推送通知（APNs/FCM）+ 后台保活 |
| 第 12 周 | 语音输入 + 性能优化 + 无障碍 + 最终测试 |

---

## 6. 项目结构

```
mobile-agent-bridge/
├── servers/
│   └── bridge/                    # Bridge 服务器（核心）
│       ├── src/
│       │   ├── server/
│       │   │   ├── ws.ts          # WebSocket 连接管理
│       │   │   ├── router.ts      # RPC 方法路由
│       │   │   └── auth.ts        # JWT 认证
│       │   ├── adapters/
│       │   │   ├── OpenCodeAdapter.ts  # @opencode-ai/sdk
│       │   │   ├── HermesAdapter.ts    # JSON-RPC over stdio
│       │   │   └── OpenClawAdapter.ts  # WebSocket
│       │   ├── types/
│       │   │   └── protocol.ts    # WS 帧类型定义
│       │   └── index.ts
│       ├── __tests__/
│       ├── package.json
│       └── tsconfig.json
├── apps/
│   ├── mobile/                    # React Native (Android + iOS)
│   │   ├── src/
│   │   │   ├── services/
│   │   │   │   └── BridgeClient.ts  # WS 客户端 + call/event
│   │   │   ├── screens/           # 页面
│   │   │   ├── components/        # UI 组件
│   │   │   ├── stores/            # Zustand
│   │   │   └── types/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── harmony/                   # HarmonyOS (ArkUI ArkTS)
│       └── entry/src/main/ets/
├── packages/
│   └── shared/                    # 共享类型 (protocol types)
├── docs/
└── package.json                   # monorepo root
```

---

## 7. Bridge 服务器开发详解

### 7.1 Bridge 核心循环

```
手机 WS 连入 → auth.login(密码) → 签发 JWT
           → 后续所有请求携带 JWT
           → router 按 method 前缀分发
                ├── session.* → OpenCodeAdapter.session.*
                ├── message.* → OpenCodeAdapter.session.*
                ├── permission.* → OpenCodeAdapter.permission.*
                ├── question.* → OpenCodeAdapter.question.*
                ├── config.* → OpenCodeAdapter.config.*
                ├── auth.* → 直接 JwtService
                ├── file.* → 直接 fs
                ├── project.* → Bridge 状态管理
                └── health.ping → 直接 OK
```

### 7.2 SSE 事件转发

```
OpenCode SSE stream                    Bridge                   手机 WS
─────────────────────────────────
for await (event of events.stream) →  对每条 event:
                                         ws.send({
                                           type: "event",
                                           event: event.type,
                                           data: event.data,
                                         })
```

### 7.3 项目切换流程

```
project.switch({ directory }) →  sseAbort.abort()
                               →  sdk = null
                               →  sdk = createOpencodeClient({ baseUrl, directory })
                               →  sseAbort = new AbortController()
                               →  startSSE(sdk, sseAbort.signal)
                               →  { ok, directory, project }
                               →  广播 event: project.changed
```

---

## 8. 技术栈

| 组件 | 技术 |
|------|------|
| Bridge 运行时 | Node.js 18+ |
| WebSocket | `ws` |
| SDK | `@opencode-ai/sdk` v2 |
| JWT | `jsonwebtoken` |
| 手机框架 (Android/iOS) | React Native + TypeScript |
| 手机框架 (HarmonyOS) | ArkUI ArkTS |
| 手机状态管理 | Zustand |
| 手机存储 | AsyncStorage |
| 隧道 (部署层) | Tailscale / FRP / Ngrok |

---

## 9. 风险管理

| 风险 | 缓解 |
|------|------|
| `@opencode-ai/sdk` 在 Bun 上兼容性 | 先用 Node.js，Bun 兼容性跟踪 |
| SSE 断线重连 | Bridge 的外层 while 循环 + 指数退避 |
| 手机 WS 断线 | BridgeClient 自动重连 + 请求重试 |
| 移动端 tool 渲染复杂 | Phase 1 只用通用审批框，Phase 2 再细化 |

---

## 10. 后续步骤

1. [ ] 创建 `servers/bridge/` 目录 + Node.js 项目初始化
2. [ ] 实现 WS 服务器 + JWT 认证
3. [ ] 集成 `@opencode-ai/sdk` v2 并测试 SSE 事件
4. [ ] 实现 RPC 路由 + session/message 代理
5. [ ] 创建 React Native 项目 + BridgeClient
6. [ ] 构建聊天 UI + 流式显示

---

*文档版本：2.0*
*最后更新：2026-06-28*
