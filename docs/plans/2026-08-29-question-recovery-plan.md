# 待回答问题（question）恢复与提醒方案

> 目标场景：手机息屏/切后台期间 agent 调用 question 工具提问 → 用户回来后**能看到并回答**，会话不再卡死。
> 现状问题：回来后会话一直转圈、输入锁死，但没有任何弹框；服务端其实在等回答，且会一直等下去。

## 1. 已确认的事实（全部实测）

| 项 | 结论 | 证据 |
|---|---|---|
| 真实事件名 | `question.v2.asked`（不是 v1 的 `question.asked`） | SSE 抓包：`{"type":"question.v2.asked","properties":{...}}` |
| payload 位置 | `properties` 内层：`{ id, sessionID, questions:[{question,header,options:[{label,description}],multiple}], tool:{messageID,callID} }` | 同上；bridge `project.ts` 用 `src.properties` 解包后透传 |
| 客户端读取 | AppProvider 读 `p.id / p.sessionID / p.questions / p.tool`，与之一致 | `AppProvider.tsx:153` |
| SSE 是否重放 | **不重放**。断线期间的事件永久丢失 | 断线实验：重连后实时通知 **0 条** |
| 未回答的后果 | 服务端 agent loop 挂起等回答 → 会话恒 busy → 手机端转圈 + 锁输入 | 实测：一个 question 挂了一整天仍在 pending；abort 会话也不会清 |
| 恢复机制（修复前） | 只恢复：消息补拉、busy 快照、permission 审批对账；**question 无恢复** | `AppProvider.tsx` connected 监听 |
| 弹框挂载点 | `QuestionDock` 只挂在 `ChatScreen.tsx:407` → 会话列表/Files/Settings 看不到 | grep 全 src |
| `QuestionSheet` | 完整 Modal 组件（312 行，含自定义输入 + multiple），**从未被渲染**（孤儿） | grep 无引用 |
| 会话隔离 | `QuestionDock` 渲染 `pending` 全部条目，不分会话（A 会话的问题显示在 B 会话页） | `QuestionDock.tsx:18` |
| `clearSession` | `questionStore.clearSession` 已定义但**从未被调用** | grep 仅定义处 |
| 系统推送 | **无**。App 无 expo-notifications 依赖、无 token 注册代码 | package.json + grep |
| opencode 侧能力 | 有 `mobile` 工具，支持注册 `ExponentPushToken[...]`（Expo 推送） | `/command` 的 mobile 模板 |

## 2. 目标

- **G1（必须）**：息屏回来后，无论停在哪个页面，都能看到并回答待回答问题 → 会话不再卡死。
- **G2（可选）**：息屏期间就被主动提醒（需新增推送能力）。

非目标：不改动服务端 question 语义、不做多端协同锁。

## 3. 分期方案

### P0 数据层恢复 —— ✅ 已完成（本轮实施并验证）

| 侧 | 改动 |
|---|---|
| Bridge | 新增 `question.list` RPC → `sdk().v2.question.request.list()`（`GET /api/question/request`），`unwrapData` 解包为裸数组 |
| 客户端 | `AppProvider.reconcileQuestions()`：服务端有本地无→补入 store；本地有服务端无→只清理"快照前已存在"的（避免与实时通知竞态）；失败静默 |
| 触发点 | ① `connected` 事件；② **`AppState` 回前台**（关键：socket 僵尸半开时不会触发 connected，必须直接对账；顺带补上 permission 的同类盲区） |

验证：Bridge `router.test.ts` 93 passed；`AppProvider.test.tsx` 64 passed（6 个新用例）；
端到端断线实验：断线→提问→重连→实时通知 0 条→`question.list` 拿回 → 回答后 pending 清零。

### P1 UI 全局可达 —— 解决"数据在但看不到"（推荐立即做）

1. **挂全局 Modal**：把孤儿组件 `QuestionSheet` 挂到 `MainLayout`（Tabs 之上），任意 Tab 都能弹出。
2. **渲染分工与互斥**（避免双弹）：
   - `QuestionDock`（内联）：只渲染 `activeSessionId` 的 pending，且仅当 `chatSubScreen === 'chat'`。
   - `GlobalQuestionSheet`（Modal）：渲染**其余** pending（非当前会话，或不在 ChatScreen）。
   - 实现：在 `questionStore` 增 `visibleSessionId: string | null`（由 ChatScreen mount/unmount 写入），两个组件各按此过滤。
3. **来源提示 + 一键跳转**：Modal 顶部显示会话名（从 `sessionStore` 取），按钮「去处理」→ `setActiveTab('chat')` + `setActiveSession(id)` + `pushChat()`。
4. **会话列表徽标**：`SessionsScreen` 对有 pending question 的会话显示「❓ 待回答」，未进会话也能发现。
5. **生命周期清理**：退出会话 / 删除会话 / 断开连接时调 `questionStore.clearSession(sid)`（目前从未调用，会残留）。
6. **测试**：
   - `AppProvider.test.tsx`：全局 Modal 与内联 Dock 的互斥规则（当前会话→Dock；其它会话→Modal）
   - 新增/补充 `QuestionSheet` 组件测试（渲染、选择、提交、跳转）
   - `SessionsScreen.test.tsx`：待回答徽标
   - 退出/删除会话后 pending 被清理

### P2 一致性与自愈 —— 让"卡住"可观测、可自救

1. **周期对账**：前台时每 30s（或会话状态变化时）轻量调 `question.list`，仅在存在 busy 会话时执行。
2. **卡住检测**：会话 busy 但无工具在跑、无 pending question 超过 N 秒 → UI 提示「可能卡住」+ 提供 abort / 重发入口。
3. **超时兜底**：pending 超过 N 分钟未被回答 → 提供「拒绝并继续」入口，避免会话永久挂起（服务端仍会一直等，只能靠 reject 解锁）。
4. **冷启动恢复**：App 冷启动后（不等 AppState 事件）也做一次 `question.list` 对账。
5. **测试**：超时兜底与卡住提示的交互用例；冷启动对账用例。

### P3 息屏主动提醒 —— 真正的"息屏就知道"（需新增推送能力）

现状：App 无推送集成。opencode 的 `mobile` 工具支持注册 `ExponentPushToken`，但 App 端没有获取/注册 token 的代码。

- **选项 A（推荐，可控）**：Bridge 自建推送
  1. App 集成 `expo-notifications`（或 `react-native-push-notification` + FCM）拿到 push token
  2. 新增 bridge RPC `push.register`（持久化 token 到 `logs/` 外的配置文件）
  3. bridge 在 SSE 收到 `question.v2.asked` 时，调 Expo Push API / FCM 发通知（标题含会话名）
  4. App 处理通知点击 → 深链打开对应会话（`setActiveSession` + `pushChat`）
- **选项 B（省事但不确定）**：复用 opencode 的 `mobile` 工具注册 token，由 opencode 发推送。
  ⚠️ 需先验证 opencode server 是否对 question 事件推送（未验证，风险高）。
- **代价**：Expo 账号/凭证或 FCM `google-services.json`；iOS 需 APNs；Android 省电策略可能延迟推送。

## 4. 文件级改动清单

| 阶段 | 文件 | 改动 |
|---|---|---|
| P0 ✅ | `servers/bridge/src/server/router.ts` | 新增 `question.list` handler |
| P0 ✅ | `apps/mobile/src/components/AppProvider.tsx` | `reconcileQuestions()` + connected/AppState 触发 |
| P0 ✅ | `servers/bridge/__tests__/router.test.ts` | mock `v2.question.request.list` + 新 RPC 用例 |
| P0 ✅ | `apps/mobile/__tests__/AppProvider.test.tsx` | 6 个对账用例 |
| P1 | `apps/mobile/src/components/MainLayout.tsx` | 挂 `<QuestionSheet />` |
| P1 | `apps/mobile/src/stores/questionStore.ts` | 增 `visibleSessionId` + setter |
| P1 | `apps/mobile/src/components/chat/QuestionDock.tsx` | 按 `visibleSessionId` 过滤 |
| P1 | `apps/mobile/src/screens/QuestionSheet.tsx` | 渲染"其余" pending + 会话来源 + 跳转按钮 |
| P1 | `apps/mobile/src/screens/ChatScreen.tsx` | mount/unmount 写入 `visibleSessionId`；退出时 `clearSession` |
| P1 | `apps/mobile/src/screens/SessionsScreen.tsx` | 待回答徽标 |
| P2 | `apps/mobile/src/components/AppProvider.tsx` | 周期对账 + 冷启动对账 |
| P2 | `apps/mobile/src/stores/chatStore.ts` / 新组件 | 卡住检测与 abort 入口 |
| P3 | `apps/mobile/package.json` + 新 service | 推送 token 获取/注册 |
| P3 | `servers/bridge/src/server/router.ts` | `push.register` RPC |
| P3 | `servers/bridge/src/state/project.ts` | question 事件触发推送 |

## 5. 验证计划

1. **单元/组件**：各阶段对应的 jest 用例（见上表）。
2. **E2E 脚本**（复用本轮断线实验，扩展断言）：
   断线 → 期间提问 → 回前台重连 → 断言 `question.list` 恢复 → 回答 → 断言 pending 清零 → 断言会话继续（不再 busy）。
3. **真机（Maestro）**：进入会话 → 触发提问 → 息屏（adb 锁屏）→ 解锁回前台 → 断言问题弹框可见 → 点选回答 → 断言会话继续生成。
4. **回归**：全量 mobile + bridge 测试；`tsc` 与基线一致。

## 6. 风险与边界

- **双弹互斥**：全局 Modal 与内联 Dock 必须严格按 `visibleSessionId` 划分，否则同一问题弹两次。
- **多会话顺序**：pending 按入队顺序（FIFO）展示，先来先答；`QuestionSheet` 当前只显示 `pending[0]`，多条时需支持翻页或列表。
- **回答路由**：reply/reject 必须带 `q.sessionId`（现有实现已带），否则会答错会话。
- **推送限制**：Android 省电/厂商通道可能延迟；iOS 需在真机（模拟器无推送）。
- **JS bundle**：改动后必须重新打 bundle（`npx react-native bundle … --bundle-output android/app/src/main/assets/index.android.bundle`）再装 APK，否则手机上不生效。

## 7. 结论：能解决吗

- **G1（回来就能处理、不再卡死）**：P0 已解决"数据恢复"，P1 解决"任意页面可见" → **P1 完成后 G1 完全达成**。
- **G2（息屏期间就被提醒）**：需要 P3（新增推送能力），属增量工作，且依赖平台凭证配置。
