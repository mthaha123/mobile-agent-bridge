# 设计：回前台秒连（Foreground Fast Reconnect）

日期：2026-08-26
状态：已批准

## 背景与问题

手机客户端切到后台再回来，顶部出现 "Connection lost — reconnecting…" 横幅，需等待恢复：

1. **正常死亡**：后台时系统掐断 socket、`onclose` 触发 → 排 3s 固定间隔重连定时器
   （`BridgeClient.reconnectInterval=3000`），回前台后仍要等定时器到点 + 握手 ≈ 3~4s。
2. **僵尸半开**：系统直接断网未挥手，`onclose` 不触发，客户端误认为连接健在，
   只能靠 30s 一次的保活 ping 连续失败 3 次（最长 ~90s）才软重连。

根因：客户端不知道"用户刚回到前台"这一事件，只能被动等定时器。

## 目标 / 非目标

**目标**
- 回到前台立即发起重连（事件驱动，0ms 触发），局域网握手 <0.5s 完成，横幅基本不出现
- 僵尸半开 socket 在回前台 5s 内被验出并立即重连（而非最长 90s）
- 断线期间错过的内容不丢失：消息补拉（已有）+ 审批请求对账（新增）
- 横幅防闪烁：短暂断连（<1.5s 即恢复）完全不显示横幅

**非目标**
- ❌ 后台常驻连接（Android 需前台服务 + 电池白名单，耗电且 iOS 不可行——用户明确排除）
- ❌ 新增 WS 协议方法（复用已有 `permission.list`，无需改 Bridge）

## 方案

### 1. BridgeClient（`apps/mobile/src/services/BridgeClient.ts`）

- `call()` 增加第三参 `options?: { timeoutMs?: number }`，支持单次请求超时覆盖
- 新增 `reconnectNow(): void`
  - 守卫：`destroyed` / 已连接 / 正在握手中（readyState === CONNECTING）→ no-op
  - 清掉挂起的 `reconnectTimer`（作废 3s 退避）→ 立即 `connect()`
  - 失败静默：`onclose` 会按常规节奏继续重试，退避机制保留
- 新增 `verifyAlive(timeoutMs = 5000): Promise<void>`
  - 仅在 `connected === true` 时探测（防并发：`verifying` 标志）
  - 发短超时 `health.ping`；失败 → 判定半开 → `stopKeepalive + close + reconnectNow`

### 2. AppProvider（`apps/mobile/src/components/AppProvider.tsx`）

- 监听 `AppState`：
  - 回前台（`active`）：`!connected` → `reconnectNow()`；`connected` → `verifyAlive()`（验尸半开）
  - 切后台（`background`）：不做任何事（省电，JS 定时器也会被冻结）
- 重连成功（`connected` 事件）后新增**审批队列对账** `reconcilePermissions()`：
  - `permission.list`（bridge 已有，透传 SDK v2 `permission.request.list`）拉权威待审批快照
  - 服务器有而本地无 → 入队（`enqueue` 自带 id/sourceCallID 去重）；补上断线期间错过的
    `permission.v2.asked`（如后台跑任务时弹出审批）
  - 本地有而服务器无（仅限快照前已存在的条目）→ 移除；补上错过的 `permission.v2.replied`
  - 对账失败静默，保持现状

### 3. MainLayout（`apps/mobile/src/components/MainLayout.tsx`）

横幅显示条件从 `!connected` 改为 `bannerVisible`：
- `disconnected` 事件 → 启动 1500ms 定时器，届时仍未恢复才显示
- `connected` 事件 → 取消定时器并立即隐藏
- 无 client（初始态）维持原行为直接显示

### 数据结构对照（permission.list → ToolApproval）

| PermissionRequest (SDK v2) | ToolApproval |
|---|---|
| `id` | `id` |
| `sessionID` | `sessionId` |
| `permission` | `tool` |
| `metadata` | `args` |
| `tool?.callID` | `sourceCallID` |

## 测试计划

- `BridgeClient.test.ts`：reconnectNow 绕过退避/守卫分支/清定时器防重复；
  call timeoutMs 生效；verifyAlive 存活路径 & 半开触发重连
- `AppProvider.test.tsx`：AppState active+断开 → reconnectNow；active+连接 → verifyAlive；
  background → 无动作；connected 后 permission.list 对账（补入队 + 清残留）
- `MainLayout.test.tsx`：横幅延迟显示/防闪烁/恢复即隐藏（假定时器驱动）

## 风险与权衡

- AppState 回前台瞬间 RN 可能尚未完全恢复网络栈——`reconnectNow` 失败会走常规
  onclose 重试兜底，不会死循环
- 对账移除逻辑只处理"快照前已存在"的本地条目，避免与实时通知竞态误删新请求
