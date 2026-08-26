# Settings 页面重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 清理 Settings 页死功能（config stub 编辑器、重复的 Providers/Agents 名单），补齐默认 Agent/Model、权限规则完整管理、About 版本信息。

**Architecture:** 纯客户端 zustand store + blob-util 文件持久化承载本地偏好；`session.create` 复用 Bridge 已有的 agent/model 参数；`health.ping` 响应追加 `bridgeVersion` 字段（唯一协议变更，向后兼容）。config stub 三端点双侧对齐移除。

**Tech Stack:** React Native 0.76 / zustand 4 / react-native-blob-util（已有依赖）/ ts-jest ESM（bridge）/ ts-jest CJS + RN mock（mobile）

**设计文档:** `docs/plans/2026-08-26-settings-page-redesign-design.md`

---

## 任务顺序与依赖

```
T1 settingsStore ──► T2 sessionStore defaults ──┐
T3 死区块删减 ──► T4 config stub 双侧清理        ├──► T6 Defaults 区块
                              T5 Permissions 增强 ┘        ▲
T7 health.ping 扩展 ──► T8 About 区块 ──────────────────────┘(独立)
```

每个任务独立提交，任意提交点全测试绿。

---

## Task 1: settingsStore（本地偏好持久化）

**Files:**
- Create: `apps/mobile/src/stores/settingsStore.ts`
- Create: `apps/mobile/__tests__/settingsStore.test.ts`
- Modify: `apps/mobile/src/components/AppProvider.tsx`（挂载时 load）

**Step 1: 写失败测试**

`apps/mobile/__tests__/settingsStore.test.ts`：

```ts
/**
 * settingsStore — 本地偏好持久化
 * react-native-blob-util 走 jest.config.js 的 moduleNameMapper mock，
 * writeFile/readFile/exists 为可控 jest.fn。
 */
import ReactNativeBlobUtil from 'react-native-blob-util'
import { useSettingsStore } from '../src/stores/settingsStore'

const fs = (ReactNativeBlobUtil as { default: typeof ReactNativeBlobUtil.fs & { dirs: Record<string, string> } } & Record<string, unknown>).default ? (ReactNativeBlobUtil as unknown as { default: { fs: jest.Mocked<typeof import('react-native-blob-util')['fs']> & { dirs: Record<string,string> } } }).default.fs
  : (ReactNativeBlobUtil as unknown as { fs: { writeFile: jest.Mock; readFile: jest.Mock; exists: jest.Mock } & { dirs: Record<string,string> } }).fs

const SETTINGS_PATH = '/mock/documents/mobile-agent-bridge-settings.json'

describe('settingsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useSettingsStore.setState({ defaultAgent: null, defaultModel: null, loaded: false })
  })

  it('load 从 DocumentDir 恢复持久化设置', async () => {
    ;(fs.exists as jest.Mock).mockResolvedValue(true)
    ;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({
      defaultAgent: 'plan',
      defaultModel: { id: 'm1', providerID: 'p1' },
    }))
    await useSettingsStore.getState().load()
    expect(fs.exists).toHaveBeenCalledWith(SETTINGS_PATH)
    expect(fs.readFile).toHaveBeenCalledWith(SETTINGS_PATH, 'utf8')
    expect(useSettingsStore.getState().defaultAgent).toBe('plan')
    expect(useSettingsStore.getState().defaultModel).toEqual({ id: 'm1', providerID: 'p1' })
    expect(useSettingsStore.getState().loaded).toBe(true)
  })

  it('load 容忍文件不存在', async () => {
    ;(fs.exists as jest.Mock).mockResolvedValue(false)
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().defaultAgent).toBeNull()
    expect(useSettingsStore.getState().loaded).toBe(true)
  })

  it('load 对损坏文件静默降级为内存默认值', async () => {
    ;(fs.exists as jest.Mock).mockResolvedValue(true)
    ;(fs.readFile as jest.Mock).mockRejectedValue(new Error('boom'))
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().loaded).toBe(true)
    expect(useSettingsStore.getState().defaultAgent).toBeNull()
  })

  it('setDefaultAgent 更新状态并持久化', async () => {
    await useSettingsStore.getState().setDefaultAgent('build')
    expect(useSettingsStore.getState().defaultAgent).toBe('build')
    expect(fs.writeFile).toHaveBeenCalledWith(
      SETTINGS_PATH,
      expect.stringContaining('"defaultAgent":"build"'),
      'utf8',
    )
  })

  it('setDefaultModel(null) 清除并持久化', async () => {
    useSettingsStore.setState({ defaultModel: { id: 'm', providerID: 'p' } })
    await useSettingsStore.getState().setDefaultModel(null)
    expect(useSettingsStore.getState().defaultModel).toBeNull()
    expect(fs.writeFile).toHaveBeenCalled()
  })

  it('持久化失败不阻断状态更新', async () => {
    ;(fs.writeFile as jest.Mock).mockRejectedValue(new Error('disk full'))
    await expect(useSettingsStore.getState().setDefaultAgent('x')).resolves.not.toThrow()
    expect(useSettingsStore.getState().defaultAgent).toBe('x')
  })
})
```

⚠️ 文件头 `fs` 的取法写复杂了——直接用项目既有约定（参照 `FileBrowserScreen.test.tsx:493`）：

```ts
const RNBlob = require('react-native-blob-util')
const fs = (RNBlob.default ?? RNBlob).fs
```

用这两行替换文件头的 `const fs = ...` 表达式。

**Step 2: 运行验证失败**

```
cd apps/mobile && npx jest __tests__/settingsStore.test.ts
```
预期：FAIL（`Cannot find module '../src/stores/settingsStore'`）

**Step 3: 最小实现**

`apps/mobile/src/stores/settingsStore.ts`：

```ts
/**
 * settingsStore — 客户端本地偏好设置
 *
 * 默认 Agent / 默认 Model 等本地设置，经 react-native-blob-util
 * 持久化到 DocumentDir/mobile-agent-bridge-settings.json。
 * 读写失败静默降级为内存态，不阻塞 UI。
 */
import { create } from 'zustand'
import ReactNativeBlobUtil from 'react-native-blob-util'

export interface DefaultModel {
  id: string
  providerID: string
  variant?: string
}

interface SettingsFile {
  defaultAgent: string | null
  defaultModel: DefaultModel | null
}

export interface SettingsState {
  /** 新会话默认 agent；null = 跟随服务端默认 */
  defaultAgent: string | null
  /** 新会话默认模型；null = 跟随服务端默认 */
  defaultModel: DefaultModel | null
  /** 磁盘恢复是否已完成（无论成败） */
  loaded: boolean

  load: () => Promise<void>
  setDefaultAgent: (agent: string | null) => Promise<void>
  setDefaultModel: (model: DefaultModel | null) => Promise<void>
}

const SETTINGS_PATH =
  `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/mobile-agent-bridge-settings.json`

async function persist(file: SettingsFile): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(SETTINGS_PATH, JSON.stringify(file), 'utf8')
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  defaultAgent: null,
  defaultModel: null,
  loaded: false,

  load: async () => {
    try {
      const exists = await ReactNativeBlobUtil.fs.exists(SETTINGS_PATH)
      if (!exists) {
        set({ loaded: true })
        return
      }
      const raw = await ReactNativeBlobUtil.fs.readFile(SETTINGS_PATH, 'utf8')
      const parsed = JSON.parse(raw || '{}') as Partial<SettingsFile>
      set({
        defaultAgent: parsed.defaultAgent ?? null,
        defaultModel: parsed.defaultModel ?? null,
        loaded: true,
      })
    } catch {
      // 文件损坏/读取失败：静默降级为内存默认值
      set({ loaded: true })
    }
  },

  setDefaultAgent: async (agent) => {
    set({ defaultAgent: agent })
    await persist({
      defaultAgent: get().defaultAgent,
      defaultModel: get().defaultModel,
    }).catch(() => {})
  },

  setDefaultModel: async (model) => {
    set({ defaultModel: model })
    await persist({
      defaultAgent: get().defaultAgent,
      defaultModel: get().defaultModel,
    }).catch(() => {})
  },
}))
```

**Step 4: 运行验证通过**

```
cd apps/mobile && npx jest __tests__/settingsStore.test.ts
```
预期：6 passed

**Step 5: 接入启动加载**

`apps/mobile/src/components/AppProvider.tsx`——顶部加 import，在组件内已有 useEffect 区域加一次性挂载效应：

```tsx
import { useSettingsStore } from '../stores/settingsStore'

// 组件体内，与其他 useEffect 并列：
useEffect(() => {
  void useSettingsStore.getState().load()
}, [])
```

然后跑全量 mobile 测试确认无回归：

```
cd apps/mobile && npx jest
```
预期：全部通过

**Step 6: 提交**

```
git add apps/mobile/src/stores/settingsStore.ts apps/mobile/__tests__/settingsStore.test.ts apps/mobile/src/components/AppProvider.tsx
git commit -m "feat(mobile): settingsStore 本地偏好持久化(blob-util 文件)+启动恢复"
```

---

## Task 2: sessionStore.createSession 携带默认值

**Files:**
- Modify: `apps/mobile/src/stores/sessionStore.ts`（createSession，约 148 行起）
- Modify: `apps/mobile/__tests__/sessionStore.test.ts`

**Step 1: 写失败测试**

在 `apps/mobile/__tests__/sessionStore.test.ts` 追加（沿用该文件现有 import；顶部补 `import { useSettingsStore } from '../src/stores/settingsStore'`）：

```ts
describe('createSession with local defaults', () => {
  it('把 settingsStore 的默认 agent/model 传给 session.create', async () => {
    useSettingsStore.setState({
      defaultAgent: 'build',
      defaultModel: { id: 'gpt-x', providerID: 'openai' },
    })
    const call = jest.fn().mockResolvedValue({ id: 's-def' })
    await useSessionStore.getState().createSession(call)
    expect(call).toHaveBeenCalledWith('session.create', {
      agent: 'build',
      model: { id: 'gpt-x', providerID: 'openai' },
    })
    expect(useSessionStore.getState().sessions[0].id).toBe('s-def')
  })

  it('含 variant 时透传 variant', async () => {
    useSettingsStore.setState({
      defaultAgent: null,
      defaultModel: { id: 'm', providerID: 'p', variant: 'fast' },
    })
    const call = jest.fn().mockResolvedValue({ id: 's2' })
    await useSessionStore.getState().createSession(call)
    expect(call).toHaveBeenCalledWith('session.create', {
      model: { id: 'm', providerID: 'p', variant: 'fast' },
    })
  })

  it('未配置默认值时传空参数（服务端兜底生效）', async () => {
    useSettingsStore.setState({ defaultAgent: null, defaultModel: null })
    const call = jest.fn().mockResolvedValue({ id: 's3' })
    await useSessionStore.getState().createSession(call)
    expect(call).toHaveBeenCalledWith('session.create', {})
  })
})
```

**Step 2: 运行验证失败**

```
cd apps/mobile && npx jest __tests__/sessionStore.test.ts
```
预期：新用例 FAIL（实际收到 `'session.create', {}`）

**Step 3: 实现**

`apps/mobile/src/stores/sessionStore.ts` 顶部加：

```ts
import { useSettingsStore } from './settingsStore'
```

`createSession` 改为（仅替换开头取 result 之前的部分）：

```ts
  createSession: async (clientCall) => {
    set({ error: null })
    try {
      // 新会话默认值：客户端本地偏好优先，未配置则空参由服务端兜底
      // （bridge session.create 原生支持 agent/model 参数）
      const { defaultAgent, defaultModel } = useSettingsStore.getState()
      const params: Record<string, unknown> = {}
      if (defaultAgent) params.agent = defaultAgent
      if (defaultModel?.id && defaultModel?.providerID) {
        params.model = defaultModel.variant
          ? { id: defaultModel.id, providerID: defaultModel.providerID, variant: defaultModel.variant }
          : { id: defaultModel.id, providerID: defaultModel.providerID }
      }
      const result = await clientCall('session.create', params)
      // ……以下保持原样
```

**Step 4: 运行验证通过**

```
cd apps/mobile && npx jest __tests__/sessionStore.test.ts
```
预期：PASS

**Step 5: 提交**

```
git add apps/mobile/src/stores/sessionStore.ts apps/mobile/__tests__/sessionStore.test.ts
git commit -m "feat(mobile): 新会话携带 settingsStore 默认 agent/model——打通 session.create 既有参数"
```

---

## Task 3: SettingsScreen 死区块删减

**Files:**
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/__tests__/SettingsScreen.test.tsx`

**Step 1: 先加负向断言测试（红）**

在 `SettingsScreen.test.tsx` 主 describe 内追加（复用该文件现有的渲染辅助函数/初始 store 状态设置方式）：

```tsx
  it('不再渲染 Config 区块（后端 stub 已移除）', () => {
    const { queryByText } = renderSettings()
    expect(queryByText('Config')).toBeNull()
  })

  it('不再渲染 Providers 名单区块', () => {
    const { queryByText } = renderSettings()
    expect(queryByText(/^Providers/)).toBeNull()
  })

  it('不再渲染 Agents 名单区块', () => {
    const { queryByText } = renderSettings()
    expect(queryByText(/^Agents/)).toBeNull()
  })
```

⚠️ 若该文件没有 `renderSettings` 辅助而是各用例内联 `render(<SettingsScreen />)`，按现状内联。注意测试环境里 configStore 的 `agents`/`providers` 可能非数组导致旧代码崩溃——这正是先写测试的价值。

**Step 2: 运行验证失败**

```
cd apps/mobile && npx jest __tests__/SettingsScreen.test.tsx
```
预期：新增 3 用例 FAIL（仍渲染）

**Step 3: 删减实现**

`SettingsScreen.tsx` 删除：
- import 中不再使用的：`TextInput`、`Modal`、`Platform`、`useConfigStore`（整行）
- 订阅：`config`、`updateConfig`、`agents`、`providers` 四个 hook 值
- state：`configEditVisible`、`configEditText`
- handler：`handleOpenConfigEdit`、`handleSaveConfig`
- JSX：`Config` 整个 section、`Providers` section、`Agents` section、底部整个 `<Modal>` 块

保留：Connection、Project、Saved Permissions、Disconnect 及其样式。

**Step 4: 运行验证通过**

```
cd apps/mobile && npx jest __tests__/SettingsScreen.test.tsx && npx tsc --noEmit
```
预期：全绿（此时 configStore 的 `fetchConfig/providers` 已无 UI 消费方但仍在，tsc 不报错）

**Step 5: 提交**

```
git add apps/mobile/src/screens/SettingsScreen.tsx apps/mobile/__tests__/SettingsScreen.test.tsx
git commit -m "refactor(mobile): Settings 删除 Config 编辑器与 Providers/Agents 只读名单——后端 stub 无效功能"
```

---

## Task 4: config stub 双侧对齐清理（同一提交）

**Files:**
- Modify: `servers/bridge/src/server/router.ts`（281-282、288-290 行区域）
- Modify: `servers/bridge/__tests__/router.test.ts`（739-774 行区域）
- Modify: `apps/mobile/src/stores/configStore.ts`
- Modify: `apps/mobile/src/stores/authStore.ts`（约 75-86 行）
- Modify: `apps/mobile/__tests__/configStore.test.ts`

**Step 1: Bridge 测试先行（红）**

`router.test.ts` 中删除这三个用例：
- `"should return empty config on config.get (endpoint removed in server 1.18)"`
- `"should return ok on config.update (endpoint removed in server 1.18)"`
- `"should call provider.list on config.providers (v2)"`

替换为（断言风格照抄相邻 unknown-method 类用例的取 sent 方式）：

```ts
  it("should reject config.get as unknown method (stub removed)", async () => {
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "config.get", params: {} }, testPayload)
    const sent = JSON.parse(ws.send.mock.calls[0][0])
    expect(sent.ok).toBe(false)
    expect(sent.error).toContain("unknown method")
  })

  it("should reject config.update as unknown method (stub removed)", async () => {
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "config.update", params: {} }, testPayload)
    const sent = JSON.parse(ws.send.mock.calls[0][0])
    expect(sent.ok).toBe(false)
    expect(sent.error).toContain("unknown method")
  })

  it("should reject config.providers as unknown method (merged into provider.list)", async () => {
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "config.providers", params: {} }, testPayload)
    const sent = JSON.parse(ws.send.mock.calls[0][0])
    expect(sent.ok).toBe(false)
    expect(sent.error).toContain("unknown method")
  })
```

⚠️ 执行前先读 739-780 行确认 `ws.send.mock.calls` 的索引基准（若同 conn 已有历史 send 需调整下标或清 mock）。保留 `config.agents`、`provider.list` 相关用例不动。

**Step 2: 运行验证失败**

```
cd servers/bridge && npm test -- router.test.ts -t "unknown method"
```
预期：3 个新用例 FAIL（当前返回 ok:true）

**Step 3: Bridge 实现**

`router.ts` 删除：

```ts
// opencode server 1.18.x 无 /config 端点：config.get/update 返回空（功能在 server 侧不存在）
registerHandler("config.get", async () => ({ config: {} }))
registerHandler("config.update", async () => ({ ok: true }))
```

和：

```ts
// config.providers 真实对接 /api/provider
registerHandler("config.providers", async () => {
  const providers = unwrapData(await sdkCall(() => sdk().v2.provider.list({})))
  return { providers }
})
```

并把 `config.agents` 上方的注释改为说明 `provider.list` 是唯一 provider 端点。

**Step 4: Bridge 验证通过**

```
cd servers/bridge && npm test
```
预期：全绿

**Step 5: Mobile 同步清理**

`configStore.ts` 删除字段与方法：`config`、`fetchConfig`、`updateConfig`、`providers`、`fetchProviders`（接口声明 + 实现两处）。保留 `loading/error/agents/commands/models` 与对应三个 fetch。

`authStore.ts` 登录 Promise.all 改为：

```ts
      // ── 层2就绪后拉取聊天所需全局数据（agent/command/model）──
      // config.get/providers 已随 stub 端点一并移除（2026-08 设置页重构）
      const { useConfigStore } = await import('./configStore')
      const call = client.call.bind(client)
      await Promise.all([
        useConfigStore.getState().fetchAgents(call),
        useConfigStore.getState().fetchCommands(call),
        useConfigStore.getState().fetchModels(call),
      ])
```

`configStore.test.ts` 删除 `fetchConfig`/`fetchProviders`/`updateConfig` 的用例。

**Step 6: 双侧全量验证**

```
cd apps/mobile && npx jest
cd servers/bridge && npm test
```
预期：双侧全绿

**Step 7: 提交（双侧同一提交，接口对齐约束）**

```
git add servers/bridge/src/server/router.ts servers/bridge/__tests__/router.test.ts apps/mobile/src/stores/configStore.ts apps/mobile/src/stores/authStore.ts apps/mobile/__tests__/configStore.test.ts
git commit -m "refactor(protocol)!: 移除 config.get/update/providers stub 全链路——provider.list 为唯一 provider 端点"
```

---

## Task 5: Permissions 完整管理（分组 + 删除确认）

**Files:**
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/__tests__/SettingsScreen.test.tsx`

**Step 1: 写失败测试**

追加用例（savedRules 经 toolStore setState 注入，参照该文件现有 toolStore mock 方式）：

```tsx
  it('按 tool 分组渲染全部规则（无 10 条截断）', () => {
    useToolStore.setState({
      savedRules: [
        { id: 'r1', tool: 'bash', action: 'allow *' },
        { id: 'r2', tool: 'bash', action: 'allow ls' },
        { id: 'r3', tool: 'edit', action: 'allow **' },
        // 12 条确保超过旧 slice(0,10) 上限
        ...Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, tool: 'web', action: `allow ${i}` })),
      ],
      savedRulesLoading: false,
    })
    const { getByText, queryByText } = renderSettings()
    expect(getByText('bash (2)')).toBeTruthy()
    expect(getByText('edit (1)')).toBeTruthy()
    expect(getByText('web (12)')).toBeTruthy()   // 旧实现只显示 8 条 web
    expect(queryByText('allow 11')).not.toBeNull() // 第 12 条可见
  })

  it('删除需二次确认，确认后才调用 removeSavedRule', () => {
    const removeSpy = jest.spyOn(useToolStore.getState(), 'removeSavedRule').mockResolvedValue()
    const { getAllByText } = renderSettings()
    fireEvent.press(getAllByText('Delete')[0])
    expect(removeSpy).not.toHaveBeenCalled()          // 仅弹确认
    fireEvent.press(getByText('Delete'))               // Alert 内的 Delete（mock Alert 直接触发回调更稳，见下）
    expect(removeSpy).toHaveBeenCalled()
  })
```

⚠️ RN 测试环境下 `Alert.alert` 不会真正弹出——在该测试文件顶部加：

```ts
import { Alert } from 'react-native'
let alertSpy: jest.SpyInstance
beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b?.style === 'destructive')?.onPress?.()
  })
})
afterEach(() => alertSpy.mockRestore())
```

第二个用例据此改写为：press 第一条 Delete → 断言 `alertSpy` 被调且 `removeSpy` 未被调 → 由于 mock 自动执行 destructive 回调 → 断言 `removeSpy` 已被调一次。

**Step 2: 运行验证失败**

```
cd apps/mobile && npx jest __tests__/SettingsScreen.test.tsx
```
预期：FAIL（无分组标签、直接删除无确认）

**Step 3: 实现**

`SettingsScreen.tsx`：

```tsx
import React, { useEffect, useMemo, useState } from 'react'
```

组件内加分组 memo 与确认函数：

```tsx
  const groupedRules = useMemo(() => {
    const groups = new Map<string, Array<Record<string, unknown>>>()
    for (const rule of savedRules as Array<Record<string, unknown>>) {
      const key = String(rule.tool || rule.action || 'other')
      const list = groups.get(key) ?? []
      list.push(rule)
      groups.set(key, list)
    }
    return [...groups.entries()]
  }, [savedRules])

  const confirmRemoveRule = (rule: Record<string, unknown>) => {
    Alert.alert(
      'Delete Permission Rule',
      String(rule.action || rule.id || ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { void handleRemoveRule(String(rule.id)) },
        },
      ],
    )
  }
```

替换 Saved Permissions section 的列表渲染（去掉 `slice(0, 10)`）：

```tsx
        ) : groupedRules.length > 0 ? (
          groupedRules.map(([tool, rules]) => (
            <View key={tool}>
              <Text style={styles.groupLabel}>{tool} ({rules.length})</Text>
              {rules.map((r, i) => (
                <View key={String(r.id || i)} style={styles.row}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {String(r.action || r.pattern || r.id || `Rule ${i + 1}`)}
                  </Text>
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => confirmRemoveRule(r)}
                  >
                    <Text style={{ color: colors.destructive, fontSize: 13 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ))
        ) : (
```

`makeStyles` 加：

```ts
  groupLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 4,
  },
```

**Step 4: 验证 + 提交**

```
cd apps/mobile && npx jest __tests__/SettingsScreen.test.tsx
git add -A apps/mobile/src/screens/SettingsScreen.tsx apps/mobile/__tests__/SettingsScreen.test.tsx
git commit -m "feat(mobile): 权限规则完整管理——按 tool 分组全量渲染+删除二次确认"
```

---

## Task 6: Defaults 区块（默认 Agent / 默认 Model）

**Files:**
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/__tests__/SettingsScreen.test.tsx`

**Step 1: 写失败测试**

```tsx
describe('SettingsScreen — Defaults', () => {
  it('展示当前默认 agent，未设置为 Server default', () => {
    useSettingsStore.setState({ defaultAgent: null, defaultModel: null })
    const { getAllByText } = renderSettings()
    expect(getAllByText('Server default').length).toBeGreaterThanOrEqual(2)
  })

  it('点击 Default Agent 行弹出候选并可选择', () => {
    useConfigStore.setState({ agents: [{ name: 'build', label: 'Build' }, { name: 'plan', label: 'Plan' }] })
    const { getByText } = renderSettings()
    fireEvent.press(getByText('Default Agent'))
    expect(getByText('Build')).toBeTruthy()
    fireEvent.press(getByText('Build'))
    expect(useSettingsStore.getState().defaultAgent).toBe('build')
  })

  it('Agent 候选含清除项，选择后回到 Server default', () => {
    useSettingsStore.setState({ defaultAgent: 'build', defaultModel: null })
    const { getByText } = renderSettings()
    fireEvent.press(getByText('Default Agent'))
    fireEvent.press(getByText('Server default'))
    expect(useSettingsStore.getState().defaultAgent).toBeNull()
  })

  it('Default Model 经 ModelPickerModal 选择后写入 {id, providerID}', () => {
    useConfigStore.setState({ models: [{ id: 'm1', providerID: 'p1', name: 'Model One' }] })
    const { getByText } = renderSettings()
    fireEvent.press(getByText('Default Model'))
    fireEvent.press(getByText('Model One'))
    expect(useSettingsStore.getState().defaultModel).toEqual({ id: 'm1', providerID: 'p1' })
  })
})
```

顶部补 `import { useSettingsStore } from '../src/stores/settingsStore'`（若无）。

**Step 2: 验证失败**

```
cd apps/mobile && npx jest __tests__/SettingsScreen.test.tsx -t Defaults
```

**Step 3: 实现**

imports 增加：

```tsx
import { ScrollView } from 'react-native'   // 合并进现有 react-native import
import { ModelPickerModal } from '../components/ModelPickerModal'
import { useSettingsStore } from '../stores/settingsStore'
```

订阅与局部 state：

```tsx
  const defaultAgent = useSettingsStore((s) => s.defaultAgent)
  const defaultModel = useSettingsStore((s) => s.defaultModel)
  const setDefaultAgent = useSettingsStore((s) => s.setDefaultAgent)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const agents = useConfigStore((s) => s.agents) as Array<{ name?: string; id?: string; label?: string }>
  const models = useConfigStore((s) => s.models)

  const [agentPickVisible, setAgentPickVisible] = useState(false)
  const [modelPickVisible, setModelPickVisible] = useState(false)
```

Project section 之后插入：

```tsx
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Defaults</Text>
        <TouchableOpacity style={styles.row} onPress={() => setAgentPickVisible(true)}>
          <Text style={styles.rowLabel}>Default Agent</Text>
          <Text style={styles.rowValue}>{defaultAgent || 'Server default'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => setModelPickVisible(true)}>
          <Text style={styles.rowLabel}>Default Model</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {defaultModel ? `${defaultModel.providerID}/${defaultModel.id}` : 'Server default'}
          </Text>
        </TouchableOpacity>
      </View>
```

Disconnect 之前插入两个 Modal：

```tsx
      <Modal visible={agentPickVisible} transparent animationType="slide" onRequestClose={() => setAgentPickVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAgentPickVisible(false)}>
          <TouchableOpacity style={styles.modalContent} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.modalTitle}>Default Agent</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => { void setDefaultAgent(null); setAgentPickVisible(false) }}
              >
                <Text style={styles.rowLabel}>Server default</Text>
              </TouchableOpacity>
              {agents.map((a, i) => (
                <TouchableOpacity
                  key={a.name || i}
                  style={styles.row}
                  onPress={() => { void setDefaultAgent(String(a.name || '')); setAgentPickVisible(false) }}
                >
                  <Text style={styles.rowLabel}>{a.label || a.name || `Agent ${i + 1}`}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ModelPickerModal
        visible={modelPickVisible}
        onClose={() => setModelPickVisible(false)}
        onSelect={(m) => {
          // 与 ChatScreen 相同的身份提取：id + providerID(+variant)，同名跨 provider 不串
          const entry = (m && typeof m === 'object' ? m : {}) as { id?: string; providerID?: string; variant?: string }
          if (entry.id && entry.providerID) {
            void setDefaultModel({
              id: entry.id,
              providerID: entry.providerID,
              ...(entry.variant ? { variant: entry.variant } : {}),
            })
          }
          setModelPickVisible(false)
        }}
        models={models}
        currentModel={defaultModel}
      />
```

恢复 `Modal` 到 react-native import。

**Step 4: 验证 + 提交**

```
cd apps/mobile && npx jest __tests__/SettingsScreen.test.tsx && npx tsc --noEmit
git add -A apps/mobile/src/screens/SettingsScreen.tsx apps/mobile/__tests__/SettingsScreen.test.tsx
git commit -m "feat(mobile): Settings Defaults 区块——默认 Agent 单选 + 复用 ModelPickerModal 选默认模型"
```

---

## Task 7: Bridge health.ping 扩展 bridgeVersion

**Files:**
- Modify: `servers/bridge/src/server/router.ts`（86 行 health.ping 注册处 + 文件头部 import 区）
- Modify: `servers/bridge/__tests__/router.test.ts`（124 行用例）

**Step 1: 改失败断言**

读 110-135 行现用例，将期望响应改为：

```ts
  it("should handle health.ping with bridgeVersion", async () => {
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "health.ping", params: {} }, testPayload)
    const sent = JSON.parse(ws.send.mock.calls[0][0])
    expect(sent.ok).toBe(true)
    expect(typeof sent.bridgeVersion).toBe("string")
    expect(sent.bridgeVersion.length).toBeGreaterThan(0)
  })
```

（444 行第二处 health.ping 用例同步放宽为只断言 `ok:true` 或同样接受新字段。）

**Step 2: 验证失败**

```
cd servers/bridge && npm test -- router.test.ts -t "health.ping"
```

**Step 3: 实现**

`router.ts` import 区加：

```ts
import { readFileSync } from "node:fs"
```

注册处上方加：

```ts
/** Bridge 包版本（package.json 读取，失败降级 unknown）。
 *  ESM 下 import.meta.url 在 ts-jest ESM preset(--experimental-vm-modules) 与 tsx 运行时均可用 */
const BRIDGE_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string }
    return pkg.version || "unknown"
  } catch {
    return "unknown"
  }
})()

registerHandler("health.ping", () => ({ ok: true, bridgeVersion: BRIDGE_VERSION }))
```

**Step 4: 验证 + 提交**

```
cd servers/bridge && npm test
git add servers/bridge/src/server/router.ts servers/bridge/__tests__/router.test.ts
git commit -m "feat(bridge): health.ping 返回 bridgeVersion——供移动端 About 展示"
```

---

## Task 8: About 区块

**Files:**
- Create: `apps/mobile/src/config/appInfo.ts`
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/__tests__/SettingsScreen.test.tsx`

**Step 1: 写失败测试**

```tsx
describe('SettingsScreen — About', () => {
  it('展示 app 版本与 bridge 版本', async () => {
    const client = makeConnectedClient()   // 复用该文件现有构造 connected client 的方式
    jest.spyOn(client, 'call').mockResolvedValue({ ok: true, bridgeVersion: '0.1.0' })
    const { findByText } = renderSettings({ client })
    expect(await findByText('App v0.1.0')).toBeTruthy()
    expect(await findByText(/Bridge v0\.1\.0|Bridge v\(unknown\)/)).toBeTruthy()
  })

  it('health.ping 失败时不崩溃，bridge 版本显示占位', async () => {
    const client = makeConnectedClient()
    jest.spyOn(client, 'call').mockRejectedValue(new Error('down'))
    const { findByText } = renderSettings({ client })
    expect(await findByText(/Bridge v/)).toBeTruthy()
  })
})
```

⚠️ 渲染辅助签名以该文件现状为准（可能不支持传入 client 参数，则用 authStore.setState 注入 connected client，参照 Connected/Disconnected 用例的做法）。

**Step 2: 验证失败**

```
cd apps/mobile && npx jest __tests__/SettingsScreen.test.tsx -t About
```

**Step 3: 实现**

`apps/mobile/src/config/appInfo.ts`：

```ts
/**
 * 应用静态信息。version 必须与 apps/mobile/package.json 同步更新
 * （发布流程手动维护；刻意不引入 react-native-device-info 以免新增原生依赖）。
 */
export const APP_VERSION = '0.1.0'
```

`SettingsScreen.tsx`：

```tsx
import { APP_VERSION } from '../config/appInfo'
// ...
  const [bridgeVersion, setBridgeVersion] = useState('')
  useEffect(() => {
    if (!client) return
    let cancelled = false
    client.call('health.ping', {}).then((r) => {
      const v = (r as { bridgeVersion?: string } | null)?.bridgeVersion
      if (!cancelled) setBridgeVersion(typeof v === 'string' && v ? v : '(unknown)')
    }).catch(() => { if (!cancelled) setBridgeVersion('(unknown)') })
    return () => { cancelled = true }
  }, [client])
```

Disconnect 按钮之前插入：

```tsx
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>App Version</Text>
          <Text style={styles.rowValue}>v{APP_VERSION}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Bridge Version</Text>
          <Text style={styles.rowValue}>{bridgeVersion ? `v${bridgeVersion}` : '…'}</Text>
        </View>
      </View>
```

⚠️ 测试断言文案与实现二选一对齐：若实现渲染 `v0.1.0` 则断言 `/^v0\.1\.0$/` 的文本节点 `getByText('v0.1.0')`——以最终实现为准回改断言，保持一致即可。

**Step 4: 全量回归 + 提交**

```
cd apps/mobile && npx jest && npx tsc --noEmit
cd ../..\\servers\\bridge && npm test
git add apps/mobile/src/config/appInfo.ts apps/mobile/src/screens/SettingsScreen.tsx apps/mobile/__tests__/SettingsScreen.test.tsx
git commit -m "feat(mobile): About 区块——App 版本常量 + health.ping bridge 版本展示"
```

---

## 收尾清单

- [ ] `cd apps/mobile && npx jest` 全绿
- [ ] `cd servers/bridge && npm test` 全绿
- [ ] `npx tsc --noEmit`（mobile）无错误
- [ ] `git status` 根目录无杂散文件（日志/dump 等）
- [ ] 真机冒烟：连接 → Settings 各区块操作 → 新建会话确认默认 agent/model 生效（聊天页标题栏模型/provider 显示）
