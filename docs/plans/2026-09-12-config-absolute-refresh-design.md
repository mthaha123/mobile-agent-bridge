# 配置绝对到期定时刷新 — 设计文档

## 背景

客户端当前只在三个时机拉取 OpenCode 配置（`config.agents` / `command.list` / `model.list`）：

1. `projectStore.switchProject` 切换项目成功后；
2. `AppProvider` 的 WS `connected`（首连/重连）事件；
3. `ModelPickerModal` 每次打开时。

除此之外配置会长时间停留在客户端缓存中。需要明确一个关键事实：**opencode serve 对 agent / command 等配置是启动时一次性加载、之后不再重载**；因此所谓"最新配置"的权威来源就是 serve 当前加载的那份（它只在 serve 重启、或切到另一个 serve 实例时才变化）。本方案只负责让客户端与 serve 当前值对齐，不涉及磁盘热重载。

本次目标是：**App 前台运行时，每约 5 分钟自动向 opencode serve 重新拉取一次配置**，让列表保鲜。不追求"每次交互即时刷新"。

### 需求口径（已与需求方确认）

| 项 | 结论 |
|---|---|
| 触发方式 | 客户端低频定时刷新（**绝对到期时间**，非固定周期盲跑） |
| 刷新内容 | `config.agents` + `command.list` + `model.list` |
| 取数路径 | 客户端 → Bridge（透传）→ **opencode serve**（现有 handler） |
| 是否 dispose 实例 | **否**（方案 A）。serve 的 agent/command 本就是启动时加载、之后不重载，向 serve 取值即权威，无需 dispose / 读磁盘 |
| Bridge 改动 | 无（复用现有 `config.agents` / `command.list` / `model.list`） |
| 即时触发点 | 不做（切换 agent、打开 cmd 面板不特殊刷新） |

## 方案对比

| 方案 | 做法 | 结论 |
|---|---|---|
| **A（采用）客户端绝对到期定时器** | App 前台按 `lastRefreshedAt + 5min` 绝对时间点定时重拉；回前台超期立即刷 | 改动最小、bridge 零改动、无副作用 |
| B 客户端固定 `setInterval` 盲跑 | 每 5min 无条件请求 | 漂移 + 后台冻结后回来可能空等；不如 A |
| C Bridge 端定时 + dispose + 广播 | 服务端单定时器，dispose 实例后广播 | 能读磁盘最新，但每 5min 重置实例，复杂度过高 |
| D 每次交互即时刷新 | 切 agent / 开 cmd 面板各刷新一次 | 需求方否决（过度复杂、dispose 有副作用） |

## 核心模型

`configStore.lastRefreshedAt` 是**唯一事实来源**：任意一次成功刷新都会更新它（定时器、`connected`、切项目、模型选择器皆然）。定时器永远瞄准 `lastRefreshedAt + TTL` 这个**绝对到期时间**，而非"上次触发时间 + 周期"。

```
TTL = 5 * 60 * 1000            // 到期阈值
OFFLINE_RETRY = 30 * 1000      // 离线短重试

lastRefreshedAt = 0            // 0 表示"尚未刷新过"（冷启动）
```

## 数据流

```
App 前台
  └─ armConfigRefresh(client): setTimeout(due = lastRefreshedAt + TTL)
       └─ 到期触发
            ├─ 未连接 → 30s 后重排（避免 0-delay 自旋）
            └─ 已连接且 `now - lastRefreshedAt >= TTL`
                 └─ configStore.refreshAll(client.call)
                      ├─ config.agents  ┐
                      ├─ command.list   ├─ Promise.allSettled（成功覆盖、失败保留旧值）
                      └─ model.list     ┘
                      └─ 成功 → lastRefreshedAt = Date.now()
                           └─ 订阅回调 → 重排下一次绝对到期点

App 回前台（AppState: active）
  └─ 若 now - lastRefreshedAt >= TTL → 立即 refreshAll()   // 绝对判断，超期即刷

WS connected（首连/重连，已有逻辑）
  └─ 拉取配置 → lastRefreshedAt 更新 → 自动重排
```

## 组件改动

### `apps/mobile/src/stores/configStore.ts`

新增状态与 action：

```ts
export const CONFIG_REFRESH_TTL_MS = 5 * 60 * 1000

interface ConfigState {
  // ...existing
  lastRefreshedAt: number
  refreshing: boolean

  /** 并发重拉 agents/commands/models；成功才覆盖，失败保留旧值 */
  refreshAll: (clientCall: ClientCall, opts?: { force?: boolean }) => Promise<void>
  /** 距下一次到期还有多少 ms（未刷新过 → 返回 TTL） */
  msUntilRefreshDue: () => number
}
```

- TTL 去抖：`!force && lastRefreshedAt > 0 && now - lastRefreshedAt < TTL` → 直接返回，避免与 `ModelPickerModal`、`connected` 等已有刷新重复打。
- `refreshing` 标记：并发调用直接返回，避免重入。
- `refreshAll` 用 `Promise.allSettled([fetchAgents, fetchCommands, fetchModels])`，单点失败不影响其余；任一成功即更新 `lastRefreshedAt`，全部失败则保留旧值 + `error`（不抛）。
- 各 `fetchX` 成功时同步写 `lastRefreshedAt`，使"任何路径的刷新"都能重排定时器。

### `apps/mobile/src/components/AppProvider.tsx`

把现有 25min `refreshToken` 的 `setInterval` 旁边新增**绝对到期调度器**：

```ts
const CONFIG_REFRESH_TTL_MS = 5 * 60 * 1000
const CONFIG_OFFLINE_RETRY_MS = 30 * 1000
const configRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const configRefreshSubRef = useRef<{ unsubscribe: () => void } | null>(null)

function armConfigRefresh(client: BridgeClient) {
  if (configRefreshTimerRef.current) clearTimeout(configRefreshTimerRef.current)

  const { lastRefreshedAt } = useConfigStore.getState()
  // 从未刷新过 → 交给 connected 首刷，不空转
  const due = lastRefreshedAt > 0
    ? lastRefreshedAt + CONFIG_REFRESH_TTL_MS
    : Date.now() + CONFIG_REFRESH_TTL_MS
  const delay = Math.max(0, due - Date.now())

  configRefreshTimerRef.current = setTimeout(async () => {
    if (!client.connected) {
      configRefreshTimerRef.current =
        setTimeout(() => armConfigRefresh(client), CONFIG_OFFLINE_RETRY_MS)
      return
    }
    const s = useConfigStore.getState()
    if (!s.refreshing && Date.now() - s.lastRefreshedAt >= CONFIG_REFRESH_TTL_MS) {
      await s.refreshAll(client.call.bind(client)).catch(() => {})
    }
    armConfigRefresh(client) // 按新的 lastRefreshedAt 续期
  }, delay)
}
```

- `setupClient` 中：
  - 调用 `armConfigRefresh(client)` 启动调度；
  - 订阅 `lastRefreshedAt` 变化，任何刷新成功后重排下一次到期点：
    ```ts
    configRefreshSubRef.current = useConfigStore.subscribe((s, prev) => {
      if (s.lastRefreshedAt !== prev.lastRefreshedAt) armConfigRefresh(client)
    })
    ```
- `AppState → active` 回调中追加绝对判断（超期立即刷）：
  ```ts
  const s = useConfigStore.getState()
  if (client.connected && Date.now() - s.lastRefreshedAt >= CONFIG_REFRESH_TTL_MS) {
    s.refreshAll(client.call.bind(client)).catch(() => {})
  }
  ```
- `teardownClient`：`clearTimeout(configRefreshTimerRef.current)` + `configRefreshSubRef.current?.unsubscribe()`。

## 边界处理

| 场景 | 处理 |
|---|---|
| 从未刷新（冷启动，`lastRefreshedAt=0`） | 定时器排到 `now + TTL`，等 `connected` 首刷；随后进入 5min 锚定节奏 |
| WS 未连接 | 到期后 30s 短重试，不做 0-delay 自旋；`connected` 首刷后自动重排 |
| App 切后台/息屏 | RN 冻结 JS 定时器，自然停跑；回前台做绝对判断，超期立即刷 |
| 后台跨过多个周期 | 回前台只补刷一次（绝对判断），不补历史周期 |
| 与大刷新并发（切项目/模型选择器） | `refreshing` 重入保护 + TTL 去抖，最多一次请求 |
| 单个 list 失败 | `allSettled` 保留该 key 旧值，写 `error`，不抛、不闪空 |
| 登出 / 换 client | `teardownClient` 清理定时器与订阅 |
| 不修改任何 WS 协议 | 复用现有 `config.agents` / `command.list` / `model.list`，无新增接口 |

## 明确不做（YAGNI）

- 不在 Bridge 增加 `config.refresh`、`config.changed` 广播或 `instance.dispose`。
- 不在 `session.switchAgent`、SlashSheet 打开等交互点做即时刷新。
- 不做配置持久化（`lastRefreshedAt` 仅内存态；冷启动由 `connected` 首刷兜底）。

## 测试策略

### `apps/mobile/__tests__/configStore.test.ts`

- `refreshAll` 并发调用 `config.agents` / `command.list` / `model.list` 并写入 store。
- 部分失败：失败 key 保留旧值，未失败 key 更新，`error` 被设置，函数不抛。
- TTL 去抖：`lastRefreshedAt` 在 TTL 内 → 不重复请求；`{ force: true }` → 强制请求。
- `refreshing` 重入：并发调用只发一次请求。
- `msUntilRefreshDue`：未刷新过返回 TTL；已刷新过返回 `lastRefreshedAt + TTL - now`（≥0）。

### `apps/mobile/__tests__/AppProvider.test.tsx`

- fake timers 前进 `TTL` → 断言配置 RPC 被调用一次。
- 未到 `TTL` → 不调用。
- 模拟回前台（`AppState` `active`）且已超期 → 立即调用；未超期 → 不调用。
- 离线（`connected=false`）到期 → 不调用，短重试；随后 `connected` 正常刷新。
- 换 client / 登出 → 定时器与订阅被清理，不再触发。

### Bridge

无改动，无新增用例。

## 文件清单

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/stores/configStore.ts` | 新增 `lastRefreshedAt` / `refreshing` / `refreshAll` / `msUntilRefreshDue`；`fetchX` 成功写 `lastRefreshedAt` |
| `apps/mobile/src/components/AppProvider.tsx` | 绝对到期调度器（`armConfigRefresh`）+ `lastRefreshedAt` 订阅重排 + 回前台绝对判断 + teardown 清理 |
| `apps/mobile/__tests__/configStore.test.ts` | 新增 `refreshAll` / TTL / 去抖 / `msUntilRefreshDue` 用例 |
| `apps/mobile/__tests__/AppProvider.test.tsx` | 新增绝对到期 / 回前台 / 离线 / 清理用例 |

## 决策记录

1. **取数路径确认**：refresh 最终打到 opencode serve（经 Bridge 现有 handler 透传），不是本地数据。
2. **不做 dispose（方案 A）**：opencode serve 仅在**启动时**加载 agent / command（之后不再重载），所以 serve 当前值就是权威值；客户端定时对齐 serve 即可，**无需 dispose 实例、也无需读磁盘**。serve 重启或切换 serve 实例后，下一轮刷新会自动拿到新配置。
3. **绝对到期而非固定周期**：以 `lastRefreshedAt + TTL` 为到期点，回前台做绝对判断，保证后台冻结后回来"超期即刷"。
4. **不新增任何 WS 接口**：因此不触发 AGENTS.md 的接口对齐额外要求。
