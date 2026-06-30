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
| `session.create` | `client.session.create({ title?, agent?, model?, parentID?, permission?, workspaceID? })` |
| `session.list` | `client.session.list({ scope?, path?, roots?, start?, search?, limit? })` |
| `session.get` | `client.session.get({ sessionID })` |
| `session.status` | `client.session.status({})` |
| `session.delete` | `client.session.delete({ sessionID })` |
| `session.rename` | `client.session.update({ sessionID, title })` |
| `session.messages` | `client.session.messages({ sessionID, limit?, before? })` |
| `session.diff` | `client.session.diff({ sessionID, messageID? })` |
| `session.abort` | `client.session.abort({ sessionID })` |
| `session.revert` | `client.session.revert({ sessionID, messageID? })` |
| `session.unrevert` | `client.session.unrevert({ sessionID })` |
| `session.todo` | `client.session.todo({ sessionID })` |
| `session.fork` | `client.session.fork({ sessionID, messageID? })` |
| `message.send` | `client.session.prompt({ sessionID, parts })` |
| `message.shell` | `client.session.shell({ sessionID, command, agent?, model? })` |
| `message.command` | `client.session.command({ sessionID, command, arguments?, agent? })` |
| `permission.reply` | `client.permission.reply({ requestID, reply?, message? })` |
| `question.reply` | `client.question.reply({ requestID, answers? })` |
| `question.reject` | `client.question.reject({ requestID })` |
| `config.get` | `client.config.get({})` |
| `config.providers` | `client.config.providers({})` |
| `config.agents` | `client.app.agents({})` |
| `provider.list` | `client.provider.list({})` |
| `vcs.get` | `client.vcs.get({})` |
| `command.list` | `client.command.list({})` |
| `project.current` | `client.project.current({})` |
| `project.list` | `client.project.list({})` |

所有 SDK 方法均接受 `directory?` 和 `workspace?` 参数，但 **Bridge 通过创建 `OpencodeClient({ directory })` 自动注入**，手机端不需要传递这些参数。`workspace?` 为实验性功能暂不使用。

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

| 手机 WS 方法 | 参数 | SDK v2 | Phase |
|-------------|------|--------|-------|
| `session.create` | `{ title?, agent?, model?, parentID?, permission?, workspaceID? }` | `session.create(...)` | 1 |
| `session.list` | `{ scope?, path?, roots?, start?, search?, limit? }` | `session.list(...)` | 1 |
| `session.get` | `{ sessionID }` | `session.get(...)` | 1 |
| `session.status` | `{}` | `session.status(...)` | 1 |
| `session.delete` | `{ sessionID }` | `session.delete(...)` | 1 |
| `session.rename` | `{ sessionID, title }` | `session.update(...)` | 1 |
| `session.messages` | `{ sessionID, limit?, before? }` | `session.messages(...)` | 1 |
| `session.fork` | `{ sessionID, messageID? }` | `session.fork(...)` | 3 |

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

| 手机 WS 方法 | 参数 | SDK v2 | Phase |
|-------------|------|--------|-------|
| `message.send` | `{ sessionID, parts }` | `session.prompt(...)` | 1 |
| `message.shell` | `{ sessionID, command, agent?, model? }` | `session.shell(...)` | 2 |
| `message.command` | `{ sessionID, command, arguments?, agent? }` | `session.command(...)` | 2 |
| `message.abort` | `{ sessionID }` | `session.abort(...)` | 1 |

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

| 手机 WS 方法 | 参数 | SDK v2 | Phase |
|-------------|------|--------|-------|
| `permission.reply` | `{ requestID, reply?, message? }` | `permission.reply(...)` | 1 |

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

| 手机 WS 方法 | 参数 | SDK v2 | Phase |
|-------------|------|--------|-------|
| `question.reply` | `{ requestID, answers? }` | `question.reply(...)` | 2 |
| `question.reject` | `{ requestID }` | `question.reject(...)` | 2 |

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

### 2.7 配置与项目上下文

配置查询和项目目录管理。`directory` 由 Bridge 自动管理，手机端不感知。

#### 2.7.1 静态配置（启动时一次性加载）

**接口（全代理）：**

| 手机 WS 方法 | 参数 | SDK v2 | Phase |
|-------------|------|--------|-------|
| `config.get` | `{}` | `config.get(...)` | 1 |
| `config.providers` | `{}` | `config.providers(...)` | 1 |
| `config.agents` | `{}` | `app.agents(...)` | 1 |
| `provider.list` | `{}` | `provider.list(...)` | 1 |
| `vcs.get` | `{}` | `vcs.get(...)` | 1 |
| `command.list` | `{}` | `command.list(...)` | 1 |

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
    const events = await sdk.global.event({ signal, sseMaxRetryAttempts: 0 })
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
| `project.switch` | `{ directory }` | Bridge 重建 client + SSE（非 SDK 方法） | 2 |
| `project.current` | `{}` | `project.current(...)` | 2 |
| `project.list` | `{}` | `project.list(...)` | 3 |

**`project.switch` 实现伪码：**

```
1. 校验 directory 存在、可读
2. if isSwitching → 返回 error "already switching"
3. isSwitching = true
4. 清理旧状态：
   a. sseAbort?.abort()
   b. sdk = null, sseAbort = null, sseLoop = null
5. 创建新 client：
   sdk = createOpencodeClient({ baseUrl, directory })
6. 建立新 SSE：
   sseAbort = new AbortController()
   sseLoop = startSSE(sdk, sseAbort.signal)
7. 读取项目元信息（package.json / Cargo.toml）
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
| **切换中收到请求** | 返回 `{ error: "switching directory" }`，手机端自动重试 |
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

**接口（全代理）：**

| 手机 WS 方法 | 参数 | SDK v2 | Phase |
|-------------|------|--------|-------|
| `session.diff` | `{ sessionID, messageID? }` | `session.diff(...)` | 2 |
| `session.revert` | `{ sessionID, messageID? }` | `session.revert(...)` | 2 |
| `session.unrevert` | `{ sessionID }` | `session.unrevert(...)` | 2 |
| `session.todo` | `{ sessionID }` | `session.todo(...)` | 2 |

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
| `project` | 当前工作目录、项目信息、切换状态 |
| `sessions` | 会话列表、当前会话 ID |
| `messages` | 消息历史、流式增量 |
| `ui` | 导航、主题、字体 |

---

## 4. 总结

**核心架构：** 手机 (WS) → Bridge (SDK) → Agent，Bridge 同时承担协议转换和直接服务（认证、文件）的职责。

**接口覆盖：** 核心交互（会话/消息/审批/问答）全部对齐 OpenCode TUI，覆盖率 100%。文件浏览器是手机端独有增强功能。

**项目切换（§2.7.2）：** Bridge 持有唯一活跃 SDK client 和 SSE stream。切换 = 销毁旧 client + abort 旧 SSE → 创建新 client + 订阅新 SSE。切换期间请求返回错误、手机端重试。

**代码参考：** 适配器实现见 `docs/code-reference/bridge-adapters.md`，手机客户端见 `docs/code-reference/bridge-client.md`。

---

*文档版本：1.2*
*最后更新：2026-06-28*
