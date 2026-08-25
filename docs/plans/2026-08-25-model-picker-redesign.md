# 模型选择器重设计实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 ChatScreen 内嵌的模型选择弹窗提取为独立组件，条目改为两行布局（修复文字截断），并增加按名称/服务商搜索的能力。

**Architecture:** 新建纯展示组件 `ModelPickerModal`（props 进、onSelect 回调出），切换模型的业务逻辑留在 ChatScreen 的 `handleSwitchModel`。搜索为客户端 `useMemo` 过滤，无网络请求。

**Tech Stack:** React Native（react-test-renderer 单测）、zustand（configStore/sessionStore 既有数据源）。

**设计文档:** `docs/plans/2026-08-25-model-picker-redesign-design.md`

---

## 背景：现有代码位置

- 内嵌弹窗 JSX：`apps/mobile/src/screens/ChatScreen.tsx:451-506`（`<Modal visible={modelPickerVisible}>...</Modal>`）
- 相关 styles：同文件 ~642-714 行的 `modalOverlay / modelPickerCard / modelPickerTitle / modelPickerBody / modelPickerEmpty / modelPickerItem / modelPickerItemText / modelPickerItemArrow / modelPickerItemLeft / modelPickerItemActive / modelProviderBadge / modelProviderBadgeText`
- 状态与回调（保留在 ChatScreen）：`modelPickerVisible` state、`models = useConfigStore((s) => s.models)`、`currentSession?.model`、`handleSwitchModel`（~264-277 行）
- `ScrollView` import 与 `modalOverlay` 样式**仅**被该弹窗使用，迁出后删除
- 测试参考模式：`apps/mobile/__tests__/SlashSheet.test.tsx`；工具函数 `textOf` 来自 `__tests__/test-utils.tsx`
- 主题色：`useThemeColors()` → `ThemeColors`（`colors.surface/surfaceVariant/text/textTertiary/primary/border` 等）

---

### Task 1: ModelPickerModal 组件（TDD）

**Files:**
- Test: `apps/mobile/__tests__/ModelPickerModal.test.tsx`（新建）
- Create: `apps/mobile/src/components/ModelPickerModal.tsx`

**Step 1: 写失败测试**

创建 `apps/mobile/__tests__/ModelPickerModal.test.tsx`：

```tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { TouchableOpacity, Text, TextInput } from 'react-native'
import { ModelPickerModal } from '../src/components/ModelPickerModal'
import { textOf } from './test-utils'

const onClose = jest.fn()
const onSelect = jest.fn()

const MODELS = [
  { id: 'deepseek-v4-flash', providerID: 'opencode-go', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-flash', providerID: 'opencode', name: 'DeepSeek V4 Flash' },
  { id: 'claude-sonnet-4-5', providerID: 'anthropic', name: 'Claude Sonnet 4.5' },
]

const render = (props: Partial<Parameters<typeof ModelPickerModal>[0]> = {}) =>
  TestRenderer.create(
    <ModelPickerModal
      visible
      onClose={onClose}
      onSelect={onSelect}
      models={MODELS}
      currentModel={{ id: 'deepseek-v4-flash', providerID: 'opencode' }}
      {...props}
    />,
  )

beforeEach(() => jest.clearAllMocks())

describe('ModelPickerModal', () => {
  it('渲染模型名与服务商名（两段独立文本）', () => {
    const tree = render()
    const text = textOf(tree)
    expect(text).toContain('DeepSeek V4 Flash')
    expect(text).toContain('opencode-go')
    expect(text).toContain('Claude Sonnet 4.5')
    // 当前选中项恰好标一个 ✓（同名跨 provider 只匹配一个）
    expect((text.match(/✓/g) || []).length).toBe(1)
  })

  it('按名称过滤（大小写不敏感）', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('claude') })
    const text = textOf(tree)
    expect(text).toContain('Claude Sonnet 4.5')
    expect(text).not.toContain('DeepSeek V4 Flash')
  })

  it('按服务商名过滤', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('opencode') })
    const text = textOf(tree)
    // opencode 与 opencode-go 都命中
    expect((text.match(/DeepSeek V4 Flash/g) || []).length).toBe(2)
    expect(text).not.toContain('Claude Sonnet 4.5')
  })

  it('搜索无结果显示空态文案', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('不存在') })
    expect(textOf(tree)).toContain('无匹配模型')
  })

  it('models 为空显示 No models loaded', () => {
    const tree = render({ models: [] })
    expect(textOf(tree)).toContain('No models loaded')
  })

  it('点选条目回调完整 model 对象并关闭', async () => {
    const tree = render()
    // 定位 'GPT 风格' 条目：找文本节点向上找最近可点击祖先
    const node = tree.root.findAll(
      (n: any) => n.type && n.props?.children === 'Claude Sonnet 4.5',
    )[0]
    expect(node).toBeTruthy()
    let item: any = node
    while (item && typeof item.props?.onPress !== 'function') item = item.parent
    await act(async () => { await item.props.onPress() })
    expect(onSelect).toHaveBeenCalledWith(MODELS[2])
    expect(onClose).toHaveBeenCalled()
  })

  it('清除按钮清空搜索词恢复全列表', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('claude') })
    expect(textOf(tree)).not.toContain('DeepSeek V4 Flash')
    // 找 ✕ 清除按钮（其 onPress 会重置 query）
    const clearBtn = tree.root.findAllByType(TouchableOpacity)
      .find((b: any) => {
        try {
          return b.findAllByType(Text).some((t: any) => t.props.children === '✕')
        } catch { return false }
      })
    expect(clearBtn).toBeTruthy()
    act(() => { clearBtn!.props.onPress() })
    expect(textOf(tree)).toContain('DeepSeek V4 Flash')
  })

  it('visible 从 false 变 true 时清空上次搜索词', () => {
    const tree = render({ visible: false })
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('claude') })
    act(() => { tree.update(<ModelPickerModal visible onClose={onClose} onSelect={onSelect} models={MODELS} />) })
    expect(textOf(tree)).toContain('DeepSeek V4 Flash')
  })

  it('overlay 点击触发 onClose', () => {
    const tree = render()
    // 第一个 TouchableOpacity 是 overlay
    const overlay = tree.root.findAllByType(TouchableOpacity)[0]
    act(() => { overlay.props.onPress() })
    expect(onClose).toHaveBeenCalled()
  })
})
```

注意：`textOf` 已存在于 `__tests__/test-utils.tsx`，直接 import，不要重复实现。

**Step 2: 运行验证失败**

```bash
cd apps/mobile && npx jest __tests__/ModelPickerModal.test.tsx
```

预期：FAIL — `Cannot find module '../src/components/ModelPickerModal'`

**Step 3: 实现组件**

创建 `apps/mobile/src/components/ModelPickerModal.tsx`：

```tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native'
import { useThemeColors } from '../theme/ThemeContext'
import type { ThemeColors } from '../theme/colors'

interface ModelEntry {
  id?: string
  providerID?: string
  name?: string
  label?: string
}

interface ModelPickerModalProps {
  visible: boolean
  onClose: () => void
  onSelect: (model: unknown) => void
  models: unknown[]
  currentModel?: { id?: string; providerID?: string } | null
}

/** 归一化一条模型记录：label 取 name > id > label 兜底 */
function normalize(m: unknown, i: number): { key: string; label: string; provider: string; raw: unknown } {
  const e = (m && typeof m === 'object' ? m : {}) as ModelEntry
  const label = e.name || e.id || e.label || `Model ${i + 1}`
  const provider = e.providerID || ''
  return { key: `${provider}:${e.id || i}`, label, provider, raw: m }
}

export function ModelPickerModal({ visible, onClose, onSelect, models, currentModel }: ModelPickerModalProps) {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [query, setQuery] = useState('')

  // 每次打开清空上次搜索词
  useEffect(() => {
    if (visible) setQuery('')
  }, [visible])

  const items = useMemo(() => (Array.isArray(models) ? models : []).map(normalize), [models])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => `${it.label} ${it.raw && typeof it.raw === 'object' ? ((it.raw as ModelEntry).id || '') : ''} ${it.provider}`.toLowerCase().includes(q))
  }, [items, query])

  const isCurrent = (it: { raw: unknown }) => {
    const e = (it.raw && typeof it.raw === 'object' ? it.raw : {}) as ModelEntry
    // 同名模型可能来自不同 provider：必须 (id + providerID) 双字段匹配，
    // 确保只有真正正在使用的那个被标记 ✓
    const cid = currentModel?.id
    const cpid = currentModel?.providerID
    return cid != null && e.id === cid && (!cpid || e.providerID === cpid)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>Select Model</Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索模型…"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Search models"
            />
            {query.length > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => setQuery('')}
                accessibilityLabel="Clear search"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.clearButtonText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {(!Array.isArray(models) || models.length === 0) && (
              <Text style={styles.empty}>No models loaded</Text>
            )}
            {Array.isArray(models) && models.length > 0 && filtered.length === 0 && (
              <Text style={styles.empty}>无匹配模型</Text>
            )}
            {filtered.map((it) => {
              const current = isCurrent(it)
              return (
                <TouchableOpacity
                  key={it.key}
                  style={[styles.item, current && styles.itemActive]}
                  onPress={() => { onSelect(it.raw); onClose() }}
                >
                  {/* 两行布局：第一行模型名独占宽度，第二行服务商徽章 */}
                  <View style={styles.itemMain}>
                    <Text style={styles.itemName} numberOfLines={2}>{it.label}</Text>
                    {it.provider ? (
                      <View style={styles.providerBadge}>
                        <Text style={styles.providerBadgeText} numberOfLines={1}>{it.provider}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.itemArrow}>{current ? '✓' : '›'}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      width: '100%',
      maxWidth: 400,
      maxHeight: '70%',
    },
    title: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
      marginBottom: 12,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
      paddingHorizontal: 10,
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      paddingVertical: 8,
    },
    clearButton: {
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    clearButtonText: {
      color: colors.textTertiary,
      fontSize: 14,
    },
    body: {
      maxHeight: 400,
    },
    empty: {
      color: colors.textTertiary,
      fontSize: 14,
      textAlign: 'center',
      padding: 24,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
      padding: 12,
      marginBottom: 6,
    },
    itemActive: {
      borderWidth: 1,
      borderColor: colors.primary,
    },
    itemMain: {
      flex: 1,
      marginRight: 8,
    },
    itemName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
      flexShrink: 1,
    },
    providerBadge: {
      backgroundColor: colors.primary,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    providerBadgeText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '600',
    },
    itemArrow: {
      color: colors.textTertiary,
      fontSize: 20,
    },
  })
```

**Step 4: 运行验证通过**

```bash
cd apps/mobile && npx jest __tests__/ModelPickerModal.test.tsx
```

预期：PASS（9 个用例全绿）

**Step 5: 提交**

```bash
git add apps/mobile/src/components/ModelPickerModal.tsx apps/mobile/__tests__/ModelPickerModal.test.tsx
git commit -m "feat(mobile): ModelPickerModal 组件——两行条目布局+名称/服务商搜索"
```

---

### Task 2: 接入 ChatScreen 并清理旧代码

**Files:**
- Modify: `apps/mobile/src/screens/ChatScreen.tsx`
- Verify: `apps/mobile/__tests__/ChatScreen.test.tsx`（不改，应保持绿）

**Step 1: 跑基线**

```bash
cd apps/mobile && npx jest __tests__/ChatScreen.test.tsx
```

预期：PASS（改动前确认基线是绿的）

**Step 2: ChatScreen 三处修改**

(a) 顶部 import 区：
- 删除 `ScrollView`（仅 picker 使用）
- 新增 `import { ModelPickerModal } from '../components/ModelPickerModal'`

(b) 用组件替换内嵌 Modal（原 451-506 行整段 `<Modal ...>...</Modal>` 删除），在原位置改为：

```tsx
<ModelPickerModal
  visible={modelPickerVisible}
  onClose={() => setModelPickerVisible(false)}
  onSelect={handleSwitchModel}
  models={models}
  currentModel={currentSession?.model ?? null}
/>
```

说明：原 JSX 里 `handleSwitchModel(m)` 是 async 且调用后 `setModelPickerVisible(false)`——关闭动作现在由组件内部 `onSelect` 后自行执行，ChatScreen 侧只需传 `handleSwitchModel` 本身。

(c) styles 清理：删除 `modalOverlay / modelPickerCard / modelPickerTitle / modelPickerBody / modelPickerEmpty / modelPickerItem / modelPickerItemText / modelPickerItemArrow / modelPickerItemLeft / modelPickerItemActive / modelProviderBadge / modelProviderBadgeText` 共 12 个样式项（先 grep 确认无其他引用再删）。

**Step 3: 全量回归**

```bash
cd apps/mobile && npx jest __tests__/ChatScreen.test.tsx __tests__/ModelPickerModal.test.tsx
```

预期：PASS。特别关注两个既有用例：
- 「同名模型跨 provider 时只选中一个 ✓」— 组件内 `(id + providerID)` 匹配逻辑已保留
- 「点击条目按精确 provider 切换」— 测试通过「Text 向上找可点击祖先」交互，新组件条目仍是 TouchableOpacity+Text 结构；断言 `session.switchModel` 收到 `{ id: 'gpt-5', providerID: 'opencode', variant: undefined }` 要求 `handleSwitchModel` 收到完整原始对象（组件回传 `it.raw`）

若既有用例失败，修 ChatScreen 接线而不是改测试语义。

**Step 4: TypeScript 检查**

```bash
cd apps/mobile && npx tsc --noEmit -p tsconfig.json
```

预期：无新增错误（项目存量错误以 git stash 前后对比为准，不要求清零历史问题）

**Step 5: 提交**

```bash
git add apps/mobile/src/screens/ChatScreen.tsx
git commit -m "refactor(mobile): ChatScreen 接入 ModelPickerModal，移除内嵌弹窗与冗余样式"
```

---

### Task 3: 全量单测回归

**Step 1: 跑 mobile 全部单测**

```bash
cd apps/mobile && npx jest --forceExit
```

预期：全部 PASS，无快照/交互回归。

**Step 2: 如有失败**

- 失败涉及 picker 文案（如断言含 'Select Model'）→ 检查是否因组件迁移导致树结构变化，修正测试的选择方式（优先 accessibilityLabel / textOf）
- 其他失败 → 回滚本任务相关提交排查

**Step 3: 最终提交检查**

```bash
git status
```

预期：无杂散文件（日志/截图等）。工作区干净后收工。
