# 聊天 UI 标准化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按 gifted-chat 标准（倒序数据 + inverted FlatList）重写消息列表，并补齐键盘/安全区、scroll-to-bottom、多行输入框、日期分隔符。

**Architecture:** `chatStore` 保持时间正序不动；`MessageList` 内部反转展示数据后交给 inverted FlatList（index 0 = 最新 = 视觉底部），新消息零滚动代码自动贴底。日期分隔符在展示层以纯函数插入。气泡渲染层（MessageItem 等）完全不动。

**Tech Stack:** React Native 0.76.9、Zustand、react-test-renderer + ts-jest。

设计文档：`docs/plans/2026-08-22-chat-ui-standardization-design.md`

---

### Task 1: 日期分隔符纯函数 `buildChatListItems`（TDD）

**Files:**
- Create: `apps/mobile/src/components/chat/dateSeparators.ts`
- Test: `apps/mobile/__tests__/dateSeparators.test.ts`

**Step 1: 写失败测试**

```ts
// apps/mobile/__tests__/dateSeparators.test.ts
import {
  buildChatListItems,
  dayLabel,
  ChatListItem,
} from '../src/components/chat/dateSeparators'
import type { ChatMessage } from '../src/stores/chatStore'

const NOW = new Date('2026-08-22T12:00:00').getTime()
const DAY = 24 * 60 * 60 * 1000

function msg(id: string, created: number, role: ChatMessage['role'] = 'user'): ChatMessage {
  return { id, role, content: id, timestamp: created, status: 'complete', parts: [], created }
}

describe('dayLabel', () => {
  it('labels today', () => {
    expect(dayLabel(NOW, NOW)).toBe('今天')
  })
  it('labels yesterday', () => {
    expect(dayLabel(NOW - DAY, NOW)).toBe('昨天')
  })
  it('labels older same-year date as M月D日', () => {
    expect(dayLabel(new Date('2026-03-05T10:00:00').getTime(), NOW)).toBe('3月5日')
  })
  it('adds year for cross-year dates', () => {
    expect(dayLabel(new Date('2025-12-31T10:00:00').getTime(), NOW)).toBe('2025年12月31日')
  })
})

describe('buildChatListItems', () => {
  it('returns display data newest-first (reversed)', () => {
    const items = buildChatListItems([msg('a', NOW - DAY), msg('b', NOW)], NOW)
    expect(items[0]).toMatchObject({ kind: 'message', key: 'b' })
    expect(items[items.length - 1]).toMatchObject({ kind: 'message', key: 'a' })
  })

  it('inserts one separator at each day boundary', () => {
    // 同一天两条 + 前一天一条 → 2 个分隔符
    const items = buildChatListItems(
      [msg('a', NOW - DAY), msg('b', NOW - 1000), msg('c', NOW - 500)],
      NOW,
    )
    const seps = items.filter((i: ChatListItem) => i.kind === 'separator')
    expect(seps.length).toBe(2)
    expect(seps.map((s: any) => s.label)).toEqual(['今天', '昨天'])
  })

  it('separator sits between the two days in display order', () => {
    const items = buildChatListItems([msg('old', NOW - DAY), msg('new', NOW)], NOW)
    const kinds = items.map((i: ChatListItem) => (i.kind === 'separator' ? 'sep' : i.key))
    expect(kinds).toEqual(['new', 'sep', 'old']) // 底部→顶部
  })

  it('empty input yields empty output', () => {
    expect(buildChatListItems([], NOW)).toEqual([])
  })

  it('falls back to timestamp when created is missing', () => {
    const m: ChatMessage = { id: 'x', role: 'assistant', content: '', timestamp: NOW, status: 'complete', parts: [] }
    const items = buildChatListItems([m], NOW)
    expect(items.some((i) => i.kind === 'separator')).toBe(true)
  })
})
```

**Step 2: 运行确认失败**

Run: `cd apps/mobile && npx jest dateSeparators`
Expected: FAIL — `Cannot find module '../src/components/chat/dateSeparators'`

**Step 3: 最小实现**

```ts
// apps/mobile/src/components/chat/dateSeparators.ts
import type { ChatMessage } from '../../stores/chatStore'

/** FlatList 列表项：消息或日期分隔符 */
export type ChatListItem =
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'separator'; key: string; label: string }

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 今天 / 昨天 / M月D日（跨年加年份） */
export function dayLabel(ts: number, now: number = Date.now()): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS)
  const d = new Date(ts)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/**
 * 输入时间正序消息（chatStore 原始数组），
 * 输出展示序（最新在前）并在每个日界插入分隔符。
 * 分隔符位于"该天第一条消息之前"——反转后即视觉上该天消息的下方。
 */
export function buildChatListItems(
  messages: ChatMessage[],
  now: number = Date.now(),
): ChatListItem[] {
  const out: ChatListItem[] = []
  let prevDay: number | null = null
  for (const m of messages) {
    const ts = m.created ?? m.timestamp
    const day = startOfDay(ts)
    if (prevDay === null || day !== prevDay) {
      out.push({ kind: 'separator', key: `sep_${day}`, label: dayLabel(ts, now) })
      prevDay = day
    }
    out.push({ kind: 'message', key: m.id, message: m })
  }
  return out.reverse()
}
```

**Step 4: 运行确认通过**

Run: `cd apps/mobile && npx jest dateSeparators`
Expected: PASS（全部用例）

**Step 5: Commit**

```bash
git add apps/mobile/src/components/chat/dateSeparators.ts apps/mobile/__tests__/dateSeparators.test.ts
git commit -m "feat(chat): 日期分隔符纯函数 buildChatListItems"
```

---

### Task 2: 重写 MessageList（倒序 + inverted + FAB + 移除下拉刷新）

**Files:**
- Modify: `apps/mobile/src/components/chat/MessageList.tsx`（整文件替换）
- Test: `apps/mobile/__tests__/MessageList.test.ts`（整文件替换）

**Step 1: 重写失败测试**

关键契约变化：
- 新 props：`thinkingIndicator`（视觉底部）、`historyHint`（视觉顶部）；移除 `ListHeader/ListFooter/onRefresh/refreshing`
- `data[0]` 必须是最新消息（倒序）
- FAB：初始隐藏；onScroll y>200 显示；y<200 隐藏

```tsx
// apps/mobile/__tests__/MessageList.test.tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { MessageList, MessageListProps } from '../src/components/chat/MessageList'
import type { ChatMessage } from '../src/stores/chatStore'

const NOW = new Date('2026-08-22T12:00:00').getTime()
const DAY = 24 * 60 * 60 * 1000

let seq = 0
function msg(content: string, created: number, role: ChatMessage['role'] = 'assistant'): ChatMessage {
  seq += 1
  return { id: `m${seq}`, role, content, timestamp: created, status: 'complete', parts: [], created }
}

function buildProps(over: Partial<MessageListProps> = {}): MessageListProps {
  return {
    messages: [],
    renderMessage: (item) => <Text key={item.id}>{item.content}</Text>,
    hasMoreHistory: false,
    historyLoading: false,
    onLoadMoreHistory: jest.fn(),
    ...over,
  }
}

function flatListNode(tree: TestRenderer.ReactTestInstance) {
  return tree.root.findAll((n: any) => n.type === 'FlatList')[0]
}

function textOf(tree: TestRenderer.ReactTestInstance): string {
  let s = ''
  const walk = (node: any) => {
    if (!node) return
    if (typeof node === 'string') { s += node; return }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree.toJSON())
  return s
}

describe('MessageList', () => {
  it('display data is newest-first (index 0 = newest message)', () => {
    const a = msg('older', NOW - DAY)
    const b = msg('newer', NOW - 1000)
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [a, b] })} />)
    })
    const data = flatListNode(tree).props.data
    expect(data[0]).toMatchObject({ kind: 'message', key: b.id })
    expect(data[data.length - 1]).toMatchObject({ kind: 'message', key: a.id })
  })

  it('calls renderMessage once per message, never for separators', () => {
    const renderMessage = jest.fn((item: ChatMessage) => <Text key={item.id}>{item.content}</Text>)
    const a = msg('A', NOW - DAY)
    const b = msg('B', NOW)
    act(() => {
      TestRenderer.create(
        <MessageList {...buildProps({ messages: [a, b], renderMessage })} />,
      )
    })
    expect(renderMessage).toHaveBeenCalledTimes(2)
    expect(renderMessage.mock.calls.every(([m]: any[]) => m.id !== undefined)).toBe(true)
  })

  it('renders date separator labels into the tree', () => {
    const a = msg('A', NOW - DAY)
    const b = msg('B', NOW)
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [a, b] })} />)
    })
    expect(textOf(tree)).toContain('今天')
    expect(textOf(tree)).toContain('昨天')
  })

  it('no separator when all messages are from the same day', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ messages: [msg('A', NOW - 10), msg('B', NOW - 5)] })} />,
      )
    })
    expect(textOf(tree)).not.toContain('今天')
  })

  it('renders empty list safely', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree)).toBeDefined()
  })

  it('keeps inverted prop true', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree).props.inverted).toBe(true)
  })

  it('thinkingIndicator goes to ListHeaderComponent, historyHint to ListFooterComponent', () => {
    const shimmer = <Text>shimmer</Text>
    const hint = <Text>hint</Text>
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ thinkingIndicator: shimmer, historyHint: hint })} />,
      )
    })
    const list = flatListNode(tree)
    expect(list.props.ListHeaderComponent).toBe(shimmer)
    expect(list.props.ListFooterComponent).toBe(hint)
  })

  it('does not expose pull-to-refresh props anymore', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    const list = flatListNode(tree)
    expect(list.props.refreshing).toBeUndefined()
    expect(list.props.onRefresh).toBeUndefined()
  })

  it('loads more history when end reached and hasMore && !loading', () => {
    const onLoadMore = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: true, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree).props.onEndReached() })
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not load more while loading or when exhausted', () => {
    const onLoadMore = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: true, historyLoading: true, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree).props.onEndReached() })
    expect(onLoadMore).not.toHaveBeenCalled()

    let tree2!: TestRenderer.ReactTestInstance
    act(() => {
      tree2 = TestRenderer.create(
        <MessageList {...buildProps({ hasMoreHistory: false, onLoadMoreHistory: onLoadMore })} />,
      )
    })
    act(() => { flatListNode(tree2).props.onEndReached() })
    expect(onLoadMore).toHaveBeenCalledTimes(1) // 仍是第一次的计数
  })

  it('FAB hidden by default, shown when scrolled >200 away, hides again near bottom', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps({ messages: [msg('A', NOW)] })} />)
    })
    expect(textOf(tree)).not.toContain('Scroll to latest')

    const list = flatListNode(tree)
    act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 260 } } })
    })
    expect(textOf(tree)).toContain('Scroll to latest')

    act(() => {
      list.props.onScroll({ nativeEvent: { contentOffset: { y: 30 } } })
    })
    expect(textOf(tree)).not.toContain('Scroll to latest')
  })

  it('maintainVisibleContentPosition configured', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(<MessageList {...buildProps()} />)
    })
    expect(flatListNode(tree).props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
  })
})
```

注意：`now` 参数——`buildChatListItems` 默认 `Date.now()`。测试里消息用相对 `Date.now()` 的偏移更稳：

```ts
const NOW = Date.now()  // 测试文件顶部改为动态取值，避免跨天 flake
```

（上面示例中的固定 NOW 仅示意；实际写测试时用 `Date.now()`。）

**Step 2: 运行确认失败**

Run: `cd apps/mobile && npx jest MessageList`
Expected: FAIL — props 类型不匹配 / `thinkingIndicator` 不存在等编译错误（ts-jest diagnostics）

**Step 3: 整文件重写实现**

```tsx
// apps/mobile/src/components/chat/MessageList.tsx
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ChatMessage } from '../../stores/chatStore'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'
import { buildChatListItems, ChatListItem } from './dateSeparators'

export interface MessageListProps {
  /** chatStore 原始正序消息（旧→新），组件内部负责反转为展示序 */
  messages: ChatMessage[]
  renderMessage: (item: ChatMessage) => React.ReactElement
  /** 视觉底部附件（最新消息下方），如 ThinkingShimmer */
  thinkingIndicator?: React.ReactElement
  /** 视觉顶部附件（最旧消息上方），如"上滑加载更早"提示 */
  historyHint?: React.ReactElement
  hasMoreHistory: boolean
  historyLoading: boolean
  onLoadMoreHistory: () => void
}

/** 距底部超过该像素视为"离开底部"，显示回底按钮 */
const SCROLL_BACK_THRESHOLD = 200

/**
 * inverted FlatList 聊天列表（gifted-chat 标准方案）
 *
 * - 展示数据倒序（最新在 index 0）+ inverted 镜像 → 最新消息天然在视觉底部
 * - 新消息追加到 store 数组末尾 = 展示数组 index 0 → 自动出现在底部，零滚动代码
 * - 流式更新就地改 index 0，offset≈0 时内容自然入视口
 * - 上滑加载历史：append 到展示数组末尾 = 视觉顶部，索引无位移不跳动
 * - maintainVisibleContentPosition 兜住新消息插入时的视口锚定
 */
export const MessageList: React.FC<MessageListProps> = (props) => {
  const {
    messages,
    renderMessage,
    thinkingIndicator,
    historyHint,
    hasMoreHistory,
    historyLoading,
    onLoadMoreHistory,
  } = props

  const colors = useThemeColors()
  const styles = makeStyles(colors)

  const flatListRef = useRef<FlatList<ChatListItem>>(null)
  const [showBackToBottom, setShowBackToBottom] = useState(false)

  const listData = useMemo(() => buildChatListItems(messages), [messages])

  const maybeLoadMoreHistory = useCallback(() => {
    if (hasMoreHistory && !historyLoading) onLoadMoreHistory()
  }, [hasMoreHistory, historyLoading, onLoadMoreHistory])

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y
    setShowBackToBottom(y > SCROLL_BACK_THRESHOLD)
  }, [])

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.kind === 'separator') {
        return (
          <View style={styles.separatorRow}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>{item.label}</Text>
            <View style={styles.separatorLine} />
          </View>
        )
      }
      return renderMessage(item.message)
    },
    [renderMessage, styles],
  )

  const keyExtractor = useCallback((item: ChatListItem) => item.key, [])

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={flatListRef}
        data={listData}
        inverted
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={thinkingIndicator}
        ListFooterComponent={historyHint}
        onEndReached={maybeLoadMoreHistory}
        onEndReachedThreshold={0.2}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        style={styles.list}
      />
      {showBackToBottom && (
        <TouchableOpacity
          style={styles.fab}
          onPress={scrollToBottom}
          accessibilityLabel="Scroll to latest"
        >
          <Text style={styles.fabText}>↓</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
    },
    list: {
      flex: 1,
    },
    separatorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    separatorLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    separatorText: {
      color: colors.textTertiary,
      fontSize: 11,
      marginHorizontal: 8,
    },
    fab: {
      position: 'absolute',
      right: 16,
      bottom: 16,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceVariant,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fabText: {
      color: colors.text,
      fontSize: 18,
    },
  })
```

**Step 4: 运行确认通过**

Run: `cd apps/mobile && npx jest MessageList`
Expected: PASS（全部用例）

**Step 5: Commit**

```bash
git add apps/mobile/src/components/chat/MessageList.tsx apps/mobile/__tests__/MessageList.test.tsx
git commit -m "refactor(chat): MessageList 重写为倒序数据 + inverted 标准方案，含回底按钮与日期分隔符"
```

---

### Task 3: MainLayout 导出 TAB_BAR_HEIGHT + 安全区

**Files:**
- Modify: `apps/mobile/src/components/MainLayout.tsx`
- Test: `apps/mobile/__tests__/MainLayout.test.tsx`（如有断言根节点为 View 则适配）

**Step 1: 先看现有 MainLayout 测试对根节点的断言**

Run: `cd apps/mobile && npx jest MainLayout`
Expected: 记录当前通过基线；若测试查找 `SafeAreaView` 无关则无需改动测试。

**Step 2: 修改 MainLayout.tsx**

1. 导入改为：

```tsx
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
```

2. 文件顶部（`makeStyles` 之前）导出常量：

```tsx
/** Tab bar 总高度（含 padding/border）。供 ChatScreen 计算 iOS 键盘 offset 使用。 */
export const TAB_BAR_HEIGHT = 60
```

3. 根节点 `<View style={styles.root}>` 改为 `<SafeAreaView style={styles.root}>`，对应闭合标签同步改。RN 内置 SafeAreaView 在 Android 上等效普通 View（本项目非 edge-to-edge，行为不变）。

**Step 3: 运行测试确认通过**

Run: `cd apps/mobile && npx jest MainLayout`
Expected: PASS（若原测试断言根组件类型为 `'View'`，把断言改为接受 `SafeAreaView` 或按 mock 行为适配）

**Step 4: Commit**

```bash
git add apps/mobile/src/components/MainLayout.tsx apps/mobile/__tests__/MainLayout.test.tsx
git commit -m "refactor(layout): MainLayout 根部 SafeAreaView + 导出 TAB_BAR_HEIGHT 常量"
```

---

### Task 4: ChatScreen 接线（键盘 offset / 多行输入 / 新 props）

**Files:**
- Modify: `apps/mobile/src/screens/ChatScreen.tsx`
- Test: `apps/mobile/__tests__/ChatScreen.test.tsx`

**Step 1: 更新受影响的测试（先写失败测试）**

1. **替换** `it('onSubmitEditing triggers send', ...)`（约 L342）为：

```tsx
it('input is multiline and has no submit-on-enter path', async () => {
  // 复用文件内既有的渲染辅助函数渲染带 activeSession 的 ChatScreen
  const tree = await renderActiveChat()
  const inputs = tree.root.findAll(
    (n: any) => n.type === 'TextInput' && n.props.placeholder === 'Type a message...',
  )
  expect(inputs.length).toBe(1)
  expect(inputs[0].props.multiline).toBe(true)
  expect(inputs[0].props.onSubmitEditing).toBeUndefined()
})
```

（`renderActiveChat` 换成该测试文件里实际的渲染 helper 名称——先读文件头部确认复用方式，不要新建平行 helper。）

2. 若存在断言 `refreshing`/`onRefresh` 传给 MessageList 的用例则删除（下拉刷新已移除）；标题栏 ↻ 的 `handleRefresh` 用例保留。

3. 断言 `ThinkingShimmer` 出现的用例（L65 `renders waiting indicator`）：若它通过文本/testID 查找且仍能命中（shimmer 经 `thinkingIndicator` 渲染进 FlatList header），无需改动；跑一遍确认。

**Step 2: 运行确认新测试失败**

Run: `cd apps/mobile && npx jest ChatScreen`
Expected: 新用例 FAIL（当前单行 + 有 onSubmitEditing），其余记录基线。

**Step 3: 修改 ChatScreen.tsx**

1. 导入：

```tsx
import { MessageList } from '../components/chat/MessageList'
import { TAB_BAR_HEIGHT } from '../components/MainLayout'
```

2. `KeyboardAvoidingView` 的 offset 引用常量：

```tsx
keyboardVerticalOffset={Platform.OS === 'ios' ? TAB_BAR_HEIGHT + 8 : 0}
```

3. 输入框改为多行、仅按钮发送：

```tsx
<TextInput
  ref={inputRef}
  style={styles.input}
  value={inputText}
  onChangeText={(t) => {
    setInputText(t)
    if (t.endsWith('/')) { setSlashFilter('/'); setSlashSheetVisible(true) }
    else if (t.endsWith('@')) { setSlashFilter('@'); setSlashSheetVisible(true) }
  }}
  placeholder="Type a message..."
  placeholderTextColor={colors.textTertiary}
  multiline
  editable={!waiting}
  accessibilityLabel="Type a message..."
/>
```

（删除 `returnKeyType="send"`、`onSubmitEditing`、原 `multiline={false}`。slash 过滤的第三个分支原本就是空操作，一并删除。）

4. `styles.input` 增加：

```ts
input: {
  flex: 1,
  color: colors.text,
  fontSize: 15,
  paddingVertical: 8,
  minHeight: 36,
  maxHeight: 120,
},
```

5. `inputContainer` 的 `alignItems: 'center'` 改为 `'flex-end'`（输入框长高时按钮贴底，标准聊天布局）。

6. MessageList 调用处改为新接口（移除下拉刷新相关 props 与 `refreshing` state；`handleRefresh` 保留给标题栏 ↻）：

```tsx
<MessageList
  messages={messages}
  renderMessage={renderMessage}
  thinkingIndicator={waiting ? <ThinkingShimmer /> : undefined}
  historyHint={hasMoreHistory ? (
    <View style={{ padding: 12, alignItems: 'center' }}>
      <Text style={{ color: colors.textTertiary, fontSize: 12 }}>
        {historyLoading ? '加载更早消息...' : '上滑加载更早消息'}
      </Text>
    </View>
  ) : undefined}
  hasMoreHistory={hasMoreHistory}
  historyLoading={historyLoading}
  onLoadMoreHistory={handleLoadMoreHistory}
/>
```

7. 删除不再使用的 `refreshing` state 及 `setRefreshing`；`handleRefresh` 里去掉 `setRefreshing` 调用。

**Step 4: 运行 ChatScreen 测试确认全绿**

Run: `cd apps/mobile && npx jest ChatScreen`
Expected: PASS（含替换后的新用例）

**Step 5: Commit**

```bash
git add apps/mobile/src/screens/ChatScreen.tsx apps/mobile/__tests__/ChatScreen.test.tsx
git commit -m "feat(chat): ChatScreen 多行输入框 + TAB_BAR_HEIGHT 键盘 offset + MessageList 新 props"
```

---

### Task 5: 全量回归

**Step 1: 全量单测**

Run: `cd apps/mobile && npx jest`
Expected: 全部 PASS。重点观察 `interaction.test.tsx`、`components.test.tsx`、`MainLayout.test.tsx` 是否受 MessageList props 变化波及；受影响处按 Task 2/4 的契约适配（只改断言方式，不改产品语义）。

**Step 2: Lint**

Run: `cd apps/mobile && npm run lint`
Expected: 0 error（warning 维持现状水平）

**Step 3: 真机冒烟（手动清单，需模拟器 + Bridge 已起）**

- 打开会话：最新消息在视觉底部，出现"今天"分隔符
- 发消息：自动出现在底部，流式输出贴底滚动
- 上滑：出现 ↓ 按钮；点它回到底部
- 继续上滑到最旧："上滑加载更早消息"提示在顶部触发加载
- 键盘弹出：输入框随键盘抬升（Android adjustResize / iOS padding）
- 输入多行文字：输入框长高至 ~120px 后内部滚动，➤ 按钮贴右下

**Step 4: Commit（若有适配改动）**

```bash
git add -A apps/mobile
git commit -m "test(chat): 全量回归适配"
```

---

## 明确不做（YAGNI）

- vector 图标替换、未读徽标、本地持久化、chatStore reducer 改动、气泡层组件改动
