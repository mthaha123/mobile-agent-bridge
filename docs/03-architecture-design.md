# 架构设计：Mobile Agent Bridge

## 摘要

本文档描述了三层架构：**手机客户端** → **Bridge 服务器（我们部署）** → **Agent 服务器（OpenCode/Hermes/OpenClaw）**。Bridge 服务器是核心，负责内网穿透供手机连接，并使用 `@opencode-ai/sdk` 与 Agent 服务器通信。

---

## 1. 整体架构

### 1.1 三层架构

┌─────────────────────────────────────────────────────────────────────────────┐
│                         手机客户端（React Native / ArkUI）                    │
│                                                                             │
│  通过 WebSocket 连接 Bridge，隧道对应用完全透明                              │
│                                                                             │
│  ┌──────────────────────────────────────────────────────┐                  │
│  │  WebSocket 客户端（wss://bridge:8080/ws）            │                  │
│  │  协议：JSON 帧（type: req/res/event）                │                  │
│  └──────────────────────────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────────┘
                            │
                            │  WSS（隧道透明：直连/Tailscale/FRP）
                            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     Bridge 服务器（Node.js）                                │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  WebSocket 服务端 :8080     JSON 帧解析                              │  │
│  │                                                                      │  │
│  │  ▼ RPC 路由（WS 帧 → 适配器调用）                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │  message.send    → client.session.prompt                     │  │  │
│  │  │  message.shell   → client.session.shell                      │  │  │
│  │  │  permission.reply → client.permission.reply                  │  │  │
│  │  │  question.reply  → client.question.reply                     │  │  │
│  │  │  session.*       → client.session.*                          │  │  │
│  │  │  file.*           → 自实现 HTTP 请求（TUI 无此功能，手机增强） │  │  │
│  │  │  config.*         → client.config.* / client.app.*            │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                                                                      │  │
│  │  ▼ Agent 适配器                                                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │  │
│  │  │ OpenCode     │  │  Hermes      │  │  OpenClaw   │             │  │
│  │  │ @opencode-ai │  │  JSON-RPC    │  │  WebSocket   │             │  │
│  │  │ /sdk         │  │  over stdio  │  │  :18789      │             │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │  │
│  │         │                 │                 │                        │  │
│  │         ▼                 ▼                 ▼                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │  │
│  │  │ OpenCode     │  │  Hermes      │  │  OpenClaw    │             │  │
│  │  │ serve :4096  │  │  Python 进程  │  │  Gateway :18789│           │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │  │
│  │                                                                      │  │
│  │  通用层：JWT 认证 / 频率限制 / 审计日志                              │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘

### 1.2 代理调用 vs 直接实现

Bridge 的接口分两类：

**代理调用**（经 Agent 适配器转发到后端，Bridge 做透传，不做业务处理）：

| 方法 | 转发目标 | 说明 |
|------|---------|------|
| `session.*` | OpenCode SDK `client.session.*` | CRUD + messages/todo/diff/abort/revert |
| `message.send` | OpenCode SDK `client.session.prompt` | 文本消息 |
| `message.shell` | OpenCode SDK `client.session.shell` | Shell 命令 |
| `message.command` | OpenCode SDK `client.session.command` | 斜杠命令 |
| `permission.reply` | OpenCode SDK `client.permission.reply` | 审批 |
| `question.*` | OpenCode SDK `client.question.*` | 问答 |
| `config.*` | OpenCode SDK `client.config.*` / `client.app.*` | 配置/提供商/Agent 列表 |
| `vcs.get` / `command.list` | OpenCode SDK | Git/命令信息 |

**直接实现**（Bridge 自有逻辑，不经过 Agent）：

| 方法 | 实现方式 | 说明 |
|------|---------|------|
| `auth.login / refresh / logout` | Bridge 签发/撤销 JWT | 移动端认证，OpenCode 不参与 |
| `notification.register` | Bridge 存储 FCM/APNs token | Phase 3。手机可能被挂起导致 WS 断开，需推送唤醒 |
| `file.list` | Bridge 直接 `fs.readdir` | Bridge 与项目同机运行，直接读文件系统 |
| `file.read` | Bridge 直接 `fs.readFile` | 同上 |
| `file.search` | Bridge 调用 OpenCode REST `GET /find/file?query=` | 依赖 ripgrep（OpenCode 内置） |
| `health.ping` | Bridge 自身 `/health` | 心跳 |

### 1.3 组件职责

| 组件 | 职责 |
|------|------|
| **手机客户端** | UI 渲染，用户交互，本地状态 |
| **Bridge 服务器** | 协议转换，隧道管理，认证 |
| **Agent 服务器** | LLM 推理，工具执行，会话管理 |

---

## 2. 网络架构

### 2.1 连接流程

```
┌──────────┐         ┌──────────────┐         ┌──────────────┐
│  手机    │ ──WSS────▶│   Bridge    │ ──SDK────▶│  Agent       │
│  客户端  │ ◀──WSS────│   服务器    │ ◀──SSE──│  服务器      │
│          │  双向     │  (Node.js)  │  (SDK)  │  (OpenCode)  │
└──────────┘  隧道    └──────────────┘         └──────────────┘
     │                      │
     │                      │
     ▼                      ▼
  4G/5G/WiFi           Tailscale/FRP
  (外网)                (内网穿透)
```

手机端通过 WebSocket 与 Bridge 服务器保持双向连接。Bridge 服务器使用 `@opencode-ai/sdk` 与 OpenCode 通信。内网穿透由 Bridge 服务器管理（Tailscale/FRP/自建隧道）。

### 2.2 两层协议

系统中有两层独立的通信协议：

**协议层 A：手机 ↔ Bridge 服务器（我们定义）**

| 用途 | 协议 | 方案 |
|------|------|------|
| **手机发送指令** | WebSocket JSON 帧 | 自定义协议，类似 OpenClaw 的 WS 帧格式 |
| **Bridge 推送事件** | WebSocket 帧 | 实时推送会话状态、工具审批请求 |
| **文件传输** | HTTP REST | 文件列表、读取通过 REST |
| **认证** | JWT Token | 手机登录 Bridge 获取 JWT |

**协议层 B：Bridge 服务器 ↔ Agent 服务器（Agent 原生）**

| Agent 类型 | 协议 | 实现方式 |
|-----------|------|----------|
| **OpenCode** | HTTP + SSE | `@opencode-ai/sdk`（Node.js） |
| **Hermes** | JSON-RPC over stdio | 启动 Python 网关进程 |
| **OpenClaw** | WebSocket | 原生 WS 协议连接 :18789 |

### 2.3 连接状态

```
┌─────────────────────────────────────────────────────────┐
│                    连接状态机                              │
│                                                           │
│  ┌──────────┐    connect    ┌──────────┐                │
│  │  已断开  │──────────────▶│ 连接中   │                │
│  └──────────┘              └──────┬───┘                │
│       ▲                          │                      │
│       │ 断开连接                 │ 成功                 │
│       │                          ▼                      │
│  ┌──────────┐              ┌──────────┐                │
│  │ 重连中   │◀─────────────│ 已连接   │                │
│  └──────────┘  超时        └──────┬───┘                │
│       │                          │                      │
│       │                          │ 错误                │
│       └──────────────────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 手机 ↔ Bridge 通信协议

### 3.1 设计原则

手机不直接与 OpenCode 服务器通信，而是通过 **Bridge 服务器** 转发。原因：

1. **内网穿透**：手机在外网，OpenCode 在内网，Bridge 管理隧道连接
2. **统一接口**：手机端一套 API 即可支持 OpenCode/Hermes/OpenClaw 三种后端
3. **安全性**：API Key 等敏感信息不暴露到手机端
4. **协议简化**：手机端只需 WebSocket 长连接，无需处理 SSE 重连等复杂逻辑

### 3.2 传输层选择

| 方案 | 优点 | 缺点 | 选择 |
|------|------|------|------|
| **WebSocket** | 双向实时、低延迟、移动网络友好 | 实现稍复杂 | ✅ **首选** |
| **HTTP + SSE** | 简单、兼容性好 | 单向推送、重连复杂 | ❌ 不适合移动网络 |
| **gRPC** | 高性能、强类型 | 移动端支持差 | ❌ 过度设计 |

### 3.3 WebSocket 消息格式

采用 JSON 帧格式，参考 OpenClaw 的 Gateway 协议设计：

```typescript
// 手机 → Bridge
interface Request {
  type: "req"
  id: string          // 请求 ID，用于匹配响应
  method: string      // 方法名
  params: object      // 参数
}

// Bridge → 手机（响应）
interface Response {
  type: "res"
  id: string          // 对应请求 ID
  ok: boolean
  payload?: object
  error?: { message: string }
}

// Bridge → 手机（事件推送）
interface Event {
  type: "event"
  event: string       // 事件类型
  data: object        // 事件数据
}
```

### 3.4 核心方法列表

| 方法 | 方向 | 参数 | 说明 | Phase |
|------|------|------|------|-------|
| `session.create` | 手机→桥 | `{ title }` | 创建会话 | 1 |
| `session.list` | 手机→桥 | `{}` | 列出会话 | 1 |
| `session.get` | 手机→桥 | `{ sessionID }` | 获取会话 | 1 |
| `session.delete` | 手机→桥 | `{ sessionID }` | 删除会话 | 1 |
| `session.rename` | 手机→桥 | `{ sessionID, title }` | 重命名 | 1 |
| `message.send` | 手机→桥 | `{ sessionID, text }` | 发送消息 | 1 |
| `message.shell` | 手机→桥 | `{ sessionID, command }` | Shell 命令 | 2 |
| `message.abort` | 手机→桥 | `{ sessionID }` | 中止 | 1 |
| `permission.reply` | 手机→桥 | `{ sessionID, permID, action, message? }` | 审批 | 1 |
| `question.reply` | 手机→桥 | `{ requestID, answers }` | 回答问题 | 2 |
| `question.reject` | 手机→桥 | `{ requestID }` | 拒绝问题 | 2 |
| `file.list` | 手机→桥 | `{ path }` | 列出目录 | 2 |
| `file.read` | 手机→桥 | `{ path }` | 读取文件 | 2 |
| `file.search` | 手机→桥 | `{ query, pattern? }` | 搜索文件 | 2 |
| `session.diff` | 手机→桥 | `{ sessionID }` | 获取差异 | 2 |
| `session.revert` | 手机→桥 | `{ sessionID, messageID }` | 撤销 | 2 |
| `session.unrevert` | 手机→桥 | `{ sessionID }` | 重做 | 2 |
| `mcp.status` | 手机→桥 | `{}` | MCP 状态 | 3 |
| `config.providers` | 手机→桥 | `{}` | 提供商列表 | 3 |
| `session.share` | 手机→桥 | `{ sessionID }` | 分享会话 | 3 |

### 3.5 事件推送

Bridge 服务器将 Agent 事件转换为手机端事件推送：

| 事件 | 触发时机 | 数据 |
|------|----------|------|
| `session.status` | 会话状态变化 | `{ sessionID, status }` |
| `session.idle` | 会话完成 | `{ sessionID }` |
| `session.error` | 会话错误 | `{ sessionID, error }` |
| `message.part.updated` | 流式令牌更新 | `{ sessionID, messageID, delta }` |
| `permission.asked` | 需审批工具 | `{ sessionID, permID, tool, args }` |
| `question.asked` | 需回答问题 | `{ requestID, questions[] }` |
| `session.diff` | 文件变更 | `{ sessionID, files[] }` |
| `todo.updated` | 待办更新 | `{ sessionID, todos[] }` |

#### 会话操作

| 我们的 API | OpenCode API | 说明 |
|-----------|--------------|------|
| `POST /sessions` | `POST /session` | 创建新会话 |
| `GET /sessions` | `GET /session` | 列出所有会话 |
| `GET /sessions/:id` | `GET /session/:id` | 获取会话详情 |
| `DELETE /sessions/:id` | `DELETE /session/:id` | 删除会话 |
| `PATCH /sessions/:id` | `PATCH /session/:id` | 更新会话 |

#### 消息操作

| 我们的 API | OpenCode API | 说明 |
|-----------|--------------|------|
| `GET /sessions/:id/messages` | `GET /session/:id/message` | 列出消息 |
| `POST /sessions/:id/messages` | `POST /session/:id/prompt_async` | 发送消息（异步） |
| `POST /sessions/:id/abort` | `POST /session/:id/abort` | 中止会话 |

#### 权限操作

| 我们的 API | OpenCode API | 说明 |
|-----------|--------------|------|
| `POST /sessions/:id/permissions/:pid/approve` | `POST /session/:id/permissions/:pid` | 批准工具 |
| `POST /sessions/:id/permissions/:pid/reject` | `POST /session/:id/permissions/:pid` | 拒绝工具 |

#### 文件操作

| 我们的 API | OpenCode API | 说明 |
|-----------|--------------|------|
| `GET /files?path=<path>` | `GET /file?path=<path>` | 列出目录 |
| `GET /files/content?path=<path>` | `GET /file/content?path=<path>` | 读取文件 |
| `GET /files/search?q=<query>` | `GET /find?pattern=<query>` | 搜索文件 |
| `GET /files/find?q=<query>` | `GET /find/file?query=<query>` | 查找文件 |

### 3.2 SSE 事件映射

| 我们的事件 | OpenCode 事件 | 说明 |
|-----------|---------------|------|
| `session.created` | `session.created` | 直接映射 |
| `session.updated` | `session.updated` | 直接映射 |
| `message.created` | `message.updated` | 消息添加 |
| `message.updated` | `message.updated` | 消息更新 |
| `token.stream` | `message.part.updated` | 令牌流式传输 |
| `tool.request` | `permission.asked` | 需要工具审批 |
| `tool.approved` | `permission.replied` | 工具已批准 |
| `tool.rejected` | `permission.replied` | 工具已拒绝 |
| `session.error` | `session.error` | 发生错误 |
| `session.idle` | `session.idle` | 会话完成 |

### 3.3 数据转换

#### 消息格式（我们 → OpenCode）

```typescript
// 我们的格式
interface SendMessageRequest {
  sessionId: string;
  content: string;
  attachments?: FileAttachment[];
}

// OpenCode 格式
interface OpenCodePromptRequest {
  agent?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  parts: Array<{
    type: 'text' | 'file';
    text?: string;
    url?: string;
    mediaType?: string;
  }>;
}
```

#### 消息格式（OpenCode → 我们）

```typescript
// OpenCode 格式
interface OpenCodeMessage {
  info: {
    id: string;
    role: 'user' | 'assistant';
    model?: string;
    tokens?: { input: number; output: number };
  };
  parts: Array<{
    type: 'text' | 'tool-invocation' | 'tool-result';
    text?: string;
    toolInvocation?: {
      toolName: string;
      args: Record<string, unknown>;
      state: 'call' | 'result';
      result?: unknown;
    };
  }>;
}

// 我们的格式
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  tokens?: TokenUsage;
}
```

---

## 4. Bridge 服务器 — OpenCode 适配器

Bridge 服务器使用 `@opencode-ai/sdk` 与 OpenCode 通信。SDK 在 Node.js 环境原生运行。

```
Bridge 服务器 (Node.js)
  │
  ├── @opencode-ai/sdk  ←── 创建客户端
  │   └── createOpencodeClient({ baseUrl: "http://localhost:4096" })
  │
  ├── client.session.*     ←── 会话操作
  ├── client.event.*       ←── SSE 事件订阅
  ├── client.permission.*  ←── 权限处理
  └── client.file.*        ←── 文件操作
```

### 4.1 SDK 映射（Bridge → OpenCode）

Bridge 服务器使用 `@opencode-ai/sdk` 的客户端 API 与 OpenCode 通信：

```typescript
const sdk = createOpencodeClient({ baseUrl: 'http://localhost:4096' })

// 消息转发：手机 WS → SDK
sdk.client.session.prompt({ path: { id }, body: { parts } })
sdk.client.session.shell({ path: { id }, body: { command } })
sdk.client.session.command({ path: { id }, body: { command, args } })
sdk.client.session.abort({ path: { id } })
sdk.client.session.create({ body: { title } })
sdk.client.session.list()
sdk.client.session.get({ sessionID })
sdk.client.session.delete({ sessionID })
sdk.client.session.messages({ sessionID })
sdk.client.session.todo({ sessionID })
sdk.client.session.diff({ sessionID })
sdk.client.session.revert({ sessionID, messageID })
sdk.client.session.unrevert({ sessionID })
sdk.client.session.share({ sessionID })
sdk.client.session.unshare({ sessionID })

// 权限
sdk.client.permission.reply({ reply, requestID, message })

// 事件订阅（SSE → WebSocket 转发）
const events = await sdk.global.event()
for await (const event of events.stream) {
  this.broadcastToMobile({ type: 'event', event: event.type, data: event.properties })
}

// 文件
sdk.client.file.list({ query: { path } })
sdk.client.file.read({ query: { path } })
sdk.client.find.files({ query })
sdk.client.find.text({ pattern })

// 配置
sdk.client.config.providers({ workspace })
sdk.client.app.agents({ workspace })

// MCP
sdk.client.mcp.status()
```

---

## 5. Bridge 服务器 — 多 Agent 适配器

### 5.1 适配器接口

所有 Agent 后端实现统一接口，Bridge 服务器根据配置选择后端：

```typescript
interface AgentBackend {
  connect(config: any): Promise<void>
  sendMessage(sessionID: string, text: string): Promise<void>
  sendShell(sessionID: string, command: string): Promise<void>
  abortSession(sessionID: string): Promise<void>
  replyPermission(sessionID: string, requestID: string, action: string, message?: string): Promise<void>
  replyQuestion(requestID: string, answers: any[]): Promise<void>
  subscribeEvents(): AsyncIterable<AgentEvent>
  listFiles(path: string): Promise<any>
  readFile(path: string): Promise<string>
  searchFiles(query: string): Promise<string[]>
}
```

### 5.2 OpenCode（使用 SDK）

```typescript
class OpenCodeBackend implements AgentBackend {
  private sdk = createOpencodeClient({ baseUrl: 'http://localhost:4096' })

  async sendMessage(sessionID: string, text: string): Promise<void> {
    await this.sdk.client.session.prompt({
      path: { id: sessionID },
      body: { noReply: true, parts: [{ type: 'text', text }] },
    })
  }

  async subscribeEvents(): Promise<AsyncIterable<AgentEvent>> {
    const events = await this.sdk.global.event()
    return events.stream
  }

  async listFiles(path: string) {
    const res = await this.sdk.client.file.list({ query: { path } })
    return res.data
  }
}
```

### 5.3 Hermes（JSON-RPC over stdio）

```typescript
class HermesBackend implements AgentBackend {
  private proc: ChildProcess
  private requestId = 0

  async connect(): Promise<void> {
    this.proc = spawn('python', ['-m', 'tui_gateway.entry'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  }

  async sendMessage(sessionID: string, text: string): Promise<void> {
    await this.rpcCall('chat.send', { sessionId: sessionID, content: text })
  }

  private rpcCall(method: string, params: any): Promise<any> {
    const id = ++this.requestId
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    // 读取 stdout 匹配响应
  }

  async subscribeEvents(): Promise<AsyncIterable<AgentEvent>> {
    // 从 stdout 读取行分隔 JSON
  }
}
```

### 5.4 OpenClaw（WebSocket）

```typescript
class OpenClawBackend implements AgentBackend {
  private ws: WebSocket

  async connect(config: OpenClawConfig): Promise<void> {
    this.ws = new WebSocket(`wss://${config.host}:18789`)
    await this.sendFrame({
      type: 'req', method: 'connect',
      params: { role: 'operator', auth: { token: config.token } },
    })
  }

  async sendMessage(sessionID: string, text: string): Promise<void> {
    await this.sendFrame({
      type: 'req', method: 'agent',
      params: { sessionId: sessionID, message: text },
    })
  }

  private async sendFrame(frame: any): Promise<void> {
    this.ws.send(JSON.stringify(frame))
  }

  async subscribeEvents(): Promise<AsyncIterable<AgentEvent>> {
    // 从 ws.onmessage 过滤 type === 'event'
  }
}
```

---

## 6. 状态管理

### 6.1 状态结构

```typescript
interface AppState {
  connection: {
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    serverUrl: string;
    adapter: 'opencode' | 'hermes' | 'openclaw';
    error?: string;
  };
  sessions: {
    items: Session[];
    currentId: string | null;
    loading: boolean;
  };
  messages: {
    items: Record<string, Message[]>;  // sessionId -> messages
    streaming: Record<string, string>;  // sessionId -> current token
    loading: Record<string, boolean>;
  };
  ui: {
    activeTab: 'chat' | 'files' | 'sessions' | 'settings';
    theme: 'light' | 'dark' | 'system';
    fontSize: 'small' | 'medium' | 'large';
  };
}
```

### 6.2 状态分片

| 分片 | 职责 |
|------|------|
| `connection` | 服务器连接状态和配置 |
| `sessions` | 会话列表和当前会话 |
| `messages` | 消息历史和流式传输 |
| `ui` | UI 偏好和导航 |

### 6.3 Actions

```typescript
connect(serverUrl: string, adapter: string): Promise<void>;
disconnect(): void;
reconnect(): void;
createSession(): Promise<Session>;
selectSession(id: string): void;
deleteSession(id: string): Promise<void>;
sendMessage(sessionId: string, content: string): Promise<void>;
abortSession(sessionId: string): Promise<void>;
approvePermission(sessionId: string, permissionId: string, approved: boolean): Promise<void>;
setActiveTab(tab: string): void;
setTheme(theme: string): void;
setFontSize(size: string): void;
```

---

## 7. 手机端网络层（与 Bridge 通信）

### 7.1 通信方式

手机端不直接连接 OpenCode，而是通过 **WebSocket 长连接** 与 Bridge 服务器通信。

```
手机 ──WSS──▶ Bridge 服务器 ──SDK──▶ OpenCode
     WebSocket          @opencode-ai/sdk
```

**为什么用 WebSocket 而不是 HTTP/SSE：**
- 移动网络不稳，WebSocket 长连接比 SSE 更可靠
- 双向通信，Bridge 可直接推送事件给手机
- 内网穿透场景下，WebSocket 隧道开销更小
- 原生支持（React Native `WebSocket` API、ArkTS `@ohos.net.webSocket`）

### 7.2 平台 WebSocket API

| 平台 | API | 备注 |
|------|-----|------|
| **React Native** | `new WebSocket(url)` | 内置 API，无需额外库 |
| **HarmonyOS** | `@ohos.net.webSocket` | 原生 WebSocket 支持 |

### 7.3 React Native 客户端

```typescript
class BridgeClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, { resolve, reject, timeout }>()
  private handlers = new Map<string, (data: any) => void>()

  connect(url: string, token: string): void {
    this.ws = new WebSocket(`${url}?token=${token}`)

    this.ws.onopen = () => {
      console.log('Bridge 连接成功')
      this.send('session.list', {}).then(sessions => {
        useSessionStore.getState().setSessions(sessions)
      })
    }

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'res') {
        // 请求响应
        const pending = this.pending.get(msg.id)
        if (pending) {
          pending.resolve(msg.payload)
          clearTimeout(pending.timeout)
          this.pending.delete(msg.id)
        }
      } else if (msg.type === 'event') {
        // 事件推送
        const handler = this.handlers.get(msg.event)
        if (handler) handler(msg.data)
      }
    }

    this.ws.onclose = () => {
      console.warn('Bridge 断开，5 秒后重连')
      setTimeout(() => this.connect(url, token), 5000)
    }
  }

  // 发送请求，等待响应
  async call(method: string, params: any = {}): Promise<any> {
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('请求超时')), 30000)
      this.pending.set(id, { resolve, reject, timeout })
      this.ws?.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  // 注册事件监听
  on(event: string, handler: (data: any) => void): void {
    this.handlers.set(event, handler)
  }

  // === 会话 ===
  createSession(title: string) { return this.call('session.create', { title }) }
  listSessions() { return this.call('session.list') }
  deleteSession(id: string) { return this.call('session.delete', { sessionID: id }) }

  // === 消息 ===
  sendMessage(sessionID: string, text: string) { return this.call('message.send', { sessionID, text }) }
  sendShell(sessionID: string, command: string) { return this.call('message.shell', { sessionID, command }) }
  abortSession(sessionID: string) { return this.call('message.abort', { sessionID }) }

  // === 权限 ===
  replyPermission(sessionID: string, permID: string, action: string, message?: string) {
    return this.call('permission.reply', { sessionID, permID, action, message })
  }

  // === 文件 ===
  listFiles(path: string) { return this.call('file.list', { path }) }
  readFile(path: string) { return this.call('file.read', { path }) }
  searchFiles(query: string) { return this.call('file.search', { query }) }
}

// 使用
const bridge = new BridgeClient()
bridge.connect('wss://bridge.example.com/ws', 'jwt-token')

bridge.on('message.part.updated', (data) => {
  useMessageStore.getState().appendDelta(data.sessionID, data.messageID, data.delta)
})

bridge.on('permission.asked', (data) => {
  usePermissionStore.getState().addRequest(data)
})
```

### 7.4 HarmonyOS ArkTS 客户端

```typescript
import webSocket from '@ohos.net.webSocket'

class HarmonyBridgeClient {
  private ws: webSocket.WebSocket
  private pending: Map<string, { resolve: Function, reject: Function }> = new Map()

  connect(url: string, token: string): void {
    this.ws = webSocket.createWebSocket()
    this.ws.connect(`${url}?token=${token}`, (err) => {
      if (err) { console.error('连接失败', err); return }
      this.listen()
    })
  }

  private listen(): void {
    this.ws.on('message', (data: string) => {
      const msg = JSON.parse(data)
      if (msg.type === 'res') {
        this.pending.get(msg.id)?.resolve(msg.payload)
        this.pending.delete(msg.id)
      } else if (msg.type === 'event') {
        // 分发事件
      }
    })
  }

  async call(method: string, params: any = {}): Promise<any> {
    const id = `req_${Date.now()}`
    this.ws.send(JSON.stringify({ type: 'req', id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => reject(new Error('超时')), 30000)
    })
  }
}
```

---

## 8. 安全

### 8.1 认证流程

```
┌──────────┐         ┌──────────────┐         ┌──────────────┐
│  手机    │ ──登录──▶│   Bridge    │ ──认证──▶│  Agent       │
│  客户端  │ ◀──令牌──│   服务器    │ ◀──令牌──│  服务器      │
└──────────┘         └──────────────┘         └──────────────┘
```

### 8.2 令牌存储

| 平台 | 存储 | 安全 |
|------|------|------|
| **iOS** | Keychain | Secure Enclave |
| **Android** | Keystore | 硬件背书 |
| **Bridge 服务器** | 加密数据库 | AES-256 |

### 8.3 权限系统

```typescript
interface Permission {
  id: string;
  sessionId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: number;
}
```

---

## 9. 隧道管理

### 9.1 隧道选项

| 隧道 | 协议 | 优点 | 缺点 |
|------|------|------|------|
| **Tailscale** | WireGuard | 安全、快速、易用 | 需要 Tailscale 账号 |
| **FRP** | TCP | 自托管、灵活 | 配置较多 |
| **Ngrok** | HTTP | 快速启动 | 免费版有限 |
| **直连 LAN** | TCP | 无需隧道 | 仅限同网络 |

### 9.2 隧道选择流程

```
┌─────────────────────────────────────────────────────────┐
│                    隧道选择                               │
│                                                           │
│  1. 检查是否在同一局域网                                  │
│     └─▶ 是 → 直连                                        │
│                                                           │
│  2. 检查 Tailscale 是否可用                              │
│     └─▶ 是 → 使用 Tailscale                             │
│                                                           │
│  3. 检查 FRP 是否已配置                                  │
│     └─▶ 是 → 使用 FRP                                   │
│                                                           │
│  4. 回退到 Ngrok                                         │
│     └─▶ 显示设置指引                                    │
└─────────────────────────────────────────────────────────┘
```

---

## 10. 错误处理

### 10.1 错误类型

| 错误 | 恢复 |
|------|------|
| **网络错误** | 指数退避自动重连 |
| **认证错误** | 提示重新认证 |
| **服务器错误** | 显示错误，提供重试选项 |
| **超时** | 使用更长超时重试 |
| **权限被拒** | 显示错误，建议修复 |

### 10.2 重试策略

```typescript
interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T> {
  for (let i = 0; i < config.maxRetries; i++) {
    try { return await fn(); }
    catch (error) { await delay(); }
  }
  throw lastError;
}
```

---

## 11. 性能优化

### 11.1 缓存策略

| 数据 | 缓存时长 | 失效条件 |
|------|----------|----------|
| **会话** | 5 分钟 | 会话更新时 |
| **消息** | 会话生命周期 | 新消息到达 |
| **文件** | 1 分钟 | 文件变更时 |
| **配置** | 1 小时 | 配置变更时 |

### 11.2 懒加载

```typescript
const fileContent = lazyLoad(
  () => client.get(`/files/content?path=${path}`),
  { ttl: 60000 }
);
```

### 11.3 分页

```typescript
interface PaginationParams { page: number; limit: number; sort?: 'asc' | 'desc'; }
interface PaginatedResponse<T> { items: T[]; total: number; hasMore: boolean; }
```

---

## 12. 测试策略

### 12.1 单元测试

| 组件 | 测试覆盖 |
|------|----------|
| REST 客户端 | 请求/响应处理 |
| SSE 客户端 | 事件解析、重连 |
| 状态管理 | 状态转换 |
| 协议适配器 | 数据转换 |

### 12.2 集成测试

| 场景 | 测试类型 |
|------|----------|
| 连接 OpenCode | E2E |
| 发送/接收消息 | E2E |
| 工具审批流程 | E2E |
| 会话管理 | E2E |
| 文件操作 | E2E |

---

## 13. 部署

### 13.1 移动应用分发

| 平台 | 分发渠道 |
|------|----------|
| **iOS** | TestFlight → App Store |
| **Android** | APK → Play Store |
| **HarmonyOS** | AppGallery |

### 13.2 Bridge 服务器分发

| 选项 | 描述 |
|------|------|
| **NPM 包** | `npx mobile-agent-bridge` |
| **Docker** | `docker run mobile-agent-bridge` |
| **二进制** | 独立可执行文件 |

### 13.3 配置

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8080
  },
  "agent": {
    "type": "opencode",
    "url": "http://localhost:4096",
    "auth": { "type": "basic", "username": "opencode", "password": "secret" }
  },
  "auth": { "jwtSecret": "your-secret" }
}
```

> **隧道配置属于部署环境**，不在应用配置中。直连则 Bridge 暴露端口；Tailscale 则分配 Tailnet IP 后手机连该 IP；FRP 则连公网服务器转发端口。无论哪种方式，Bridge 应用代码无需修改。

---

## 14. 总结

### 14.1 架构优势

1. **模块化设计**：易于添加新 Agent 适配器
2. **协议抽象**：手机客户端与具体 Agent 无关
3. **安全**：端到端加密，安全存储
4. **性能**：缓存、懒加载、分页
5. **可靠**：自动重连、重试、错误恢复

### 14.2 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| **移动端框架（Android/iOS）** | React Native + TypeScript | 跨平台，生态丰富 |
| **移动端框架（HarmonyOS）** | ArkUI (ArkTS) + `@ohos.net.webSocket` | 原生 WebSocket 支持 |
| **移动端网络层** | WebSocket JSON 帧 | 双向实时、移动网络友好，避免 HTTP/SSE 重连问题 |
| **状态管理** | Zustand | 简单、轻量 |
| **Markdown** | react-native-markdown | 原生渲染 |
| **语法高亮** | react-syntax-highlighter | 广泛语言支持 |
| **Bridge 服务器** | Node.js + `@opencode-ai/sdk` | 内网穿透、协议桥接、多 Agent 适配 |

**架构详解：**
- **手机端**通过 WebSocket 与 Bridge 服务器双向通信（JSON 帧）
- **Bridge 服务器**使用 `@opencode-ai/sdk` 与 OpenCode 服务端交互
- Bridge 服务器的 `@opencode-ai/sdk` 内部使用 HTTP + SSE 与 OpenCode 通信
- **MVP 阶段可简化**：Bridge 服务器直连本地 `opencode serve`，手机通过 Tailscale 等隧道连接 Bridge

**对比修正：** 此前资料误认为 OpenCode TUI 使用 React/Ink，经对 `D:\code\opencode\packages\opencode\src\cli\cmd\tui\` 源码分析，实际使用 `@opentui/solid`（SolidJS 终端 UI 框架）。架构设计仍独立于该实现。

### 14.3 架构权衡

| 决策 | 权衡 | 缓解措施 |
|------|------|----------|
| **Bridge 服务器**（核心组件） | + 内网穿透<br>+ 多 Agent 协议统一<br>+ 安全隔离<br>+ JWT 认证 | **MVP 不可省略**（手机需要隧道连接）<br>可简化：Bridge 服务器直连 OpenCode，不做多 Agent 适配 |
| **双框架**（React Native + ArkUI） | + 原生鸿蒙集成<br>+ 完整 API 访问 | - 双份 UI 工作<br>- 分开代码库 | 共享 TypeScript 包处理所有业务逻辑，仅 UI 层因平台而异 |
| **WebSocket（手机→桥）** | + 双向实时<br>+ 移动网络友好<br>+ 原生支持 | - 协议需自定<br>- 无标准 SSE 的事件类型体系 | 参考 OpenClaw Gateway 协议的 JSON 帧格式 |

### 14.4 后续步骤

1. 实现 OpenCode 适配器（最高优先级）
2. 构建带流式传输的聊天界面
3. 添加工具审批系统
4. 实现文件浏览器
5. 添加会话管理

---

*文档版本：1.0*
*最后更新：2026-06-28*
