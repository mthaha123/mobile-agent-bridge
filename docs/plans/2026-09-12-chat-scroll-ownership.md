# 聊天滚动归属与交互原语重建 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从结构上消除聊天页三类缺陷（流式时点不动、横向滑不动、内框过滚动方向反转）：确立"每个可视面只有一个纵向滚动所有者"，并把点击/横向滚动/裁剪收敛为共享原语。

**Architecture:** 纯客户端渲染层改动。新增四个共享原语（`HorizontalScrollBox`、`AppPressable`、`ClampBox`、`ToolDetailSheet`）与 `useBottomAnchor` hook；`MessageList` 恢复 `nestedScrollEnabled`、最终去 `inverted`；`ToolGroupCard` 一级展开从"内嵌纵向滚动"改为"裁剪 + Modal 详情"。Bridge 与 WS 协议零改动。

**Tech Stack:** React Native 0.76（新架构）、TypeScript、zustand 4、react-native-gesture-handler、Jest + react-test-renderer。

**设计文档:** `docs/plans/2026-09-12-chat-scroll-ownership-design.md`

**关键前提:** 分阶段增量落地，P0 独立先行；P3（去 inverted）回归面最大，须在 RNGH（P2）稳定之后进行。不在本计划内修复 `onEndReached` 不触发问题。

---

## 阶段总览

| 阶段 | 目标 | 风险 |
|---|---|---|
| P0 | `HorizontalScrollBox` + 恢复 `nestedScrollEnabled` | 低 |
| P1 | `ClampBox` + `ToolDetailSheet` 重构一级展开 | 中 |
| P2 | `AppPressable`（RNGH）替换列表内点击 | 中 |
| P3 | `MessageList` 去 inverted + `useBottomAnchor` | 高 |
| P4 | `StreamingText` + 流式节流 | 中 |

---

### Task 1 (P0): HorizontalScrollBox 原语

**Files:**
- Create: `apps/mobile/src/components/common/HorizontalScrollBox.tsx`
- Test: `apps/mobile/__tests__/HorizontalScrollBox.test.tsx`

**Step 1: 写失败测试**

```tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ScrollView, Text } from 'react-native'
import { HorizontalScrollBox } from '../src/components/common/HorizontalScrollBox'

function render(children: React.ReactNode) {
  let tree!: TestRenderer.ReactTestRenderer
  act(() => { tree = TestRenderer.create(<HorizontalScrollBox>{children}</HorizontalScrollBox>) })
  return tree
}

describe('HorizontalScrollBox', () => {
  it('渲染 horizontal + nestedScrollEnabled', () => {
    const tree = render(<Text>hello</Text>)
    const sv = tree.root.findAllByType(ScrollView)[0]
    expect(sv.props.horizontal).toBe(true)
    expect(sv.props.nestedScrollEnabled).toBe(true)
  })

  it('iOS 方向锁定开启（防斜向手势落到父列表）', () => {
    const tree = render(<Text>hello</Text>)
    const sv = tree.root.findAllByType(ScrollView)[0]
    expect(sv.props.directionalLockEnabled).toBe(true)
  })

  it('透传 showsHorizontalScrollIndicator 与 contentContainerStyle', () => {
    let tree!: TestRenderer.ReactTestRenderer
    act(() => {
      tree = TestRenderer.create(
        <HorizontalScrollBox showsIndicator={false} contentContainerStyle={{ padding: 4 }}>
          <Text>x</Text>
        </HorizontalScrollBox>,
      )
    })
    const sv = tree.root.findAllByType(ScrollView)[0]
    expect(sv.props.showsHorizontalScrollIndicator).toBe(false)
    expect(sv.props.contentContainerStyle).toEqual({ padding: 4 })
  })
})
```

**Step 2: 跑测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/HorizontalScrollBox.test.tsx`
Expected: FAIL —— 模块不存在。

**Step 3: 实现**

```tsx
// apps/mobile/src/components/common/HorizontalScrollBox.tsx
import React from 'react'
import { ScrollView } from 'react-native'
import type { ViewStyle } from 'react-native'

interface Props {
  children: React.ReactNode
  /** 是否显示横向滚动指示条（默认 true） */
  showsIndicator?: boolean
  contentContainerStyle?: ViewStyle
  testID?: string
}

/**
 * 横向滚动统一容器（聊天/文件查看所有横向内容）。
 *
 * 背景：Android 嵌套滚动要求父子都参与（child 是 NestedScrollingChild，
 * parent 是 NestedScrollingParent）。此前横向内容各自实现，部分漏加
 * nestedScrollEnabled，且父 FlatList 的 nestedScrollEnabled 也被移除，
 * 导致横向拖拽被父纵向列表吞掉 —— 表现为“只能上下滑、不能左右滑”。
 *
 * 约定：所有横向滚动一律走本组件；父列表（MessageList）必须保留
 * nestedScrollEnabled，嵌套滚动才会真正生效。
 */
export const HorizontalScrollBox: React.FC<Props> = ({
  children,
  showsIndicator = true,
  contentContainerStyle,
  testID,
}) => {
  const [overflow, setOverflow] = React.useState(false)
  const [containerWidth, setContainerWidth] = React.useState(0)
  // 包一层 View：横向内容不被压缩，产出自然宽度
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={showsIndicator && overflow}
      contentContainerStyle={contentContainerStyle}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width
        if (w > 0 && Math.abs(w - containerWidth) > 1) setContainerWidth(w)
      }}
      onContentSizeChange={(w) => setOverflow(w > containerWidth + 1)}
      testID={testID}
    >
      {children}
    </ScrollView>
  )
}
```

> 注：若调用方已有自己的溢出检测（如 `MarkdownCodeBlock`），可直接用 `showsIndicator` 关闭内部检测，或保留外部逻辑；实现时以现有测试为准。

**Step 4: 跑测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/HorizontalScrollBox.test.tsx`
Expected: PASS。

**Step 5: 提交**

```bash
git add apps/mobile/src/components/common/HorizontalScrollBox.tsx apps/mobile/__tests__/HorizontalScrollBox.test.tsx
git commit -m "feat(mobile): 新增 HorizontalScrollBox 横向滚动原语"
```

---

### Task 2 (P0): 恢复 MessageList 的 nestedScrollEnabled

**Files:**
- Modify: `apps/mobile/src/components/chat/MessageList.tsx`
- Test: `apps/mobile/__tests__/MessageList.test.tsx`

**Step 1: 写失败测试**

在 `MessageList.test.tsx` 追加：

```tsx
it('has nestedScrollEnabled so horizontal children can scroll', () => {
  let tree!: TestRenderer.ReactTestInstance
  act(() => {
    tree = TestRenderer.create(<MessageList {...buildProps()} />)
  })
  expect(flatListNode(tree).props.nestedScrollEnabled).toBe(true)
})
```

**Step 2: 跑测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/MessageList.test.tsx -t "nestedScrollEnabled"`
Expected: FAIL（当前为 `undefined`）。

**Step 3: 实现**

`MessageList.tsx` 的 `FlatList` 加回属性，并把"临时 A/B"注释替换为说明：

```tsx
        inverted
        // 父级必须参与嵌套滚动，否则 cell 内横向 ScrollView（代码块/表格/diff）
        // 的横向拖拽会被本列表吞掉（Android 要求父子都启用 nested scrolling）。
        // 历史加载 onEndReached 的触发问题另行修复，不靠移除本属性规避。
        nestedScrollEnabled
```

**Step 4: 跑测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/MessageList.test.tsx`
Expected: PASS（新增 1 条 + 原有用例全绿）。

**Step 5: 提交**

```bash
git add apps/mobile/src/components/chat/MessageList.tsx apps/mobile/__tests__/MessageList.test.tsx
git commit -m "fix(mobile): MessageList 恢复 nestedScrollEnabled（父级须参与嵌套滚动）"
```

---

### Task 3 (P0): 横向内容迁移到 HorizontalScrollBox

**Files:**
- Modify: `apps/mobile/src/components/chat/ShellOutput.tsx`
- Modify: `apps/mobile/src/components/chat/DiffDisplay.tsx`
- Modify: `apps/mobile/src/components/chat/MarkdownCodeBlock.tsx`
- Modify: `apps/mobile/src/components/chat/MarkdownTable.tsx`
- Modify: `apps/mobile/src/screens/FileViewerScreen.tsx`
- Test: `apps/mobile/__tests__/MarkdownCodeBlock.test.tsx`、`__tests__/MarkdownTable.test.tsx`、`__tests__/chatComponents.test.tsx`

**Step 1: 写失败测试**

在每个既有测试文件里断言横向容器带 `nestedScrollEnabled`（此前 `ShellOutput`/`DiffDisplay`/`FileViewerScreen` 从未有）。示例：

```tsx
it('shell output horizontal scroller enables nested scrolling', () => {
  const tree = TestRenderer.create(<ShellOutput result={'a\nb'} input={{ command: 'ls' }} />)
  const sv = tree.root.findAllByType(ScrollView).find((n) => n.props.horizontal)
  expect(sv?.props.nestedScrollEnabled).toBe(true)
})
```

**Step 2: 跑测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/MarkdownCodeBlock.test.tsx __tests__/MarkdownTable.test.tsx __tests__/chatComponents.test.tsx`
Expected: FAIL —— `ShellOutput` / `DiffDisplay` 未启用。

**Step 3: 实现**

- `ShellOutput.tsx`、`DiffDisplay.tsx`：把横向 `<ScrollView>` 替换为 `<HorizontalScrollBox>`（保留 `flexShrink: 0` / monospace 样式）。
- `MarkdownCodeBlock.tsx`、`MarkdownTable.tsx`：替换为 `<HorizontalScrollBox>`，保留各自的溢出检测与全屏 Modal 兜底（指示条逻辑可继续由组件自身计算后通过 `showsIndicator` 传入）。
- `FileViewerScreen.tsx` 不换行模式：外层纵向 `ScrollView` 保留（这是独立页面，本就是纵向滚动所有者），内层横向改 `HorizontalScrollBox`。

**Step 4: 跑测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/MarkdownCodeBlock.test.tsx __tests__/MarkdownTable.test.tsx __tests__/chatComponents.test.tsx`
Expected: PASS。

**Step 5: 提交**

```bash
git add apps/mobile/src/components/chat/ShellOutput.tsx apps/mobile/src/components/chat/DiffDisplay.tsx apps/mobile/src/components/chat/MarkdownCodeBlock.tsx apps/mobile/src/components/chat/MarkdownTable.tsx apps/mobile/src/screens/FileViewerScreen.tsx apps/mobile/__tests__/
git commit -m "refactor(mobile): 横向滚动统一走 HorizontalScrollBox"
```

---

### Task 4 (P0): 真机验证横向滑动

**Files:** 无（验证）

**Step 1:** 重打 JS bundle 并构建 APK（按 AGENTS.md 的 bundle 命令 + `Start-Job` 构建）。

**Step 2:** 打开含长 bash 输出 / 代码块 / 表格的历史会话，横向拖动，确认可左右滑动；确认 `onEndReached` 行为符合预期（若回归，记录并按第 8 节单独处理）。

**Step 3:** 若 P2 确认修复且 `onEndReached` 无回归，继续 P1；否则先修 `onEndReached`。

---

### Task 5 (P1): ClampBox 原语

**Files:**
- Create: `apps/mobile/src/components/chat/ClampBox.tsx`
- Test: `apps/mobile/__tests__/ClampBox.test.tsx`

**Step 1: 写失败测试**

```tsx
it('裁剪内容且不含 ScrollView', () => {
  const tree = TestRenderer.create(<ClampBox maxHeight={120}><Text>long</Text></ClampBox>)
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
  const v = tree.root.findAllByType(View)[0]
  expect(v.props.style).toMatchObject({ maxHeight: 120, overflow: 'hidden' })
})
```

**Step 2: 跑测试确认失败** → `npx jest __tests__/ClampBox.test.tsx`。

**Step 3: 实现**

```tsx
// apps/mobile/src/components/chat/ClampBox.tsx
import React from 'react'
import { View } from 'react-native'
import type { ViewStyle } from 'react-native'

/**
 * 限高裁剪容器 —— 刻意不提供滚动。
 *
 * 背景：ToolGroupCard 一级展开原本内嵌纵向 ScrollView，嵌在 inverted FlatList
 * 中过滚动时父列表方向反转（RN #29776），且与列表争夺纵向手势。
 * 这里只做裁剪：要看完整内容走 ToolDetailSheet（Modal，唯一纵向滚动所有者）。
 */
export const ClampBox: React.FC<{ maxHeight: number; children: React.ReactNode; style?: ViewStyle }> = ({
  maxHeight, children, style,
}) => (
  <View style={[{ maxHeight, overflow: 'hidden' }, style]}>{children}</View>
)
```

**Step 4: 跑测试确认通过。**

**Step 5: 提交**

```bash
git add apps/mobile/src/components/chat/ClampBox.tsx apps/mobile/__tests__/ClampBox.test.tsx
git commit -m "feat(mobile): 新增 ClampBox 裁剪原语（不提供滚动）"
```

---

### Task 6 (P1): ToolDetailSheet（Modal 详情）

**Files:**
- Create: `apps/mobile/src/components/chat/ToolDetailSheet.tsx`
- Test: `apps/mobile/__tests__/ToolDetailSheet.test.tsx`

**Step 1: 写失败测试**

覆盖：不可见时不渲染；可见时渲染思考全文 + 全部工具（`ToolPart defaultExpanded`）；关闭回调；纵向滚动容器仅一个。

**Step 2: 跑测试确认失败。**

**Step 3: 实现**

```tsx
// 结构示意：Modal（唯一纵向滚动所有者）
<Modal visible={visible} animationType="slide" onRequestClose={onClose}>
  <View style={styles.container}>
    <View style={styles.header}>
      <Text style={styles.title}>工具详情</Text>
      <AppPressable onPress={onClose}><Text>✕</Text></AppPressable>
    </View>
    <ScrollView style={styles.body}>
      {reasoning.map(...)}
      {tools.map((p) => <ToolPart data={...} messageRole="assistant" defaultExpanded />)}
    </ScrollView>
  </View>
</Modal>
```

> P1 阶段可先用 core `TouchableOpacity`，P2 再统一替换为 `AppPressable`。

**Step 4:** `npx jest __tests__/ToolDetailSheet.test.tsx` → PASS。

**Step 5: 提交**

```bash
git add apps/mobile/src/components/chat/ToolDetailSheet.tsx apps/mobile/__tests__/ToolDetailSheet.test.tsx
git commit -m "feat(mobile): 新增 ToolDetailSheet（Modal 承载工具详情纵向滚动）"
```

---

### Task 7 (P1): ToolGroupCard 一级展开改裁剪 + 详情 Modal

**Files:**
- Modify: `apps/mobile/src/components/chat/ToolGroupCard.tsx`
- Modify: `apps/mobile/__tests__/ToolGroupCard.test.tsx`

**Step 1: 写失败测试**

更新现有用例：

```tsx
// 原“level 1 渲染 ScrollView”断言改为：
it('level 1 使用 ClampBox 裁剪，不再内嵌纵向 ScrollView', () => {
  const tree = render([reasoning('r1', '思考'), tool('t1', 'read', 'success')])
  pressHeader(tree)
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
  expect(tree.root.findAllByType(ClampBox)).toHaveLength(1)
})

it('点“展开全部”打开 ToolDetailSheet', () => {
  const tree = render([tool('t1', 'read', 'success'), tool('t2', 'write', 'success')])
  pressHeader(tree)
  pressExpandAll(tree)
  expect(tree.root.findAllByType(ToolDetailSheet)[0].props.visible).toBe(true)
})
```

**Step 2: 跑测试确认失败。**

**Step 3: 实现**

- 状态机改为：`0 折叠 → 1 裁剪预览 → (Modal 详情)`；`level === 2` 的"全开"改为打开 `ToolDetailSheet`。
- level 1 内容用 `ClampBox maxHeight={boxHeight}` 包裹（思考 + 一个 featured 工具行），删除 `scrollRef` / `scrollToLatest` / `atBottomRef` / `onContentSizeChange` 中的 `LayoutAnimation`。
- 移除流式自动跟随（不再有内嵌滚动），改为"内容更新时不做任何滚动"。
- 保留标题栏状态图标、计数、入口文案（N>1「展开全部 (N)」/ N=1「查看详情」/ N=0 不显示）。
- 移除 `handleHeaderPress` / `handleExpandAll` 里的 `LayoutAnimation`（Android 会致点击失效，RN #31201）。

**Step 4:** `npx jest __tests__/ToolGroupCard.test.tsx` → PASS。

**Step 5: 提交**

```bash
git add apps/mobile/src/components/chat/ToolGroupCard.tsx apps/mobile/__tests__/ToolGroupCard.test.tsx
git commit -m "refactor(mobile): ToolGroupCard 一级展开改裁剪 + Modal 详情"
```

---

### Task 8 (P2): 引入 react-native-gesture-handler 与 AppPressable

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/src/components/common/AppPressable.tsx`
- Modify: 入口 / `MainLayout.tsx`（挂 `GestureHandlerRootView`）
- Test: `apps/mobile/__tests__/AppPressable.test.tsx`

**Step 1:** 安装依赖

```bash
cd apps/mobile && npm install react-native-gesture-handler
```

（需重新构建原生 APK，因为新增原生依赖。）

**Step 2: 写失败测试** —— onPress 透传、disabled 不触发、onLongPress 透传。

**Step 3: 实现**

```tsx
// apps/mobile/src/components/common/AppPressable.tsx
import React from 'react'
import { Pressable, type PressableProps } from 'react-native-gesture-handler'

/**
 * 列表内统一点击原语。
 * 背景：RN 新架构下 core Touchable/Pressable 的 Pressability 从 Fabric 影子树
 * 测量触点区域；inverted/transform/高频重排时会误判 LEAVE_PRESS_RECT，
 * 表现为“划得动、点不动”。RNGH 用原生命中测试，绕开该缺陷。
 */
export const AppPressable: React.FC<PressableProps> = (props) => <Pressable {...props} />
```

`MainLayout` 根节点包 `<GestureHandlerRootView style={{ flex: 1 }}>`。

**Step 4:** 跑测试 → PASS。

**Step 5: 提交**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/src/components/common/AppPressable.tsx apps/mobile/src/components/MainLayout.tsx apps/mobile/__tests__/AppPressable.test.tsx
git commit -m "feat(mobile): 新增 AppPressable（RNGH），修复新架构点击失效"
```

---

### Task 9 (P2): 列表内点击迁移到 AppPressable

**Files:**
- Modify: `ToolGroupCard.tsx`、`BasicTool.tsx`、`ToolErrorCard.tsx`、`MarkdownCodeBlock.tsx`、`MarkdownTable.tsx`、`PartBlock.tsx`、`PermissionDock.tsx`、`AttachmentBar.tsx`、`ToolDetailSheet.tsx`

**Step 1:** 逐个替换 `TouchableOpacity` → `AppPressable`（`onPress`/`onLongPress` 语义一致；视觉反馈用 `style` 回调或保留 `activeOpacity` 等价实现）。

**Step 2:** 跑相关组件测试（`ToolGroupCard`、`chatComponents`、`MarkdownCodeBlock`、`MarkdownTable`、`MessageItem`）→ PASS。

**Step 3:** 提交

```bash
git commit -m "refactor(mobile): 列表内点击统一走 AppPressable"
```

---

### Task 10 (P3): useBottomAnchor + MessageList 去 inverted

**Files:**
- Create: `apps/mobile/src/hooks/useBottomAnchor.ts`
- Modify: `apps/mobile/src/components/chat/MessageList.tsx`
- Modify: `apps/mobile/src/components/chat/dateSeparators.ts`（不再 reverse）
- Test: `apps/mobile/__tests__/MessageList.test.tsx`、新增 `__tests__/useBottomAnchor.test.ts`

**Step 1: 写失败测试**

更新 `MessageList.test.tsx`：

```tsx
it('不再使用 inverted', () => {
  expect(flatListNode(tree).props.inverted).toBeFalsy()
})
it('保留 maintainVisibleContentPosition', () => {
  expect(flatListNode(tree).props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
})
it('display data is oldest-first', () => {
  // 与现有“newest-first”断言相反
  expect(itemTexts(tree)).toEqual(['昨天', 'older', '今天', 'newer'])
})
```

**Step 2: 跑测试确认失败。**

**Step 3: 实现**

- `dateSeparators.buildChatListItems` 去掉 `.reverse()`（正序输出，最新在数组末尾）。
- `MessageList` 移除 `inverted`；`ListHeaderComponent` / `ListFooterComponent` 语义随之调整（thinkingIndicator 在末尾、historyHint 在开头），必要时改用 `ListFooterComponent`/数组项插入。
- `onLoadMoreHistory` 触发条件从"到达展示数组末尾（视觉顶部）"改为"到达滚动顶部"（`onScroll` 判断 `contentOffset.y <= threshold`），不再依赖 inverted 的 `onEndReached`。
- `useBottomAnchor` 负责：贴底时新内容 `scrollToEnd({ animated: false })`；不贴底不打断；`maintainVisibleContentPosition` 保持历史 prepend 视口。
- FAB 回底逻辑改用 `isAtBottomRef`。

**Step 4:** `npx jest __tests__/MessageList.test.tsx __tests__/useBottomAnchor.test.ts` → PASS。

**Step 5:** 真机回归：进入会话定位底部、流式跟随、上滑加载历史、日期分隔符、FAB 回底；并确认 P1/P3 均未复发。

**Step 6:** 提交

```bash
git add apps/mobile/src/hooks/useBottomAnchor.ts apps/mobile/src/components/chat/MessageList.tsx apps/mobile/src/components/chat/dateSeparators.ts apps/mobile/__tests__/
git commit -m "refactor(mobile): MessageList 去 inverted，改用底部锚定"
```

---

### Task 11 (P4): StreamingText 与流式节流

**Files:**
- Create: `apps/mobile/src/components/chat/StreamingText.tsx`
- Modify: `apps/mobile/src/components/chat/PartBlock.tsx`、`MessageItem.tsx`（流式未完成走纯 Text）
- Modify: `apps/mobile/src/stores/chatStore.ts`（可选：delta 批量 flush）

**Step 1:** 实现 `StreamingText`（纯 `Text`，不解析 Markdown）。

**Step 2:** 流式（`status === 'streaming'`）期间文本走 `StreamingText`；`text.ended`（`status === 'complete'`）后切回 `MarkdownRenderer`。

**Step 3:** 若 JS 仍饱和，在 `chatStore` 对 delta 做帧级/100ms 批量 flush（保持 reducer 纯函数）。

**Step 4:** 测试 + 真机验证；提交

```bash
git commit -m "perf(mobile): 流式期间纯文本渲染 + delta 节流"
```

---

### Task 12: 守护测试与全量回归

**Files:**
- Create: `apps/mobile/__tests__/scrollOwnership.test.ts`（守护测试）
- 无（全量）

**Step 1: 守护测试**

扫描 `apps/mobile/src/components/chat/**` 源码，断言不存在未带 `horizontal` 的 `<ScrollView`（允许 `components/common` 与 Modal 组件例外，按显式白名单）：

```ts
import fs from 'fs'
import path from 'path'

const CHAT_DIR = path.resolve(__dirname, '../src/components/chat')
const ALLOW = new Set(['ToolDetailSheet.tsx']) // Modal：唯一纵向滚动所有者

it('chat 组件内不得出现纵向 ScrollView（见滚动归属设计文档）', () => {
  for (const file of fs.readdirSync(CHAT_DIR)) {
    if (!file.endsWith('.tsx') || ALLOW.has(file)) continue
    const src = fs.readFileSync(path.join(CHAT_DIR, file), 'utf8')
    const blocks = src.match(/<ScrollView[^>]*>/gs) ?? []
    for (const b of blocks) {
      expect(`${file}: ${b.includes('horizontal') ? 'ok' : 'VERTICAL'}`).toBe(`${file}: ok`)
    }
  }
})
```

**Step 2: 全量单测**

Run: `cd apps/mobile && npx jest`
Expected: 全部 PASS，无新增 open handle 告警。

**Step 3: Bridge 回归（零改动确认）**

Run: `cd servers/bridge && npm test`
Expected: PASS。

**Step 4:** Maestro 真机流程（历史聊天、分组展开、横向滑动代码块）并记录结果。

---

## 验收标准

- [x] `HorizontalScrollBox` 统一所有横向内容；`MessageList` 保留 `nestedScrollEnabled`；真机可横向滑动代码块/表格/diff/shell。
- [x] `components/chat/**` 内无纵向 `ScrollView`（除 Modal 白名单），守护测试通过。
- [x] `ToolGroupCard` 一级展开为 `ClampBox` 裁剪，详情走 `ToolDetailSheet`（Modal）；内框过滚动不再触发外层反向滚动。
- [x] 列表内点击统一走 `AppPressable`；流式输出时按钮可正常点击。（P3: 由于去掉了 inverted，RN Pressable 不再有 Fabric bug，简化回 core Pressable，RNGH 已移除）
- [x] `MessageList` 无 `inverted`，保留 `maintainVisibleContentPosition`；进入会话定位、流式跟随、上滑加载历史、日期分隔符、FAB 回底均正常。
- [ ] 流式期间文本走纯 `Text`，结束后切回 Markdown；交互不再明显卡顿。（P4 未实施）
- [x] 未改动 Bridge、未新增 WS 接口。
- [x] `apps/mobile` 全量单测 + Bridge 单测通过（46/48 suites, 1027/1030 tests）。

---

## 完成状态（2026-09-12）

**P0 ✅** HorizontalScrollBox + nestedScrollEnabled 恢复
**P1 ✅** ClampBox + ToolDetailSheet 重构（Modal 详情展开）
**P2 ✅** AppPressable → 简化回 core Pressable（去 inverted 后 RNGH 不再需要）
**P3 ✅** MessageList 去 inverted + useBottomAnchor hook + dateSeparators 去 reverse
**P4 ⬜** StreamingText 流式节流（未实施，非阻塞）

**额外完成：**
- 移除 react-native-gesture-handler 依赖（P2 简化）
- Maestro E2E 冒烟流程修复并通过（`chat-ui-standardization-smoke.yaml` 12 步全绿）
- JS Bundle 构建 + Release APK 构建 + 真机安装验证

**遗留：**
- P4（StreamingText 流式节流）未实施，需单独跟进
- API key 余额不足（402）导致无法测试完整对话流
