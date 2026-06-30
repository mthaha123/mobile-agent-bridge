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
│  │  │  代理：session.* → client.session.*     │       │  │
│  │  │         message.* → client.session.*    │       │  │
│  │  │         permission.* → client.permission│       │  │
│  │  │         question.* → client.question.*  │       │  │
│  │  │         config.* → client.config.*      │       │  │
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
| `session.*` | `client.session.*` | CRUD + messages/todo/diff/abort/revert |
| `message.send` | `client.session.prompt()` | 文本消息 |
| `message.shell` | `client.session.shell()` | Shell 命令 |
| `message.command` | `client.session.command()` | 斜杠命令 |
| `permission.reply` | `client.permission.reply()` | 工具审批 |
| `question.*` | `client.question.*` | 问答 |
| `config.*` + `provider.list` | `client.config.*` / `client.app.*` / `client.provider.*` | 配置信息 |
| `vcs.get` / `command.list` | `client.vcs.*` / `client.command.*` | Git/命令 |

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
| `event` | Bridge → 手机 | `event, data` |

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

Bridge 使用 `@opencode-ai/sdk` v2。所有代理方法的实际调用：

| 手机 WS 方法 | SDK v2 调用 |
|-------------|-------------|
| `session.create` | `client.session.create()` |
| `session.list` | `client.session.list()` |
| `session.get` | `client.session.get()` |
| `session.delete` | `client.session.delete()` |
| `session.rename` | `client.session.update()` |
| `session.messages` | `client.session.messages()` |
| `session.diff` | `client.session.diff()` |
| `session.abort` | `client.session.abort()` |
| `session.revert` | `client.session.revert()` |
| `session.unrevert` | `client.session.unrevert()` |
| `session.todo` | `client.session.todo()` |
| `message.send` | `client.session.prompt()` |
| `message.shell` | `client.session.shell()` |
| `message.command` | `client.session.command()` |
| `permission.reply` | `client.permission.reply()` |
| `question.reply` | `client.question.reply()` |
| `question.reject` | `client.question.reject()` |
| `config.get` | `client.config.get()` |
| `config.providers` | `client.config.providers()` |
| `config.agents` | `client.app.agents()` |
| `provider.list` | `client.provider.list()` |
| `vcs.get` | `client.vcs.get()` |
| `command.list` | `client.command.list()` |

事件订阅：Bridge 调用 `client.global.event()` 获取 SSE 流，实时转为 WS `event` 帧推送手机端。

### 1.7 多 Agent 适配器

所有 Agent 后端实现统一 `AgentBackend` 接口。文件操作和认证不经过适配器。

| 适配器 | 协议 | 目标 |
|--------|------|------|
| **OpenCode** | `@opencode-ai/sdk` v2（HTTP + SSE） | OpenCode serve :4096 |
| **Hermes** | JSON-RPC over stdio | Python 网关进程 |
| **OpenClaw** | WebSocket 原生协议 | Gateway :18789 |

适配器接口定义及具体实现见 `docs/code-reference/bridge-adapters.md`。

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
 │  { title }                 │                           │
 │───────────────────────────▶│  client.session.create()  │
 │                            │──────────────────────────▶│
 │◀───────────────────────────│  { id, title, createdAt } │
 │                            │                           │
 │  session.list              │                           │
 │───────────────────────────▶│  client.session.list()    │
 │                            │──────────────────────────▶│
 │◀───────────────────────────│  [{ id, title, status }]  │
```

**接口（全代理）：**

| 方法 | 参数 | SDK v2 | Phase |
|------|------|--------|-------|
| `session.create` | `{ title, agent?, model? }` | `create()` | 1 |
| `session.list` | `{ search?, limit? }` | `list()` | 1 |
| `session.get` | `{ sessionID }` | `get()` | 1 |
| `session.delete` | `{ sessionID }` | `delete()` | 1 |
| `session.rename` | `{ sessionID, title }` | `update()` | 1 |
| `session.messages` | `{ sessionID, limit?, before? }` | `messages()` | 1 |

**事件：** 无。结果通过 `res` 帧返回。

### 2.3 聊天通信

**时序：**
```
手机                         Bridge                      OpenCode
 │  message.send              │                           │
 │  { sessionID, text }       │                           │
 │───────────────────────────▶│  client.session.prompt()  │
 │                            │──────────────────────────▶│
 │                            │  ◀── SSE: message.part.updated (streaming) ──│
 │◀── event: message.part.updated                         │
 │  { delta, messageID }      │                           │
 │◀── event: message.part.updated                         │
 │◀── event: session.idle    │  (回复完成)                │
 │                            │                           │
 │  message.abort             │  (用户中止)                │
 │───────────────────────────▶│  client.session.abort()   │
 │                            │──────────────────────────▶│
```

**接口（全代理）：**

| 方法 | 参数 | SDK v2 | Phase |
|------|------|--------|-------|
| `message.send` | `{ sessionID, text, attachments? }` | `prompt()` | 1 |
| `message.shell` | `{ sessionID, command }` | `shell()` | 2 |
| `message.command` | `{ sessionID, command, args? }` | `command()` | 2 |
| `message.abort` | `{ sessionID }` | `abort()` | 1 |

**事件：**

| 事件 | 数据 | OpenCode SSE | 说明 |
|------|------|-------------|------|
| `message.part.updated` | `{ sessionID, messageID, delta }` | `message.part.updated` | 流式令牌 |
| `session.idle` | `{ sessionID }` | `session.idle` | 回复完成 |
| `session.error` | `{ sessionID, error }` | `session.error` | 出错 |

### 2.4 工具审批

**时序：**
```
手机                         Bridge                      OpenCode
 │                            │◀── SSE: permission.asked │
 │◀── event: permission.asked │                           │
 │  { requestID, tool, args } │                           │
 │                            │                           │
 │  permission.reply          │                           │
 │  { requestID, reply:      │                           │
 │    "once"|"always"|        │                           │
 │    "reject", message? }    │                           │
 │───────────────────────────▶│  client.permission.reply()│
 │                            │──────────────────────────▶│
```

**接口（全代理）：**

| 方法 | 参数 | SDK v2 | Phase |
|------|------|--------|-------|
| `permission.reply` | `{ requestID, reply, message? }` | `reply()` | 1 |

**事件：**

| 事件 | 数据 | OpenCode SSE | 说明 |
|------|------|-------------|------|
| `permission.asked` | `{ requestID, sessionID, tool, args }` | `permission.asked` | 需审批 |
| `permission.replied` | `{ requestID, reply }` | `permission.replied` | 已处理 |

### 2.5 问答系统

**时序：**
```
手机                         Bridge                      OpenCode
 │                            │◀── SSE: question.asked   │
 │◀── event: question.asked   │                           │
 │  { requestID, questions }  │                           │
 │                            │                           │
 │  question.reply            │                           │
 │  { requestID, answers }    │                           │
 │───────────────────────────▶│  client.question.reply()  │
 │                            │──────────────────────────▶│
 │                            │                           │
 │  question.reject           │  (或拒绝)                  │
 │───────────────────────────▶│  client.question.reject() │
 │                            │──────────────────────────▶│
```

**接口（全代理，v2 only）：**

| 方法 | 参数 | SDK v2 | Phase |
|------|------|--------|-------|
| `question.reply` | `{ requestID, answers }` | `reply()` | 2 |
| `question.reject` | `{ requestID }` | `reject()` | 2 |

**事件：**

| 事件 | 数据 | OpenCode SSE | 说明 |
|------|------|-------------|------|
| `question.asked` | `{ requestID, questions[] }` | `question.asked` | 需回答 |

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

### 2.7 配置与启动

手机启动时一次性加载。

**接口（全代理）：**

| 方法 | 参数 | SDK v2 | Phase |
|------|------|--------|-------|
| `config.get` | `{ directory?, workspace? }` | `config.get()` | 1 |
| `config.providers` | `{ directory?, workspace? }` | `config.providers()` | 1 |
| `config.agents` | `{ directory?, workspace? }` | `app.agents()` | 1 |
| `provider.list` | `{ directory?, workspace? }` | `provider.list()` | 1 |
| `vcs.get` | `{ directory?, workspace? }` | `vcs.get()` | 1 |
| `command.list` | `{ directory?, workspace? }` | `command.list()` | 1 |

**事件：** 无。

### 2.8 会话进阶

差异查看、撤销/重做、待办。

**接口（全代理）：**

| 方法 | 参数 | SDK v2 | Phase |
|------|------|--------|-------|
| `session.diff` | `{ sessionID, messageID? }` | `diff()` | 2 |
| `session.revert` | `{ sessionID, messageID }` | `revert()` | 2 |
| `session.unrevert` | `{ sessionID }` | `unrevert()` | 2 |
| `session.todo` | `{ sessionID }` | `todo()` | 2 |

**事件：**

| 事件 | 数据 | OpenCode SSE | 说明 |
|------|------|-------------|------|
| `session.diff` | `{ sessionID, files[] }` | `session.diff` | 文件变更 |
| `todo.updated` | `{ sessionID, todos[] }` | `todo.updated` | 待办更新 |

---

## 3. 状态管理

| 分片 | 职责 |
|------|------|
| `connection` | 连接状态、服务器 URL、Agent 类型 |
| `sessions` | 会话列表、当前会话 ID |
| `messages` | 消息历史、流式增量 |
| `ui` | 导航、主题、字体 |

---

## 4. 总结

**核心架构：** 手机 (WS) → Bridge (SDK) → Agent，Bridge 同时承担协议转换和直接服务（认证、文件）的职责。

**接口覆盖：** 核心交互（会话/消息/审批/问答）全部对齐 OpenCode TUI，覆盖率 100%。文件浏览器是手机端独有增强功能。

**代码参考：** 适配器实现见 `docs/code-reference/bridge-adapters.md`，手机客户端见 `docs/code-reference/bridge-client.md`。

---

*文档版本：1.1*
*最后更新：2026-06-28*
