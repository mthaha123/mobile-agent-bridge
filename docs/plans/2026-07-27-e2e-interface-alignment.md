# E2E 接口对齐加固计划

## 背景

经过全链路 E2E 排查，发现以下接口对齐缺陷：

| # | 缺陷 | 严重程度 | 影响 |
|---|------|---------|------|
| 1 | `resolveModel` 将完整字符串当 `providerID` 传给 SDK | 🔴 阻塞 | 模型不可用 |
| 2 | V2Event 用 `data` 字段而非 `properties` | 🔴 阻塞 | SSE payload 错位，移动端收不到文本流 |
| 3 | `question.reply` `as string[][]` 强制转换错误 | 🔴 关键 | 多问题场景必定失败 |
| 4 | `permission.v2.replied` 读 `id` 而非 `requestID` | 🔴 关键 | 权限弹窗不会关闭 |
| 5 | `sessionId`/`sessionID` 大小写未经验证 | 🟠 高 | 移动端全线丢失 sessionId |
| 6 | SSE 事件类型 E2E 覆盖率极低（5/20+） | 🟠 高 | 新增事件类型无防护网 |
| 7 | WS 重连后 SSE 订阅丢失 | 🟠 高 | 流式事件静默丢失 |
| 8 | v1 vs v2 SDK API 混用 | 🟡 中 | SDK 弃用 v1 后断裂 |

缺陷 1、2 已修复。本计划针对剩余缺陷，通过新增 E2E 用例 + 修复代码的方式逐项加固。

---

## P0 — 必须做

### P0-1: 权限审批全流程

**目标**：覆盖 permission.v2.asked → permission.reply → permission.v2.replied → permission.saved.list/remove 全链路。

**新增文件**：`scripts/e2e/test-permission-flow.mjs`

**用例**：

1. 发送 `permission.reply` RPC，验证各种 reply 值：
   - `reply: "once"` — 单次允许
   - `reply: "always"` — 永久允许（验证 saved.list 可查到）
   - `reply: "reject"` — 拒绝
   - `approved: true` — 回退路径
   - `approved: false` — 回退路径
2. 验证 `permission.saved.list` 在 `always` 后反映已保存规则
3. 验证 `permission.saved.remove` 有效

**注意**：因真实模型不一定触发权限请求，可 Mock SSE 事件或使用空 session 调用（SDK 直接验证参数转发）。

**修复点**：`permission.v2.replied` handler 中 `payload.id` vs `payload.requestID` 对齐。

---

### P0-2: 提问审批全流程

**目标**：覆盖 question.v2.asked → question.reply → question.reject 全链路。

**新增文件**：`scripts/e2e/test-question-flow.mjs`

**用例**：

1. 发送 `question.reply`，验证 `questionV2Reply` 结构：
   - `answer: "yes"`（字符串格式）
   - `answers: [["opt1"], ["opt2"]]`（嵌套数组格式）
2. 发送 `question.reject`，验证 SDK 正确接收到拒绝信号

**修复点**：`router.ts:269` 的 `as string[][]` 强制转换 — 改用 `ensureNestedArray()` 安全包裹。

---

### P0-3: 工具执行生命周期

**目标**：验证 tool.called → tool.progress → tool.success/failed 事件流完整。

**新增文件**：`scripts/e2e/test-tool-lifecycle.mjs`

**用例**：

1. 发消息让模型执行工具（读文件、搜索等）
2. 收集所有 `session.next.tool.*` 事件
3. 验证每个 tool 的完整生命周期：
   - 每个 `tool.called` 最终对应 `tool.success` 或 `tool.failed`
   - 所有事件的 `callID` 一致
   - `payload.sessionID`（大写 D）存在
4. 计数 `tool.success` 和 `tool.failed`，打印摘要

---

## P1 — 建议做

### P1-1: sessionId 大小写兼容性测试

**目标**：验证 RPC 入参三种大小写形式均被正确解析。

**新增文件**：`scripts/e2e/test-sessionid-casing.mjs`

**用例**：

对以下 handler 分别用 `sessionId` / `sessionID` / `session_id` 测试：

- `session.get`
- `session.messages`
- `session.delete`
- `session.switchModel`
- `permission.reply`
- `question.reply`

同时验证所有通知事件的 payload 包含 `sessionID`（大写 D）字段。

---

### P1-2: 错误场景覆盖

**目标**：验证所有错误场景返回标准的 `ok: false` + 错误消息。

**新增文件**：`scripts/e2e/test-error-handling.mjs`

**用例**：

| 场景 | 预期 |
|------|------|
| 无效密码 | `auth.login` 返回 `ok: false` + 错误消息 |
| 不存在的目录 | `project.switch` 返回错误 |
| 未知方法 | 返回 `unknown method` 错误 |
| 缺少必需参数 | 返回带有字段名的错误消息 |
| 未授权调用 | 非 auth 方法返回 `unauthorized` |
| 重复 project.switch | 第二次被拒绝（`already switching`） |

---

### P1-3: WS 重连恢复

**目标**：验证 Bridge WS 重连后，SSE 事件流恢复。

**新增文件**：`scripts/e2e/test-reconnect.mjs`

**用例**：

1. 连接 Bridge，发送 `health.ping` 确认正常
2. 关闭 WS 连接
3. 重新连接
4. 调用 `auth.login` 重新认证
5. 发消息 → 验证 SSE 事件恢复流动
6. 如果 SSE 无法恢复，记录为已知限制

---

## 开发顺序

```
P0-1 (权限) → P0-2 (提问) → P0-3 (工具) → P1-1 (sessionId) → P1-2 (错误) → P1-3 (重连)
```

每个步骤：
1. 先写 E2E 测试脚本（验证当前行为）
2. 发现接口不对齐时修复代码
3. 跑通测试
4. 提交

---

## 文件清单

| 文件 | 用途 |
|------|------|
| `scripts/e2e/test-permission-flow.mjs` | 权限审批全流程 E2E |
| `scripts/e2e/test-question-flow.mjs` | 提问审批全流程 E2E |
| `scripts/e2e/test-tool-lifecycle.mjs` | 工具执行生命周期 E2E |
| `scripts/e2e/test-sessionid-casing.mjs` | sessionId 大小写兼容性测试 |
| `scripts/e2e/test-error-handling.mjs` | 错误场景覆盖测试 |
| `scripts/e2e/test-reconnect.mjs` | WS 重连恢复测试 |
