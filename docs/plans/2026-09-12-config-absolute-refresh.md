# 配置绝对到期定时刷新 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** App 前台运行时，以 `lastRefreshedAt + 5min` 为绝对到期点自动重拉 agents/commands/models，回前台超期立即刷新。

**Architecture:** 纯客户端改动。`configStore` 增加 `lastRefreshedAt` 作为唯一事实来源与 `refreshAll` 入口；`AppProvider` 用自续期 `setTimeout` 瞄准绝对到期点，并订阅 `lastRefreshedAt` 变化重排；回前台 `AppState.active` 做绝对判断。Bridge 与 WS 协议零改动，取数仍经现有 `config.agents` / `command.list` / `model.list` 透传到 opencode serve。

**Tech Stack:** React Native 0.76、zustand 4、TypeScript、Jest + react-test-renderer。

**设计文档:** `docs/plans/2026-09-12-config-absolute-refresh-design.md`

**关键前提:** 不做 `instance.dispose`（方案 A）；接受 serve 实例缓存值。不新增 WS 接口，故无需接口对齐额外用例。

---

### Task 1: configStore 绝对到期刷新原语

**Files:**
- Modify: `apps/mobile/src/stores/configStore.ts`
- Test: `apps/mobile/__tests__/configStore.test.ts`

**Step 1: 写失败测试**

在 `apps/mobile/__tests__/configStore.test.ts`：

1）把 import 与 reset 改为（含新字段与新导出）：

```ts
import { useConfigStore, CONFIG_REFRESH_TTL_MS } from '../src/stores/configStore'

function resetConfigStore() {
  useConfigStore.setState({
    agents: [],
    commands: [],
    models: [],
    loading: false,
    error: null,
    lastRefreshedAt: 0,
    refreshing: false,
  })
}
```

2）在文件末尾追加：

```ts
// ---------------------------------------------------------------------------
// refreshAll / msUntilRefreshDue
// ---------------------------------------------------------------------------

describe('refreshAll', () => {
  it('并发调用三个配置接口并写入结果，更新 lastRefreshedAt', async () => {
    const clientCall = jest.fn(async (method: string) => {
      if (method === 'config.agents') return [{ id: 'build' }]
      if (method === 'command.list') return [{ command: 'init' }]
      if (method === 'model.list') return [{ id: 'm1' }]
      return []
    })

    await useConfigStore.getState().refreshAll(clientCall)

    expect(clientCall).toHaveBeenCalledWith('config.agents')
    expect(clientCall).toHaveBeenCalledWith('command.list')
    expect(clientCall).toHaveBeenCalledWith('model.list')
    expect(useConfigStore.getState().agents).toEqual([{ id: 'build' }])
    expect(useConfigStore.getState().commands).toEqual([{ command: 'init' }])
    expect(useConfigStore.getState().models).toEqual([{ id: 'm1' }])
    expect(useConfigStore.getState().lastRefreshedAt).toBeGreaterThan(0)
  })

  it('TTL 内重复调用不请求，force 强制请求', async () => {
    const clientCall = jest.fn().mockResolvedValue([])
    useConfigStore.setState({ lastRefreshedAt: Date.now() })

    await useConfigStore.getState().refreshAll(clientCall)
    expect(clientCall).not.toHaveBeenCalled()

    await useConfigStore.getState().refreshAll(clientCall, { force: true })
    expect(clientCall).toHaveBeenCalledTimes(3)
  })

  it('部分失败保留旧值，其余更新，error 记录失败信息', async () => {
    useConfigStore.setState({ models: [{ id: 'old' }] })
    const clientCall = jest.fn(async (method: string) => {
      if (method === 'model.list') throw new Error('models down')
      if (method === 'config.agents') return [{ id: 'build' }]
      return []
    })

    await useConfigStore.getState().refreshAll(clientCall, { force: true })

    expect(useConfigStore.getState().models).toEqual([{ id: 'old' }])
    expect(useConfigStore.getState().agents).toEqual([{ id: 'build' }])
    expect(useConfigStore.getState().error).toBe('models down')
  })

  it('并发调用只请求一次（refreshing 重入保护）', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const clientCall = jest.fn(async () => { await gate; return [] })

    const p1 = useConfigStore.getState().refreshAll(clientCall, { force: true })
    const p2 = useConfigStore.getState().refreshAll(clientCall, { force: true })
    release()
    await Promise.all([p1, p2])

    expect(clientCall).toHaveBeenCalledTimes(3)
  })
})

describe('msUntilRefreshDue', () => {
  it('未刷新过返回 TTL', () => {
    expect(useConfigStore.getState().msUntilRefreshDue()).toBe(CONFIG_REFRESH_TTL_MS)
  })

  it('已刷新过返回剩余毫秒', () => {
    const before = Date.now()
    useConfigStore.setState({ lastRefreshedAt: before - 60_000 })
    const due = useConfigStore.getState().msUntilRefreshDue()
    expect(due).toBeGreaterThan(0)
    expect(due).toBeLessThanOrEqual(CONFIG_REFRESH_TTL_MS - 60_000 + 50)
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/configStore.test.ts`
Expected: FAIL —— `refreshAll is not a function` / `CONFIG_REFRESH_TTL_MS` undefined。

**Step 3: 最小实现**

把 `apps/mobile/src/stores/configStore.ts` 整体替换为：

```ts
import { create } from 'zustand'

function extractArray(result: unknown, key: string): unknown[] {
  if (Array.isArray(result)) return result
  if (result && typeof result === 'object') {
    const v = (result as Record<string, unknown>)[key]
    if (Array.isArray(v)) return v
  }
  return []
}

/** 配置绝对到期阈值：距上次成功刷新超过该时长即视为过期 */
export const CONFIG_REFRESH_TTL_MS = 5 * 60 * 1000

export type ClientCall = (method: string, params?: unknown) => Promise<unknown>

export interface ConfigState {
  agents: unknown[]
  commands: unknown[]
  models: unknown[]
  loading: boolean
  error: string | null
  /** 上次任一配置成功刷新的时间戳（0=尚未刷新过）。绝对到期调度的唯一事实来源 */
  lastRefreshedAt: number
  /** 是否有一次 refreshAll 正在进行（重入保护） */
  refreshing: boolean

  fetchAgents: (clientCall: ClientCall) => Promise<void>
  fetchCommands: (clientCall: ClientCall) => Promise<void>
  fetchModels: (clientCall: ClientCall) => Promise<void>
  /** 并发重拉 agents/commands/models；成功才覆盖，失败保留旧值 */
  refreshAll: (clientCall: ClientCall, opts?: { force?: boolean }) => Promise<void>
  /** 距下一次绝对到期还有多少 ms（未刷新过 → TTL） */
  msUntilRefreshDue: () => number
}

// 注：config.get / config.providers 已随 Bridge stub 端点一并移除
// （2026-08 设置页重构）；agent 查询走 config.agents，模型/命令走 model.list / command.list。
export const useConfigStore = create<ConfigState>((set, get) => ({
  agents: [],
  commands: [],
  models: [],
  loading: false,
  error: null,
  lastRefreshedAt: 0,
  refreshing: false,

  fetchAgents: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('config.agents')
      set({ agents: extractArray(result, 'agents'), loading: false, lastRefreshedAt: Date.now() })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 agents 失败' })
    }
  },

  fetchCommands: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('command.list')
      set({ commands: extractArray(result, 'commands'), loading: false, lastRefreshedAt: Date.now() })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 commands 失败' })
    }
  },

  fetchModels: async (clientCall) => {
    set({ loading: true, error: null })
    try {
      const result = await clientCall('model.list')
      set({ models: extractArray(result, 'models'), loading: false, lastRefreshedAt: Date.now() })
    } catch (e: unknown) {
      set({ loading: false, error: e instanceof Error ? e.message : '获取 models 失败' })
    }
  },

  refreshAll: async (clientCall, opts) => {
    const { refreshing, lastRefreshedAt } = get()
    if (refreshing) return
    const fresh = lastRefreshedAt > 0 && Date.now() - lastRefreshedAt < CONFIG_REFRESH_TTL_MS
    if (fresh && !opts?.force) return
    set({ refreshing: true })
    try {
      // 单点失败不影响其它；各 fetchX 内部已 catch，失败保留旧值
      await Promise.allSettled([
        get().fetchAgents(clientCall),
        get().fetchCommands(clientCall),
        get().fetchModels(clientCall),
      ])
    } finally {
      set({ refreshing: false })
    }
  },

  msUntilRefreshDue: () => {
    const { lastRefreshedAt } = get()
    if (!lastRefreshedAt) return CONFIG_REFRESH_TTL_MS
    return Math.max(0, lastRefreshedAt + CONFIG_REFRESH_TTL_MS - Date.now())
  },
}))
```

**Step 4: 跑测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/configStore.test.ts`
Expected: PASS（新增 6 条 + 原有用例全绿）。

**Step 5: 提交**

```bash
git add apps/mobile/src/stores/configStore.ts apps/mobile/__tests__/configStore.test.ts
git commit -m "feat(config): configStore 增加绝对到期刷新原语 refreshAll"
```

---

### Task 2: test-utils 重置 configStore（测试隔离）

**Files:**
- Modify: `apps/mobile/__tests__/test-utils.tsx`

**Step 1: 加 import**

在 `apps/mobile/__tests__/test-utils.tsx` 顶部 import 区追加：

```ts
import { useConfigStore } from '../src/stores/configStore'
```

**Step 2: 在 resetAllStores() 末尾追加**

```ts
  useConfigStore.setState({
    agents: [],
    commands: [],
    models: [],
    loading: false,
    error: null,
    lastRefreshedAt: 0,
    refreshing: false,
  })
```

**Step 3: 跑一次现有 AppProvider 测试确认未破坏**

Run: `cd apps/mobile && npx jest __tests__/AppProvider.test.tsx`
Expected: PASS（现有用例全绿）。

**Step 4: 提交**

```bash
git add apps/mobile/__tests__/test-utils.tsx
git commit -m "test: resetAllStores 重置 configStore 避免跨用例泄漏"
```

---

### Task 3: AppProvider 绝对到期调度器

**Files:**
- Modify: `apps/mobile/src/components/AppProvider.tsx`
- Test: `apps/mobile/__tests__/AppProvider.test.tsx`

**Step 1: 写失败测试**

在 `apps/mobile/__tests__/AppProvider.test.tsx` 顶部 import 区追加：

```ts
import { useConfigStore, CONFIG_REFRESH_TTL_MS } from '../src/stores/configStore'
```

在文件末尾追加：

```tsx
// ─── 配置绝对到期自动刷新 ─────────────────────────────────

describe('配置绝对到期自动刷新', () => {
  it('到达绝对到期点后自动重拉配置', async () => {
    jest.useFakeTimers()
    try {
      const { client } = mockClientAndRender({ connected: true })

      // 把 lastRefreshedAt 拨到过期（订阅回调据此重排到即刻到期）
      TestRenderer.act(() => {
        useConfigStore.setState({ lastRefreshedAt: Date.now() - CONFIG_REFRESH_TTL_MS - 1 })
      })
      await TestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(0) })

      expect(client.call).toHaveBeenCalledWith('config.agents')
      expect(client.call).toHaveBeenCalledWith('command.list')
      expect(client.call).toHaveBeenCalledWith('model.list')
    } finally {
      jest.useRealTimers()
    }
  })

  it('未到绝对到期点不刷新', async () => {
    jest.useFakeTimers()
    try {
      const { client } = mockClientAndRender({ connected: true })

      TestRenderer.act(() => { useConfigStore.setState({ lastRefreshedAt: Date.now() }) })
      await TestRenderer.act(async () => {
        await jest.advanceTimersByTimeAsync(CONFIG_REFRESH_TTL_MS - 1000)
      })

      expect(client.call).not.toHaveBeenCalledWith('config.agents')
    } finally {
      jest.useRealTimers()
    }
  })

  it('回前台且已超期：立即刷新', async () => {
    const { client } = mockClientAndRender({ connected: true })

    TestRenderer.act(() => {
      useConfigStore.setState({ lastRefreshedAt: Date.now() - CONFIG_REFRESH_TTL_MS - 1 })
    })
    await TestRenderer.act(async () => {
      ;(AppState as any).__emit('active')
      await Promise.resolve()
    })

    expect(client.call).toHaveBeenCalledWith('config.agents')
  })

  it('离线到期不刷新（短重试，不空转）', async () => {
    jest.useFakeTimers()
    try {
      const { client } = mockClientAndRender({ connected: false })

      TestRenderer.act(() => {
        useConfigStore.setState({ lastRefreshedAt: Date.now() - CONFIG_REFRESH_TTL_MS - 1 })
      })
      await TestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(0) })

      expect(client.call).not.toHaveBeenCalledWith('config.agents')
    } finally {
      jest.useRealTimers()
    }
  })

  it('client 销毁后定时器与订阅被清理', async () => {
    jest.useFakeTimers()
    try {
      const { client } = mockClientAndRender({ connected: true })

      TestRenderer.act(() => { useAuthStore.setState({ client: null }) })
      await TestRenderer.act(async () => {
        await jest.advanceTimersByTimeAsync(CONFIG_REFRESH_TTL_MS + 1000)
      })

      expect(client.call).not.toHaveBeenCalledWith('config.agents')
    } finally {
      jest.useRealTimers()
    }
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/AppProvider.test.tsx -t "配置绝对到期自动刷新"`
Expected: FAIL —— 定时器未实现（`config.agents` 从未被调用 / 清理用例行为不符）。

**Step 3: 最小实现**

修改 `apps/mobile/src/components/AppProvider.tsx`：

1）import 区追加：

```ts
import { useConfigStore, CONFIG_REFRESH_TTL_MS } from '../stores/configStore'
```

2）文件顶部（组件外）加常量：

```ts
/** 离线时到期轮的短重试间隔，避免 0-delay 自旋 */
const CONFIG_OFFLINE_RETRY_MS = 30 * 1000
```

3）组件内 ref 区（`appStateSubRef` 附近）追加：

```ts
  const configRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configRefreshSubRef = useRef<(() => void) | null>(null)
```

4）在 `setupClient` 内、现有 25min `refreshTimerRef` 之后加入调度启动：

```ts
    // ── 配置绝对到期刷新 ──
    // lastRefreshedAt 是唯一事实来源：任意刷新路径成功都会触发订阅重排，
    // 定时器永远瞄准 lastRefreshedAt + TTL 这个绝对时间点（而非固定周期）。
    armConfigRefresh(client)

    configRefreshSubRef.current?.()
    configRefreshSubRef.current = useConfigStore.subscribe((s, prev) => {
      if (s.lastRefreshedAt !== prev.lastRefreshedAt) armConfigRefresh(client)
    })
```

5）在组件内新增函数 `armConfigRefresh`（放在 `setupClient` 定义附近即可，函数声明会提升）：

```ts
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

6）在 `AppState` 的 `active` 回调中，`reconcileQuestions()` 之后追加：

```ts
        // 绝对到期判断：后台冻结期间跨过到期点 → 回前台立即补刷
        const cfg = useConfigStore.getState()
        if (c.connected && Date.now() - cfg.lastRefreshedAt >= CONFIG_REFRESH_TTL_MS) {
          cfg.refreshAll(c.call.bind(c)).catch(() => {})
        }
```

7）`teardownClient` 中追加清理：

```ts
    if (configRefreshTimerRef.current) clearTimeout(configRefreshTimerRef.current)
    configRefreshTimerRef.current = null
    configRefreshSubRef.current?.()
    configRefreshSubRef.current = null
```

**Step 4: 跑测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/AppProvider.test.tsx`
Expected: PASS（新增 5 条 + 现有用例全绿）。

**Step 5: 提交**

```bash
git add apps/mobile/src/components/AppProvider.tsx apps/mobile/__tests__/AppProvider.test.tsx
git commit -m "feat(config): AppProvider 绝对到期定时刷新 + 回前台超期补刷"
```

---

### Task 4: 全量回归

**Files:** 无（仅验证）

**Step 1: 跑 mobile 全量单测**

Run: `cd apps/mobile && npx jest`
Expected: 全部 PASS，无新增 open handle 告警。

**Step 2: 如失败，定位并修复**

常见点：
- `lastRefreshedAt` 跨用例泄漏 → 确认 Task 2 已完成。
- fake timers 未 `useRealTimers()` → 确认每个新用例 `finally` 恢复。
- 订阅未清理导致旧 Provider 重复调度 → 确认 Task 3 Step 3-7 的 teardown。

**Step 3:（可选）bridge 回归，确认零影响**

Run: `cd servers/bridge && npm test`
Expected: PASS（本方案未改 bridge）。

---

## 验收标准

- [ ] `configStore.refreshAll` 并发重拉三个接口、成功覆盖、失败保留、TTL 去抖、`force` 可穿透、重入保护。
- [ ] `AppProvider` 以 `lastRefreshedAt + TTL` 绝对到期点自动刷新；任意刷新路径（connected/切项目/模型选择器）成功后自动重排。
- [ ] 回前台已超期 → 立即刷新；未超期 → 不刷新。
- [ ] 离线到期不空转（30s 重试），WS 恢复后按新锚点续期。
- [ ] client 销毁 / 登出后定时器与订阅被清理，不再触发。
- [ ] 未改动 bridge、未新增 WS 接口。
