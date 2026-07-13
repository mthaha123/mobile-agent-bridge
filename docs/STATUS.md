# 开发进度

## 已完成

### Bridge 服务器 (Phase 1 ✅)

| 模块 | 文件 | 状态 | 说明 |
|------|------|:----:|------|
| WS 服务器 | `src/server/ws.ts` | ✅ | 连接管理、JWT 验证、broadcastToAll |
| JWT 认证 | `src/server/auth.ts` | ✅ | sign/verify/refresh/logout |
| RPC 路由 | `src/server/router.ts` | ✅ | 30+ 方法注册、参数翻译、SSE→WS 透传 |
| OpenCode 适配器 | `src/adapters/OpenCodeAdapter.ts` | ✅ | SDK client 生命周期、自定义 Node.js fetch |
| 项目状态管理 | `src/state/project.ts` | ✅ | project.switch/current、SSE 生命周期、并发锁 |
| 入口 | `src/index.ts` | ✅ | 服务器启动 |

**Bridge 已实现的 RPC 方法：**

| 方法 | 状态 | 说明 |
|------|:----:|------|
| `auth.login/refresh/logout` | ✅ | 直接实现 |
| `health.ping` | ✅ | 直接实现 |
| `project.switch/current` | ✅ | 直接实现 |
| `session.create/list/get/delete/update/status/messages` | ✅ | SDK 代理 |
| `session.diff/todo/fork/revert/unrevert` | ✅ | SDK 代理 (顶层) |
| `message.send/shell/command/abort` | ✅ | SDK 代理 |
| `permission.reply` | ✅ | SDK 代理 |
| `question.reply/reject` | ✅ | SDK 代理 |
| `config.get/providers/agents` | ✅ | SDK 代理 |
| `provider.list/command.list/vcs.get` | ✅ | SDK 代理 |
| SSE 事件透传 | ✅ | session.next.text.delta, permission.v2.asked 等 20+ 事件 |

### 手机客户端 (Phase 1 ✅)

| 模块 | 文件 | 状态 | 说明 |
|------|------|:----:|------|
| BridgeClient | `src/services/BridgeClient.ts` | ✅ | WS 客户端、call/event、自动重连 |
| AppProvider | `src/components/AppProvider.tsx` | ✅ | 全局通知处理、SSE 事件分发 |
| ConnectScreen | `src/screens/ConnectScreen.tsx` | ✅ | URL + 密码输入、登录 |
| SessionsScreen | `src/screens/SessionsScreen.tsx` | ✅ | 会话列表、创建、切换 |
| ChatScreen | `src/screens/ChatScreen.tsx` | ✅ | 消息列表、流式显示、发送 |
| ToolApprovalSheet | `src/screens/ToolApprovalSheet.tsx` | ✅ | 工具审批弹窗 |
| QuestionSheet | `src/screens/QuestionSheet.tsx` | ✅ | 问答向导 |
| SessionInfoModal | `src/screens/SessionInfoModal.tsx` | ✅ | 会话详情 |
| ToolProgressCard | `src/components/ToolProgressCard.tsx` | ✅ | 工具进度卡片 |

**Zustand Stores：**

| Store | 状态 | 说明 |
|-------|:----:|------|
| `authStore` | ✅ | token、登录状态 |
| `sessionStore` | ✅ | 会话列表、当前会话 |
| `chatStore` | ✅ | 消息、流式增量 |
| `projectStore` | ✅ | 当前目录、项目信息 |
| `configStore` | ✅ | 配置、providers、agents |
| `toolStore` | ✅ | 工具审批队列 |
| `toolProgressStore` | ✅ | 工具执行进度 |
| `questionStore` | ✅ | 问答队列 |
| `diffStore` | ✅ | 文件差异 |
| `todoStore` | ✅ | 待办列表 |

### 测试

| 类型 | 文件 | 数量 | 状态 |
|------|------|:----:|:----:|
| Bridge 单元测试 | `servers/bridge/__tests__/*.test.ts` | 71 | ✅ 全通过 |
| Mobile 单元测试 | `apps/mobile/__tests__/*.test.*` | 183 | ✅ 全通过 |
| E2E (Bridge) | `servers/bridge/scripts/e2e.mjs` | ~51 场景 | ✅ |
| E2E (SSE) | `servers/bridge/scripts/e2e-sse.mjs` | 2 场景 | ✅ |
| E2E (Android) | `scripts/android-test.mjs` | 24 场景 | ✅ 19/22 通过, 3 跳过 |

### Android

| 模块 | 状态 | 说明 |
|------|:----:|------|
| APK 构建 | ✅ | release APK 45.8 MB |
| SoLoader 修复 | ✅ | MainApplication.kt |
| Hermes bundle | ✅ | index.android.bundle 路径 |
| AndroidManifest | ✅ | usesCleartextTraffic |

### 共享包

| 模块 | 文件 | 状态 |
|------|------|:----:|
| 协议类型 | `packages/shared/src/protocol.ts` | ✅ |

---

## 未完成

### Phase 2 — 增强功能

| 功能 | Bridge | 客户端 | 优先级 |
|------|:------:|:------:|:------:|
| 文件浏览器 (file.list/read/search) | ❌ | ❌ | P1 |
| 文件查看器 (语法高亮) | — | ❌ | P1 |
| 14 种工具专用渲染器 | — | ❌ | P1 |
| Shell 模式 (! 开头) | ✅ | ❌ | P1 |
| 斜杠命令 (/model, /agent) | ✅ | ❌ | P1 |
| Markdown 渲染 | — | ❌ | P1 |
| Question 多步向导 | ✅ | ✅ | P1 |
| 项目目录切换 UI | ✅ | ❌ | P1 |
| 思考/推理折叠 | — | ❌ | P2 |

### Phase 3 — 生产就绪

| 功能 | 状态 | 优先级 |
|------|:----:|:------:|
| Hermes 适配器 | ❌ | P2 |
| OpenClaw 适配器 | ❌ | P2 |
| Agent 类型选择 UI | ❌ | P2 |
| 离线缓存 | ❌ | P2 |
| 推送通知 (APNs/FCM) | ❌ | P2 |
| 后台保活 | ❌ | P2 |
| 语音输入 | ❌ | P3 |
| 多服务器支持 | ❌ | P3 |
| 主题系统 | ❌ | P3 |
| 会话导出 | ❌ | P3 |
| HarmonyOS ArkUI | ❌ | P3 |

---

## 测试覆盖盲区

| 盲区 | 说明 | 建议 |
|------|------|------|
| 聊天消息收发 (E2E) | 需要 OpenCode 运行 | 已在 e2e-sse.mjs 覆盖 |
| 权限审批 (E2E) | 需要 OpenCode 触发工具调用 | 人工验证 |
| 文件浏览器 | Phase 2 功能 | 开发后补充 |
| Markdown 渲染 | Phase 2 功能 | 开发后补充 |
| 断线重连 (Android) | 需要 Bridge 运行时测试 | 已在 Layer 4 标记 |
| 并发多客户端 | 未覆盖 | 可选 |
| 长时间运行稳定性 | 未覆盖 | 可选 |
