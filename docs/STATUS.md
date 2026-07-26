# 开发进度

> 更新日期：2026-07-24

---

## 一、已完成

### Bridge 服务器

| 模块 | 文件 | 状态 |
|------|------|:----:|
| WS 服务器 (连接管理、JWT、broadcast) | `src/server/ws.ts` | ✅ |
| JWT 认证 (sign/verify/refresh/logout) | `src/server/auth.ts` | ✅ |
| RPC 路由 (40 handler) | `src/server/router.ts` | ✅ |
| OpenCode SDK 适配器 | `src/adapters/OpenCodeAdapter.ts` | ✅ |
| 项目状态管理 (SSE 生命周期、并发锁) | `src/state/project.ts` | ✅ |
| 文件操作 (list/read/search/info) | `src/server/fileHandler.ts` | ✅ |
| 入口 | `src/index.ts` | ✅ |

### 手机客户端

| 模块 | 文件 | 状态 |
|------|------|:----:|
| BridgeClient (WS 客户端、重连) | `src/services/BridgeClient.ts` | ✅ |
| AppProvider (全局通知、SSE 分发) | `src/components/AppProvider.tsx` | ✅ |
| ConnectScreen | `src/screens/ConnectScreen.tsx` | ✅ |
| SessionsScreen | `src/screens/SessionsScreen.tsx` | ✅ |
| ChatScreen (消息列表/发送/流式) | `src/screens/ChatScreen.tsx` | ✅ |
| SettingsScreen (连接/配置/VCS) | `src/screens/SettingsScreen.tsx` | ✅ |
| SessionInfoModal (diff/todo/rename/fork/unrevert/meta) | `src/screens/SessionInfoModal.tsx` | ✅ |
| ToolApprovalSheet | `src/screens/ToolApprovalSheet.tsx` | ✅ |
| QuestionSheet | `src/screens/QuestionSheet.tsx` | ✅ |
| SlashSheet (agent 选择/斜杠命令) | `src/screens/SlashSheet.tsx` | ✅ |
| FileBrowserScreen (浏览/查看/属性) | `src/screens/FileBrowserScreen.tsx` | ✅ |
| ToolProgressCard | `src/components/ToolProgressCard.tsx` | ✅ |
| ToolRenderer (14 种工具渲染器) | `src/components/ToolRenderer.tsx` | ✅ |
| MarkdownRenderer | `src/components/MarkdownRenderer.tsx` | ✅ |
| ReasoningCollapsible | `src/components/ReasoningCollapsible.tsx` | ✅ |

### Zustand Stores

| Store | 状态 | 说明 |
|-------|:----:|------|
| `authStore` | ✅ | token、登录状态 |
| `sessionStore` | ✅ | 会话 CRUD + revert/unrevert |
| `chatStore` | ✅ | 消息、流式增量、messageID/partID |
| `projectStore` | ✅ | 当前目录、项目信息 |
| `configStore` | ✅ | 配置/providers/agents/commands/VCS |
| `toolStore` | ✅ | 工具审批队列 |
| `toolProgressStore` | ✅ | 工具执行进度 |
| `questionStore` | ✅ | 问答队列 |
| `diffStore` | ✅ | 文件差异 |
| `todoStore` | ✅ | 待办列表 |
| `fileStore` | ✅ | 文件浏览器状态 |

### UI-Server 接口对齐（12 项全部关闭 ✅）

| RPC 方法 | 客户端 UI | 状态 |
|----------|-----------|:----:|
| `config.agents` | SlashSheet agent 选择 | ✅ |
| `config.providers` | SettingsScreen Provider 列表 | ✅ |
| `config.get` | SettingsScreen 配置展示 | ✅ |
| `command.list` | SlashSheet 斜杠命令参考 | ✅ |
| `vcs.get` | SettingsScreen VCS 状态 | ✅ |
| `session.rename` | SessionInfoModal 重命名 | ✅ |
| `session.fork` | SessionInfoModal Fork 按钮 | ✅ |
| `session.revert` | ChatScreen 消息级 Revert | ✅ |
| `session.unrevert` | SessionInfoModal Unrevert | ✅ |
| `session.get` | SessionInfoModal 元数据显示 | ✅ |
| `file.info` | FileBrowserScreen 长按属性 | ✅ |
| SSE `permission.v2.replied` | AppProvider handler | ✅ |

### 测试

| 类型 | 数量 | 状态 |
|------|:----:|:----:|
| Bridge 单元测试 | 108 | ✅ |
| Mobile 单元测试 | 559 | ✅ |
| E2E (Bridge → SDK) | ~51 场景 | ✅ |
| E2E (SSE 流式) | 2 场景 | ✅ |
| Android E2E (Maestro) | 22/24 场景 | ✅ (2 skip) |
| Mock Bridge | `scripts/e2e/mock-bridge.mjs` — 39 handler，无依赖启动 | ✅ |
| E2E Layer Runner | `scripts/e2e/run-layer.mjs` — 分层统一入口 | ✅ |

---

## 二、Bridge 服务器 TODO

> OpenCode SDK v2 有 ~105 个方法，Bridge 目前暴露 40 个 handler。
> 以下按优先级列出建议新增的 RPC 方法。

### P1 — 核心体验

| RPC 方法 | SDK 调用 | 用途 | 客户端需求 | 状态 |
|----------|----------|------|-----------|:----:|
| `model.list` | `sdk().v2.model.list()` | 获取可用模型列表 | 模型切换 UI | ✅ |
| `session.switchAgent` | `sdk().v2.session.switchAgent({ sessionID, agent })` | 切换会话 Agent | ChatScreen agent 切换 | ✅ |
| `session.switchModel` | `sdk().v2.session.switchModel({ sessionID, model })` | 切换会话模型 | ChatScreen 模型切换 | ✅ |
| `session.children` | `sdk().session.children({ sessionID })` | 获取 fork 树子会话 | 会话关系图 | ⏳ |
| `file.find` | `sdk().find.files({ pattern, dirs })` | 按文件名搜索 | 文件浏览器搜索增强 | ⏳ |
| `find.symbols` | `sdk().find.symbols({ query, dirs })` | LSP 符号搜索 | 代码导航 | ⏳ |

### P2 — 增强功能

| RPC 方法 | SDK 调用 | 用途 |
|----------|----------|------|
| `vcs.status` | `sdk().vcs.status()` | 获取未暂存文件列表 |
| `vcs.diff` | `sdk().vcs.diff({ file })` | 获取文件详细 diff |
| `vcs.apply` | `sdk().vcs.apply({ patch })` | 应用 patch |
| `permission.list` | `sdk().v2.permission.request.list()` | 列出待审批权限 |
| `permission.saved.list` | `sdk().v2.permission.saved.list()` | 列出已保存权限规则 |
| `permission.saved.remove` | `sdk().v2.permission.saved.remove({ id })` | 删除保存的权限规则 |
| `tool.list` | `sdk().tool.list()` | 列出可用工具及其 schema |
| `config.update` | `sdk().config.update({ ... })` | 更新项目级配置 |
| `global.config.update` | `sdk().global.config.update({ ... })` | 更新全局配置 |
| `project.list` | `sdk().project.list()` | 项目列表（切换用） |

### P3 — 高级/实验性

| 功能 | SDK 路径 | 备注 |
|------|----------|------|
| `session.share/unshare` | `sdk().session.share/unshare()` | 会话分享 |
| `session.summarize` | `sdk().session.summarize()` | AI 摘要 |
| `session.compact` | `sdk().v2.session.compact()` | 压缩会话历史 |
| `session.context` | `sdk().v2.session.context()` | 获取活跃上下文 |
| `session.deleteMessage` | `sdk().session.deleteMessage()` | 删除单条消息 |
| `workspace.*` | `sdk().experimental.workspace.*` | 工作区管理 |
| `mcp.*` | `sdk().mcp.*` | MCP 连接管理 |
| `pty.*` | `sdk().pty.*` | 终端管理 |
| `sync.*` / `worktree.*` | `sdk().sync.*` / `sdk().worktree.*` | 同步/工作树 |
| `integration.*` | `sdk().v2.integration.*` | 第三方集成 |
| `provider.oauth.*` | `sdk().provider.oauth.*` | OAuth 流程 |
| `find.symbols` | `sdk().find.symbols()` | LSP 符号搜索 |

---

## 三、手机客户端 TODO

### P1 — 核心体验

| 功能 | 相关 Store/RPC | 说明 | 状态 |
|------|---------------|------|:----:|
| 模型选择 UI | `model.list` → ChatScreen | 发送消息前选择模型 | ✅ |
| Agent 切换 UI | `session.switchAgent` → ChatScreen | 会话中更换 Agent | ✅ |
| 消息富文本渲染 | `chatStore` → 支持 code/markdown | 目前纯文本，需集成 MarkdownRenderer | ⏳ |
| 文件搜索增强 | `file.search` + `file.find` | 按文件名/内容/符号搜索 | ⏳ |

### P2 — 增强功能

| 功能 | 相关 Store/RPC | 说明 |
|------|---------------|------|
| 会话 fork 树可视化 | `session.children` | 查看/导航 fork 关系 |
| 权限规则管理 | `permission.saved.list/remove` | 查看/删除已保存的权限 |
| 设置页增强 | `config.update` | 配置编辑（非只读） |
| 消息操作 (复制/删除) | `session.deleteMessage` | 长按消息弹出操作菜单 |
| 断线重连状态指示 | `BridgeClient` 事件 | 显示连接状态 banner |
| 后台保活 | 原生模块 | app 切后台时维持 WS 连接 |

### P3 — 高级

| 功能 | 说明 |
|------|------|
| 会话分享 | 生成分享链接 |
| 离线缓存 (messages) | 本地 SQLite 持久化 |
| 多服务器支持 | 管理多个 Bridge 连接 |
| 主题系统 | 浅色/深色/跟随系统 |
| 语音输入 | 语音转文字发送 |
| 推送通知 (FCM/APNs) | 后台消息通知 |
| 会话导出 (JSON/Markdown) | 导出会话记录 |
| HarmonyOS 适配 | 鸿蒙原生版本 |

---

## 四、对齐约束

> 以下规则确保 Bridge（服务器）和 Mobile（客户端）开发始终对齐。

### 接口变更流程

1. **Bridge 新增 RPC 方法** → 同时在 `router.ts` 注册 handler + `__tests__/router.test.ts` 加测试
2. **Mobile 新增 UI 功能** → 确认对应 RPC 方法已在 Bridge 实现；若无，先实现 Bridge 侧
3. **参数名对齐**：客户端统一使用 `sessionId`（小写驼峰），Bridge `resolveSessionId()` 做兼容
4. **通知事件**：SSE 事件类型名透传不变，Mobile 按 SDK v2 事件名处理

### 测试对齐

| 场景 | Bridge 测试 | Mobile 测试 |
|------|:-----------:|:-----------:|
| RPC 方法注册 | `router.test.ts` | — |
| 方法参数兼容 | `router.test.ts` | — |
| Store 方法 | — | `sessionStore.test.ts` 等 |
| UI 组件 | — | `*.test.tsx` |

### 当前接口状态

- Bridge handler: **40 个** (router.ts)
- Mobile `client.call()`: **35 个** (各 store + screens)
- SSE 事件: **20+ 个** (AppProvider 全量覆盖)
- 接口对齐: ✅ **完全对齐，零缺口**

---

## 五、测试覆盖盲区

| 盲区 | 说明 | 建议 | 状态 |
|------|------|------|:----:|
| 断线重连 (Android) | 需要 Bridge 运行时 + 模拟器 | Layer 2 (Mock Bridge) | ⏳ |
| 并发多客户端 | 多 WS 连接同时操作 | 可选 | ⏳ |
| 长时间运行稳定性 | 数小时持续运行 | 可选 | ⏳ |
| 消息收发 E2E | 需要真实 OpenCode 服务端 | Layer 4 | ⏳ |
| 权限审批 E2E | 需要 OpenCode 触发工具调用 | Layer 4 | ⏳ |

## 六、自动 E2E 测试方案

参见 `docs/maestro-auto-test-plan.md`

| 组件 | 文件 | 状态 |
|------|------|:----:|
| Mock Bridge (39 handler) | `scripts/e2e/mock-bridge.mjs` | ✅ |
| Layer Runner | `scripts/e2e/run-layer.mjs` | ✅ |
| Layer 1 flows (Smoke) | `.maestro/flows/l1-smoke/` | ⏳ |
| Layer 2 flows (Mock) | `.maestro/flows/l2-bridge/` | ⏳ |
| Layer 3 flows (UI) | `.maestro/flows/l3-ui/` | ⏳ |
| Layer 4 flows (E2E) | `.maestro/flows/l4-e2e/` | ⏳ |
| GitHub Actions CI | `.github/workflows/e2e.yml` | ⏳ |

### npm scripts

| 命令 | 说明 |
|------|------|
| `npm run e2e:mock` | 启动 Mock Bridge (端口 8081) |
| `npm run e2e:l1` | 运行 Layer 1 Smoke |
| `npm run e2e:l2` | 运行 Layer 2 (含 Mock Bridge) |
| `npm run e2e:all` | L1 + L2 + L3 (含 Mock Bridge) |
