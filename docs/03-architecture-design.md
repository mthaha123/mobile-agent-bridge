# 架构设计：Mobile Agent Bridge

三层架构：**手机客户端** → **Bridge 服务器** → **Agent 服务器（OpenCode/Hermes/OpenClaw）**。Bridge 是核心，负责内网穿透、协议转换、多 Agent 适配。

---

## 1. 架构设计

### 1.1 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│                   手机客户端（React Native / ArkUI）          │
│  WebSocket 客户端（wss://bridge:8080/ws）                   │
│  协议：JSON 帧（type: req/res/event）                       │
└─────────────────────────┬───────────────────────────────────┘
                          │  WSS（隧道透明：直连/Tailscale/FRP）
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Bridge 服务器（Node.js）                                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  RPC Router（方法前缀 → 处理器）                       │  │
│  │  ┌──────────────────────────────────────────┐       │  │
│  │  │  代理：session.* → client.v2.session.*        │  │
│  │  │         message.* → client.v2.session.*       │  │
│  │  │         permission.* → client.v2.session.permission│  │
│  │  │         question.* → client.v2.session.question│  │
│  │  │         config.* → client.global.config.*     │  │
│  │  │  直接：auth.* → JwtService              │       │  │
│  │  │         file.* → fs / HTTP              │       │  │
│  │  └──────────────────────────────────────────┘       │  │
│  │                                                      │  │
│  │  Agent 适配器                                        │  │
│  │  OpenCode(HHTP+SSE) │ Hermes(stdio) │ OpenClaw(WS)  │  │
│  └──────────────────────────────────────────────────────┘  │
│  通用层：JWT 认证 / 频率限制 / 审计日志                    │
└─────────────────────────────────────────────────────────────┘
                          │  SDK / stdio / WS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent 服务器：OpenCode :4096 / Hermes / OpenClaw :18789    │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 组件职责

| 组件 | 职责 |
|------|------|
| **手机客户端** | UI 渲染、用户交互、本地状态管理 |
| **Bridge 服务器** | WS 服务端、RPC 路由、协议转换、JWT 认证、隧道管理 |
| **Agent 服务器** | LLM 推理、工具执行、会话持久化、SSE 事件推送 |

### 1.3 代理调用 vs 直接实现

Bridge 的 RPC 方法分两类：

**代理调用**（经 Agent 适配器转发到后端，Bridge 做透传）：

| 方法 | 转发目标 | 说明 |
|------|---------|------|
| `session.create/list/get/messages/status` | `client.v2.session.*` | v2 CRUD |
| `session.delete/update` | `client.session.delete/update` | 顶层 SDK（v2 命名空间无 DELETE/PATCH） |
| `message.send` | `client.v2.session.prompt()` | 文本消息（同时替代 shell/command） |
| `message.abort` | `client.v2.session.interrupt()` | 中断会话 |
| `permission.reply` | `client.v2.session.permission.reply()` | 工具审批（session 作用域） |
| `question.*` | `client.v2.session.question.*` | 问答 |
| `config.get` | `client.global.config.get()` | 全局配置 |
| `config.providers` | `client.config.providers()` | 顶层 SDK |
| `config.agents` | `client.v2.agent.list()` | 可用 agents |
| `provider.list` | `client.v2.provider.list()` | 可用 providers |
| `command.list` | `client.v2.command.list()` | 可用命令 |
| `vcs.get` | `client.vcs.get()` | 顶层 SDK |

**直接实现**（Bridge 自有逻辑，不经过 Agent）：

| 方法 | 实现方式 | 说明 |
|------|---------|------|
| `auth.login / refresh / logout` | Bridge 签发/撤销 JWT | 移动端认证 |
| `file.list` | `fs.readdir` | 读取目录 |
| `file.read` | `fs.readFile` | 读取文件 |
| `file.search` | Bridge HTTP 调用 OpenCode serve 的搜索接口 | 文件搜索（依赖 ripgrep） |
| `health.ping` | Bridge 自检 | 心跳 |
| `notification.register` | 存储推送 token | Phase 3 |

### 1.4 网络架构

**连接拓扑：**

```
手机 ──WSS──→ Bridge ──SDK──→ Agent
     双向       隧道       HTTP+SSE
```

**两层协议：**

| 层 | 用途 | 协议 |
|----|------|------|
| 手机 ↔ Bridge | 双向指令/事件 | WebSocket JSON 帧 |
| Bridge ↔ OpenCode | SDK 调用 + SSE 事件 | HTTP + SSE / `@opencode-ai/sdk` v2 |
| Bridge ↔ Hermes | JSON-RPC | stdio |
| Bridge ↔ OpenClaw | 原生协议 | WebSocket :18789 |

**连接状态机：**

```
已断开 → 连接中 → 已连接 → 重连中 → ...
                    ↑         │
                    └── 超时 ──┘
```

### 1.5 通信协议

#### 1.5.1 传输层

WebSocket（WSS），双向实时、移动网络友好。手机端一条连接即可处理所有请求、响应、事件推送。

#### 1.5.2 消息格式

三种 JSON 帧类型：

| 类型 | 方向 | 字段 |
|------|------|------|
| `req` | 手机 → Bridge | `id, method, params` |
| `res` | Bridge → 手机 | `id, ok, payload?, error?` |
| `notify` | Bridge → 手机 | `method, payload` |

实现注记：事件帧使用 `notify` 而非 `event` 做类型，因为 `event` 在某些移动端 WebSocket 框架中为保留字。事件名通过 `method` 字段传递（如 `"session.next.text.delta"`），载荷通过 `payload` 传递。

#### 1.5.3 RPC 路由逻辑

Bridge 收到 `req` 帧后，按 `method` 前缀路由：

| 前缀 | 路由 | 目标 |
|------|------|------|
| `session.` `message.` `permission.` `question.` `config.` `vcs.` `command.` | 代理 | AgentAdapter（SDK/stdio/WS） |
| `auth.` | 直接 | JwtService |
| `file.` | 直接 | `fs` 或 HTTP（search） |
| `health.ping` | 直接 | 自检 |
| 未知 | 错误 | `{ ok: false, error: "unknown method" }` |

### 1.6 SDK 映射

SDK `@opencode-ai/sdk` v2 (`0.0.0-dev-202606301614`) 提供了两个命名空间，本 Bridge 根据端点可用性选择：

```
SDK 版本 0.0.0-dev-202606301614 的 OpencodeClient 结构：
  client.v2.*          → 路径 /api/...      → v2 核心接口（session CRUD、event、prompt、permission、fs、agent、provider、command）
  client.* (顶层)      → 路径 /...          → 补充接口（session delete/update、config.providers、vcs、file、project、全局配置）
  client.global.*      → 路径 /global/...   → 全局配置/事件/dispose
```

**路由原则：会话 CRUD、消息发送、权限审批、问答等核心路径走 `v2` 命名空间。`session.delete`/`update`、`config.providers`、`vcs.get` 等 v2 未覆盖的方法走顶层 SDK。**

| 手机 WS 方法 | SDK 调用 | 命名空间 | 说明 |
|-------------|---------|---------|------|
| `session.create` | `session.create({ agent?, model?, title? })` | 顶层（v1 compat） | model 为 `{ id, providerID, variant? }`；Bridge 接受字符串自动转换。v2 命名空间不支持 `title`，故使用顶层 SDK |
| `session.list` | `v2.session.list({ directory, limit?, search? })` | `v2` | 返回分页结果 `{ data, cursor }` |
| `session.get` | `v2.session.get({ sessionID })` | `v2` | |
| `session.status` | `v2.session.active()` | `v2` | 返回**当前进程拥有的 foreground drain 列表**（≠ 会话 idle/busy 状态）。会话状态应通过 `session.status` 事件监听 |
| `session.messages` | `v2.session.messages({ sessionID, limit?, order?, cursor? })` | `v2` | 返回分页结果 `{ data, cursor }` |
| `session.delete` | `session.delete({ sessionID })` | 顶层 | v2 命名空间无 DELETE 端点，使用顶层 SDK |
| `session.update` | `session.update({ sessionID, title? })` | 顶层 | 用于重命名会话 |
| `message.send` | `v2.session.prompt({ sessionID, prompt })` | `v2` | `prompt = { text, files?, agents? }`（**不是** `PartInput[]`），默认 `delivery: "steer"` |
| `message.shell` | `session.shell({ sessionID, command })` | 顶层 | 直接 Shell 命令执行（Shell 模式时使用） |
| `message.command` | `session.command({ sessionID, command })` | 顶层 | 斜杠命令执行 |
| `message.abort` | `v2.session.interrupt({ sessionID })` | `v2` | |
| `permission.reply` | `v2.session.permission.reply({ sessionID, requestID, reply, message? })` | `v2` | `reply: "once"\|"always"\|"reject"` |
| `question.reply` | `v2.session.question.reply({ sessionID, requestID, questionV2Reply })` | `v2` | `questionV2Reply = { answers: [[string]] }` |
| `question.reject` | `v2.session.question.reject({ sessionID, requestID })` | `v2` | |
| `config.get` | `global.config.get()` | `global` | 全局配置 |
| `config.providers` | `config.providers({ directory })` | 顶层 | 可用（非 v2） |
| `config.agents` | `v2.agent.list({ location })` | `v2` | |
| `provider.list` | `v2.provider.list({ location })` | `v2` | |
| `command.list` | `v2.command.list({ location })` | `v2` | |
| `vcs.get` | `vcs.get({ directory })` | 顶层 | 可用（非 v2） |

**事件订阅：** Bridge 调用 `v2.event.subscribe()`（路径 `/api/event`），获取 `V2Event` 格式的 SSE 流，实时转为 WS `notify` 帧推送手机端。

**SSE 事件解析（V2Event 格式，关键）：**

每个事件的结构为：
```
{ id, type: string, data: { ... }, metadata?, durable?, location? }
```

| V2Event type | data 字段 | 用途 |
|---|---|---|
| `session.next.text.delta` | `{ sessionID, assistantMessageID, textID, delta }` | 流式文本增量（每个 token） |
| `session.next.text.ended` | `{ sessionID, assistantMessageID, textID, text }` | 文本段结束 |
| `session.next.tool.called` | `{ sessionID, assistantMessageID, callID, tool, input }` | 工具开始执行 |
| `session.next.tool.success` | `{ sessionID, assistantMessageID, callID, content, result? }` | 工具执行成功 |
| `session.next.tool.failed` | `{ sessionID, assistantMessageID, callID, error }` | 工具执行失败 |
| `session.next.reasoning.delta` | `{ sessionID, assistantMessageID, reasoningID, delta }` | 推理内容增量 |
| `session.idle` | `{ sessionID }` | 会话回复完成 |
| `session.error` | `{ sessionID?, error? }` | 出错 |
| `session.status` | `{ sessionID, status }` | 会话状态变更 |
| `permission.v2.asked` | `{ id, sessionID, action, resources, save?, source? }` | 工具权限请求 |
| `permission.v2.replied` | `{ sessionID, requestID, reply }` | 权限已处理 |
| `message.part.delta` | `{ sessionID, messageID, partID, field, delta }` | Part 字段增量更新 |
| `question.v2.asked` | `{ id, sessionID, questions, tool? }` | 问答请求 |
| `todo.updated` | `{ sessionID, todos }` | 待办更新 |
| `session.diff` | `{ sessionID, diff }` | 文件变更 |

注意：`message.part.updated` 事件包含**完整 Part 对象**（非增量），流式文本增量应使用 `session.next.text.delta`。

以下方法已通过 SDK 顶层命名空间单独实现路由，不由 `message.send` 替代：
- `message.shell` → `session.shell()`（Shell 命令执行）
- `message.command` → `session.command()`（斜杠命令）

所有 SDK 方法均接受 `directory` 和 `workspace` 参数，**Bridge 通过 `createOpencodeClient({ directory })` 自动注入 `x-opencode-directory` 头**，手机端不需要传递。

### 1.7 多 Agent 适配器

所有 Agent 后端实现统一 `AgentBackend` 接口。文件操作和认证不经过适配器。

| 适配器 | 协议 | 目标 |
|--------|------|------|
| **OpenCode** | `@opencode-ai/sdk` v2（HTTP + SSE） | OpenCode serve :4096 |
| **Hermes** | JSON-RPC over stdio | Python 网关进程 |
| **OpenClaw** | WebSocket 原生协议 | Gateway :18789 |

适配器接口定义及具体实现见 `docs/code-reference/bridge-adapters.md`。

**实现注记：** Phase 1 OpenCodeAdapter 已简化为仅管理 SDK client 生命周期（`createClient`/`dispose`）和提供自定义 Node.js fetch。SDK 方法调用直接在 router handler 中内联，不封装在 adapter 中。这避免了一层不必要的间接调用，也便于每个方法独立处理参数转换。

### 1.8 安全

**认证流程：** 仅发生在手机与 Bridge 之间，Bridge 不转发到 Agent。

```
手机 ──auth.login──→ Bridge（签发 JWT）
手机 ◀──token───────
手机 ──auth.refresh─→ Bridge（续期）
```

| 平台 | 令牌存储 |
|------|----------|
| iOS | Keychain |
| Android | Keystore |
| Bridge 服务器 | 加密数据库 |

### 1.9 隧道管理

隧道属于部署环境而非应用层配置。Bridge 应用代码无需感知隧道类型。

| 隧道 | 适用场景 |
|------|----------|
| 直连 | 同局域网 |
| Tailscale | 跨网络、安全、零配置 |
| FRP | 自托管、固定公网入口 |
| Ngrok | 快速调试 |

### 1.10 错误处理与性能

**重试策略：** 指数退避，初始 1s，最大 30s，乘数 2x，最多 5 次。

**缓存：**

| 数据 | 时长 |
|------|------|
| 会话 | 5 分钟 |
| 消息 | 会话生命周期 |
| 文件 | 1 分钟 |
| 配置 | 1 小时 |

### 1.11 测试策略

| 范围 | 类型 |
|------|------|
| RPC 路由 + 协议转换 | 单元测试 |
| 连接 OpenCode 发送消息 | E2E |
| 工具审批流程 | E2E |
| 文件列表/读取 | 集成测试 |

### 1.12 部署

| 组件 | 分发 |
|------|------|
| iOS | TestFlight → App Store |
| Android | APK → Play Store |
| HarmonyOS | AppGallery |
| Bridge 服务器 | `npx mobile-agent-bridge` / Docker / 二进制 |

---

## 2. 需求功能接口

每个功能点包含时序图、接口表、事件说明。方法方向均为 **手机 → Bridge**。

### 2.1 连接与认证

**时序：**
```
手机                         Bridge
 │  auth.login                │
 │  { password? }             │
 │───────────────────────────▶│  签发 JWT
 │◀───────────────────────────│
 │  { ok, token, expiresIn }  │
 │                            │
 │  health.ping               │  (定期心跳)
 │───────────────────────────▶│
 │◀───────────────────────────│
 │  { ok }                    │
```

**接口（全直接）：**

| 方法 | 参数 | 实现 | Phase |
|------|------|------|-------|
| `auth.login` | `{ password? }` | Bridge 签发 JWT | 1 |
| `auth.refresh` | `{}` | Bridge 续期 JWT | 1 |
| `auth.logout` | `{}` | Bridge 撤销 JWT | 1 |
| `health.ping` | `{}` | Bridge 自检 | 1 |

**事件：** 无。连接状态由 WS `onopen`/`onclose` 推断。

### 2.2 会话管理

**时序：**
```
手机                         Bridge                      Agent
 │  session.create            │                           │
 │  { agent?, model? }        │                           │
 │───────────────────────────▶│  client.v2.session.create()  │
 │                            │──────────────────────────▶│
 │◀───────────────────────────│  { id, agent, model, ... } │
 │                            │                           │
 │  session.list              │                           │
 │───────────────────────────▶│  client.v2.session.list() │
 │                            │──────────────────────────▶│
 │◀───────────────────────────│  { data: [...], cursor }  │
```

**接口（全代理）：**

| 手机 WS 方法 | 参数 | SDK 调用 | 命名空间 | Phase | 状态 |
|-------------|------|---------|---------|-------|:----:|
| `session.create` | `{ agent?, model? }` | `session.create({ agent, model, title? })` | 顶层（v1 compat） | 1 | ✅ model 接受 `string`（Bridge 自动转 `{id, providerID}）`或 `{id, providerID} 对象`。v2 无 title，故用 v1 compat |
| `session.list` | `{ search?, limit? }` | `v2.session.list({ directory, search?, limit? })` | `v2` | 1 | ✅ 返回 `{ data, cursor }` |
| `session.get` | `{ sessionID }` | `v2.session.get({ sessionID })` | `v2` | 1 | ✅ |
| `session.status` | `{}` | `v2.session.active()` | `v2` | 1 | ✅ 返回 foreground drain 列表。会话 idle/busy 状态通过 `session.status` 事件获得 |
| `session.delete` | `{ sessionID }` | `session.delete({ sessionID })` | 顶层 | 1 | ✅ 顶层 SDK 可用 |
| `session.update` | `{ sessionID, title? }` | `session.update({ sessionID, title? })` | 顶层 | 1 | ✅ 用于重命名等 |
| `session.messages` | `{ sessionID, limit? }` | `v2.session.messages({ sessionID, limit? })` | `v2` | 1 | ✅ 返回 `{ data, cursor }` |
| `session.fork` | `{ sessionID, messageID? }` | `session.fork({ sessionID, messageID? })` | 顶层 | 3 | ✅ 顶层 SDK 可用 |

**事件：** 无。结果通过 `res` 帧返回。

### 2.3 聊天通信

**时序：**
```
手机                         Bridge                      OpenCode
 │  message.send              │                           │
 │  { sessionID, message }    │                           │
 │───────────────────────────▶│  v2.session.prompt()      │
 │                            │  prompt: { text }         │
 │                            │──────────────────────────▶│
 │                            │  ◀── SSE 事件流 ──│
 │◀── notify: session.next.text.delta                    │
 │  { sessionID, delta }      │  流式文本增量              │
 │◀── notify: session.next.text.delta                    │
 │◀── notify: session.next.tool.called                   │
 │  { sessionID, tool, input }│  工具被调用               │
 │◀── notify: session.idle   │  (回复完成)                │
 │                            │                           │
 │  message.abort             │  (用户中止)                │
 │───────────────────────────▶│  v2.session.interrupt()   │
 │                            │──────────────────────────▶│
```

**接口（全代理）：**

| 手机 WS 方法 | 参数 | SDK 调用 | 命名空间 | Phase | 状态 |
|-------------|------|---------|---------|-------|:----:|
| `message.send` | `{ sessionID, message }` | `v2.session.prompt({ sessionID, prompt: { text } })` | `v2` | 1 | ✅ `prompt` 为 `PromptInput`（非 `PartInput[]`） |
| `message.shell` | `{ sessionID, command }` | `session.shell({ sessionID, command })` | 顶层 | 2 | ✅ Shell 模式 |
| `message.command` | `{ sessionID, command }` | `session.command({ sessionID, command })` | 顶层 | 2 | ✅ 斜杠命令 |
| `message.abort` | `{ sessionID }` | `v2.session.interrupt({ sessionID })` | `v2` | 1 | ✅ |

**事件（均为 V2Event 格式）：**

| notify method | data 字段 | 说明 |
|---|---|---|
| `session.next.text.delta` | `{ sessionID, assistantMessageID, textID, delta }` | 流式文本增量（每个 token） |
| `session.next.text.ended` | `{ sessionID, assistantMessageID, textID, text }` | 文本段完成 |
| `session.next.reasoning.delta` | `{ sessionID, assistantMessageID, reasoningID, delta }` | 推理内容增量 |
| `session.next.tool.called` | `{ sessionID, assistantMessageID, callID, tool, input }` | 工具调用 |
| `session.next.tool.success` | `{ sessionID, assistantMessageID, callID, content, result? }` | 工具成功 |
| `session.next.tool.failed` | `{ sessionID, assistantMessageID, callID, error }` | 工具失败 |
| `session.idle` | `{ sessionID }` | 回复完成 |
| `session.error` | `{ sessionID?, error? }` | 出错 |
| `session.status` | `{ sessionID, status }` | 会话状态变更 |
| `message.part.delta` | `{ sessionID, messageID, partID, field, delta }` | Part 增量更新 |

注意：`message.part.updated`（**完整 Part**）和 `session.next.text.delta`（**文本增量**）是两个不同的事件。手机端应监听 `session.next.text.delta` 实现流式显示。

### 2.4 工具审批

**时序：**
```
手机                         Bridge                      OpenCode
 │                            │◀── SSE: permission.v2.asked │
 │◀── notify: permission.v2.asked                          │
 │  { id, sessionID, action, │                           │
 │    resources, source? }    │                           │
 │                            │                           │
 │  permission.reply          │                           │
 │  { requestID, sessionID,  │                           │
 │    reply: "once"|"always"| │                           │
 │    "reject" }              │                           │
 │───────────────────────────▶│  v2.session.permission.reply()│
 │                            │──────────────────────────▶│
```

**接口（全代理）：**

| 手机 WS 方法 | 参数 | SDK 调用 | 命名空间 | Phase | 状态 |
|-------------|------|---------|---------|-------|:----:|
| `permission.reply` | `{ requestID, sessionID, reply, message? }` | `v2.session.permission.reply({ sessionID, requestID, reply, message })` | `v2` | 1 | ✅ session 作用域。`reply: "once"\|"always"\|"reject"` |

**事件（V2Event 格式）：**

| notify method | data 字段 | 说明 |
|---|---|---|
| `permission.v2.asked` | `{ id, sessionID, action, resources[], save?, source? }` | 权限请求。`action` 为工具名（如 `"bash"`），`resources` 为参数数组 |
| `permission.v2.replied` | `{ sessionID, requestID, reply }` | 已处理 |

### 2.5 问答系统

**时序：**
```
手机                         Bridge                      OpenCode
 │                            │◀── SSE: question.v2.asked │
 │◀── notify: question.v2.asked                           │
 │  { id, sessionID,          │                           │
 │    questions[], tool? }    │                           │
 │                            │                           │
 │  question.reply            │                           │
 │  { requestID, sessionID,   │                           │
 │    answers: [[string]] }   │                           │
 │───────────────────────────▶│  v2.session.question.reply()  │
 │                            │  questionV2Reply: {       │
 │                            │    answers: [[string]]    │
 │                            │  }                        │
 │                            │──────────────────────────▶│
 │                            │                           │
 │  question.reject           │  (或拒绝)                  │
 │───────────────────────────▶│  v2.session.question.reject() │
 │                            │──────────────────────────▶│
```

**接口（全代理）：**

| 手机 WS 方法 | 参数 | SDK 调用 | 命名空间 | Phase | 状态 |
|-------------|------|---------|---------|-------|:----:|
| `question.reply` | `{ requestID, sessionID, answers }` | `v2.session.question.reply({ sessionID, requestID, questionV2Reply: { answers } })` | `v2` | 2 | ✅ `answers` 为 `[[string]]`（外层数组对应问题，内层数组为选中选项） |
| `question.reject` | `{ requestID, sessionID }` | `v2.session.question.reject({ sessionID, requestID })` | `v2` | 2 | ✅ |

**事件（V2Event 格式）：**

| notify method | data 字段 | 说明 |
|---|---|---|
| `question.v2.asked` | `{ id, sessionID, questions: [{ question, header, options, multiple?, custom? }], tool? }` | 需回答 |

### 2.6 文件操作

**时序：**
```
手机                         Bridge
 │  file.list                 │
 │  { path }                  │
 │───────────────────────────▶│  fs.readdir(path)
 │◀───────────────────────────│
 │  [{ name, type, size }]    │
 │                            │
 │  file.read                 │
 │  { path }                  │
 │───────────────────────────▶│  fs.readFile(path)
 │◀───────────────────────────│
 │  { content, encoding }     │
 │                            │
 │  file.search               │
 │  { query, pattern? }       │
 │───────────────────────────▶│  HTTP 调用 OpenCode 搜索接口
 │◀───────────────────────────│
 │  [{ file, line, content }] │
```

**接口（全直接）：**

| 方法 | 参数 | 实现 | Phase |
|------|------|------|-------|
| `file.list` | `{ path }` | `fs.readdir` | 2 |
| `file.read` | `{ path }` | `fs.readFile` | 2 |
| `file.search` | `{ query, pattern?, dirs?, limit? }` | HTTP 调用 OpenCode 搜索接口 | 2 |

**事件：** 无。

### 2.7 配置与项目上下文

配置查询和项目目录管理。`directory` 由 Bridge 自动管理，手机端不感知。

#### 2.7.1 静态配置（启动时一次性加载）

**接口：**

| 手机 WS 方法 | 参数 | SDK 调用 | 命名空间 | Phase | 状态 |
|-------------|------|---------|---------|-------|:----:|
| `config.get` | `{}` | `global.config.get()` | `global` | 1 | ✅ |
| `config.providers` | `{}` | `config.providers({ directory })` | 顶层 | 1 | ✅ |
| `config.agents` | `{}` | `v2.agent.list({ location })` | `v2` | 1 | ✅ |
| `provider.list` | `{}` | `v2.provider.list({ location })` | `v2` | 1 | ✅ |
| `vcs.get` | `{}` | `vcs.get({ directory })` | 顶层 | 1 | ✅ |
| `command.list` | `{}` | `v2.command.list({ location })` | `v2` | 1 | ✅ |

**事件：** 无。

#### 2.7.2 项目目录切换（runtime）

手机端可随时切换 Bridge 绑定的 OpenCode 工作目录。**全局只有一个活跃目录。**

**原理：**

OpenCode SDK 的 `createOpencodeClient({ directory })` 是一个**纯函数式组合**——它在请求头中注入 `x-opencode-directory`，并在 `GET` 拦截器中追加 `?directory=` 参数。`OpencodeClient` 对象**不持有任何原生资源**（无 socket 池、无文件句柄），唯一的活跃网络连接是 SSE stream。

目录切换 = 丢弃旧 client（GC 回收）+ 创建新 client + 重建 SSE。不需要调 `instance.dispose()`（那是切换 org/provider 用的）。

**状态模型：**

```
Bridge 内部状态（§1.1 三层架构中 Bridge 的运行时数据）：
┌──────────────────────────────────────┐
│  activeDirectory: string | null       │
│  currentProject: { name? } | null     │  项目元信息（从 package.json 等读取）
│  sdk: OpencodeClient | null           │  当前绑定了 activeDirectory 的 SDK 实例
│  sseAbort: AbortController | null     │  当前 SSE stream 的终止控制器
│  sseLoop: Promise<void> | null        │  SSE 消费协程
│  isSwitching: boolean                 │  切换中锁
└──────────────────────────────────────┘
```

**SSE 生命周期：**

SSE 是唯一 Active 的网络连接。使用 `AbortController` 管理：

```typescript
async function startSSE(sdk: OpencodeClient, signal: AbortSignal) {
  while (true) {
    if (signal.aborted) break
    const events = await sdk.v2.event.subscribe({ signal, sseMaxRetryAttempts: 0 })
    for await (const event of events.stream) {
      if (signal.aborted) break
      broadcastToMobile(event)
    }
    await sleep(3000)  // 外层重试
  }
}
```

切换时 `abort()` → SSE 循环在下一个 `signal.aborted` 检查点退出 → 旧 HTTP 连接关闭。

**时序：**

```
手机                         Bridge                      OpenCode
 │  project.switch            │                           │
 │  { directory: "/proj-b" }  │                           │
 │───────────────────────────▶│                           │
 │                            │  isSwitching = true        │
 │                            │  ① sseAbort.abort()       │
 │                            │  ② sdk = null（GC）        │
 │                            │  ③ sdk = createOpencodeClient    │
 │                            │       ({ baseUrl, directory })   │
 │                            │  ④ sseAbort = new AbortController() │
 │                            │  ⑤ startSSE(sdk, sseAbort.signal) │
 │                            │──────────────────────────▶│
 │                            │  ◀── SSE: session.list / config... ──│
 │                            │  读取 package.json          │
 │◀───────────────────────────│                            │
 │  { ok, directory,          │                            │
 │    project: { name } }     │                            │
 │◀── event: project.changed │                            │
 │  isSwitching = false       │                            │
```

**接口：**

| 手机 WS 方法 | 参数 | 实现 | Phase |
|-------------|------|------|-------|
| `project.switch` | `{ directory }` | Bridge 校验目录 → 重建 client + SSE | 2 |
| `project.current` | `{}` | `project.current(...)` | 2 |
| `project.list` | `{}` | `project.list(...)` | 3 |

**`project.switch` 实现伪码：**

```
1. isSwitching → 返回 error "already switching"  
2. 校验 directory 存在、可读（fs.accessSync）
3. isSwitching = true
4. 清理旧状态：
   a. sseAbort?.abort()
   b. sdk = null, sseAbort = null, sseLoop = null
5. 创建新 client：
   sdk = createOpencodeClient({ baseUrl, directory })
6. 建立新 SSE：
   sseAbort = new AbortController()
   sseLoop = startSSE(sdk, sseAbort.signal)
7. 读取项目元信息（目录名）
8. isSwitching = false
9. 返回 { directory, project }
10. 广播 event: project.changed
```

**事件：**

| 事件 | 数据 | 说明 |
|------|------|------|
| `project.changed` | `{ directory, project }` | 切换成功，手机端应刷新本地所有状态 |

**并发与边界：**

| 场景 | 处理 |
|------|------|
| **切换中收到请求** | 返回 `{ error: "already switching" }`，手机端自动重试 |
| **切换中收到第二次 `project.switch`** | 拒绝：`{ error: "already switching" }` |
| **新目录无效** | 不销毁旧 client，返回 `{ error: "directory not found" }`，`isSwitching = false` |
| **SDK 创建失败** | 旧 client 已丢弃 → 无目录状态。`activeDirectory = null, sdk = null`。返回错误，手机端重试 |
| **手机断线重连** | Bridge 保留当前 `activeDirectory`。重连后手机端调 `project.current` 恢复 |
| **快速连续切换** | 第二次被 `isSwitching` 拒绝。手机端应等前一次完成 |

**切换后手机端行为：**

```
1. 清空会话列表（旧目录的会话不适用）
2. 调用 session.list 拉取新目录会话
3. 调用 config.get / config.providers / config.agents 刷新配置
4. 更新文件浏览器根路径为新的 directory
5. 更新 UI 顶部显示当前项目名
```

### 2.8 会话进阶

差异查看、撤销/重做、待办。

**接口：**

| 手机 WS 方法 | 参数 | SDK 调用 | 命名空间 | Phase | 状态 |
|-------------|------|---------|---------|-------|:----:|
| `session.diff` | `{ sessionID, messageID? }` | `session.diff({ sessionID, messageID? })` | 顶层 | 2 | ✅ 顶层 SDK 可用 |
| `session.revert` | `{ sessionID, messageID?, partID? }` | `session.revert({ sessionID, messageID?, partID? })` | 顶层 | 2 | ✅ 顶层 SDK 可用 |
| `session.unrevert` | `{ sessionID }` | `session.unrevert({ sessionID })` | 顶层 | 2 | ✅ 顶层 SDK 可用 |
| `session.todo` | `{ sessionID }` | `session.todo({ sessionID })` | 顶层 | 2 | ✅ 顶层 SDK 可用 |

**事件（V2Event 格式）：**

| notify method | data 字段 | 说明 |
|---|---|---|
| `session.diff` | `{ sessionID, diff: [{ file?, patch?, additions, deletions, status? }] }` | 文件变更 |
| `todo.updated` | `{ sessionID, todos: [{ content, status, priority }] }` | 待办更新 |

---

## 3. 状态管理

| 分片 | 职责 |
|------|------|
| `connection` | 连接状态、服务器 URL、Agent 类型 |
| `project` | 当前工作目录、项目信息、切换状态 |
| `sessions` | 会话列表、当前会话 ID |
| `messages` | 消息历史、流式增量 |
| `ui` | 导航、主题、字体 |

---

## 4. 总结

**核心架构：** 手机 (WS) → Bridge (SDK) → Agent，Bridge 同时承担协议转换和直接服务（认证、文件）的职责。

**接口覆盖：** 核心交互（会话创建/查询/消息发送/中断/审批/问答）全部对齐 OpenCode SDK v2 API。`session.delete/update`、`config.providers`、`vcs.get`、`session.diff/todo/fork/revert/unrevert` 通过**顶层 SDK**（非 `v2` 命名空间）调用，全部可用。仅 `message.shell`/`command` 由 `message.send` + text prompt 统一替代。

**SSE 事件（关键）：** Bridge 使用 `v2.event.subscribe()`（路径 `/api/event`）订阅 V2Event 格式的事件流。每条事件结构为 `{ id, type, data }`，Bridge 转发为 WS `notify` 帧（`{ type: "notify", method: event.type, payload: event.data }`）。

**项目切换（§2.7.2）：** Bridge 持有唯一活跃 SDK client 和 SSE stream。切换 = 销毁旧 client + abort 旧 SSE → 创建新 client + 订阅新 SSE。切换期间请求返回错误、手机端重试。

**代码参考：** 适配器实现见 `docs/code-reference/bridge-adapters.md`，手机客户端见 `docs/code-reference/bridge-client.md`。

---

*文档版本：3.0*
*最后更新：2026-07-08*
*变更：§1.3 补充顶层 SDK 路由；§1.5.2 修正 WS 帧格式为 notify/method/payload；§1.6 全面重写 SDK 映射表，修正事件格式为 V2Event；§2.2-2.8 全面对齐 SDK v2 实际接口签名和事件结构*
