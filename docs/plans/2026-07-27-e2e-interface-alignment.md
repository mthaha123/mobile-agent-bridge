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

## P0 — 已完成（含 P1）

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

## P1 — 已完成

### P1-1: sessionId 大小写兼容性测试 ✅

**测试结果**：21 pass, 0 fail。三种大小写在 `session.get`/`messages`/`switchModel` 全部通过。

**发现**：`session.delete` 超时（v1 API 问题，非大小写导致），已记录为非阻塞限制。

---

### P1-2: 错误场景覆盖 ✅

**测试结果**：19 pass, 0 fail。

**修复**：`router.ts:message.send` 未验证 `message` 参数为空时传入 `""` 静默成功，新增 `!p.message` 前置校验。

**覆盖场景**：

| 场景 | 验证 | 预期 |
|------|------|------|
| 无效密码 | `auth.login({})` | `invalid password` |
| 密码错误 | `auth.login({password:"wrong"})` | `invalid password` |
| 未授权调用 | `health.ping` 未 auth | `unauthorized` |
| 未知方法 | `nonexistent.method` | `unknown method` |
| 不存在的目录 | `project.switch({directory:"Z:\\nonexistent"})` | `not found or not readable` |
| 缺少必需参数 | `session.get({})`, `message.send({})`, `permission.reply({})` | 返回值指出缺失字段名 |
| 重复 project.switch | 短暂窗口内两次调用 | `already switching` |

---

### P1-3: WS 重连恢复 ✅

**测试结果**：17 pass, 0 fail。

**验证项目**：

1. 连接 Bridge → auth → project.switch → session.create → project.current → 关闭
2. 重连后 `project.current` 未 auth → `unauthorized`（正确拒绝）
3. 重新 auth → `project.directory` 保留
4. `session.list` 仍有旧 session
5. `message.send` 正常工作
6. **SSE 事件恢复流动**
7. `session.switchModel` 正常

**注意**：`broadcastToAll` 发送的事件 type 为 `"notify"` 而非 `"event"`，测试 waitEvent 需适配。

---

## P2 — 已完成

### P2-1: SSE 事件类型 E2E 覆盖率 ✅

**测试结果**：10+ pass, 0 fail。单次 `message.send("hello")` 收集到 **20 种事件类型**。

**已验证事件类型**：

| 分类 | 事件类型 |
|------|---------|
| Session | `session.created` |
| 基础设施 | `plugin.added`, `catalog.updated`, `reference.updated`, `integration.updated` |
| Prompt 生命周期 | `session.next.prompt.admitted`, `session.next.prompted` |
| Step 生命周期 | `session.next.step.started`, `session.next.step.ended` |
| Reasoning | `session.next.reasoning.started` / `.delta` / `.ended` |
| Tool input | `session.next.tool.input.started` / `.delta` / `.ended` |
| Tool 执行 | `session.next.tool.called`, `session.next.tool.success` |
| Text 输出 | `session.next.text.started` / `.delta` / `.ended` |

**注意**：SDK v2 使用 `session.next.*` 命名空间事件，不再使用 `session.updated`。

---

### P2-2: v1→v2 SDK API 迁移（无需操作）✅

**结论**：当前的 `sdk().session.*` 调用实际使用的是 `Session2` 类（v2 客户端的一部分）。`sdk().v2.*` 命名空间（Session3）虽然更新，但不完整——缺少 `delete`、`update`、`todo`、`diff`、`fork`、`children`、`shell`、`command` 等方法。**代码中不存在真实的 v1 API 调用**，无需迁移。

`@opencode-ai/sdk` v1.18.5 的 API 层级：

```
sdk()  →  OpencodeClient (v2)
 ├── session.*        ← Session2 类（当前使用，功能完整）
 ├── config.*         ← Config2 类
 ├── vcs.*            ← Vcs 类
 ├── global.config.*  ← Config 类
 ├── project.*        ← Project 类
 └── v2.*             ← Session3 / 新世代 API（不完整）
```

---

## 文件清单

| 文件 | 用途 |
|------|------|
| `scripts/e2e/test-permission-flow.mjs` | 权限审批全流程 E2E (16/16) |
| `scripts/e2e/test-question-flow.mjs` | 提问审批全流程 E2E (15/15) |
| `scripts/e2e/test-tool-lifecycle.mjs` | 工具执行生命周期 E2E (11/11) |
| `scripts/e2e/test-sessionid-casing.mjs` | sessionId 大小写兼容性测试 (21/21) |
| `scripts/e2e/test-error-handling.mjs` | 错误场景覆盖测试 (19/19) |
| `scripts/e2e/test-ws-reconnect.mjs` | WS 重连恢复测试 (17/17) |
| `scripts/e2e/test-sse-coverage.mjs` | SSE 事件类型覆盖率 (10+/0) |
| `scripts/e2e/run-full-e2e.mjs` | 全链路集成 E2E (7/7) |
