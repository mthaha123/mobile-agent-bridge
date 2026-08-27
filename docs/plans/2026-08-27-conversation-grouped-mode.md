# 会话聚合模式 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 assistant 消息中的连续工具调用和思考内容按段聚合显示，提升移动端阅读体验。

**Architecture:** 纯渲染层改造。`MessageItem` 内新增 `buildSegments()` 将 `parts[]` 分段，连续 tool 合并为 `ToolGroupCard`（三层展开），每个 reasoning 独立为 `ThinkingBlock`。数据模型（chatStore）完全不变。

**Tech Stack:** React Native, TypeScript, Zustand (只读), Jest + react-test-renderer

**Design Doc:** `docs/plans/2026-08-27-conversation-grouped-mode-design.md`

---

### Task 1: 分段算法（纯函数，无 UI）

**Files:**
- Create: `apps/mobile/src/components/chat/segmentParts.ts`
- Create: `apps/mobile/__tests__/segmentParts.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/mobile/__tests__/segmentParts.test.ts
import { buildSegments, Segment } from '../src/components/chat/segmentParts'
import type { Part } from '../src/types/message'

function toolPart(id: string, tool = 'read'): Part {
  return { id, type: 'tool', data: { tool, input: {}, status: 'success' } }
}
function textPart(id: string, content: string): Part {
  return { id, type: 'text', data: { content } }
}
function reasoningPart(id: string, content: string): Part {
  return { id, type: 'reasoning', data: { content } }
}
function errorPart(id: string): Part {
  return { id, type: 'error', data: { tool: 'bash', error: 'fail' } }
}
function compactionPart(id: string): Part {
  return { id, type: 'compaction', data: {} }
}

describe('buildSegments', () => {
  it('returns empty array for empty parts', () => {
    expect(buildSegments([])).toEqual([])
  })

  it('groups consecutive tool parts into one tool-group segment', () => {
    const parts = [toolPart('t1'), toolPart('t2'), toolPart('t3')]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('tool-group')
    expect(segs[0].parts).toHaveLength(3)
  })

  it('splits tool groups separated by reasoning', () => {
    const parts = [
      toolPart('t1'), toolPart('t2'),
      reasoningPart('r1', 'thinking'),
      toolPart('t3'), toolPart('t4'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ type: 'tool-group', parts: [parts[0], parts[1]] })
    expect(segs[1]).toMatchObject({ type: 'reasoning', parts: [parts[2]] })
    expect(segs[2]).toMatchObject({ type: 'tool-group', parts: [parts[3], parts[4]] })
  })

  it('keeps each reasoning as its own segment', () => {
    const parts = [reasoningPart('r1', 'a'), reasoningPart('r2', 'b')]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(2)
    expect(segs[0].type).toBe('reasoning')
    expect(segs[1].type).toBe('reasoning')
  })

  it('single tool between text parts becomes its own tool-group', () => {
    const parts = [
      textPart('txt1', 'before'),
      toolPart('t1'),
      textPart('txt2', 'after'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toMatchObject({ type: 'text', parts: [parts[0]] })
    expect(segs[1]).toMatchObject({ type: 'tool-group', parts: [parts[1]] })
    expect(segs[2]).toMatchObject({ type: 'text', parts: [parts[2]] })
  })

  it('preserves order of mixed parts', () => {
    const parts = [
      reasoningPart('r1', 'think1'),
      toolPart('t1'), toolPart('t2'),
      textPart('txt1', 'answer'),
      toolPart('t3'),
      textPart('txt2', 'more'),
    ]
    const segs = buildSegments(parts)
    expect(segs.map(s => s.type)).toEqual([
      'reasoning', 'tool-group', 'text', 'tool-group', 'text',
    ])
  })

  it('handles error, file, compaction as independent segments', () => {
    const parts = [
      errorPart('e1'),
      compactionPart('c1'),
      textPart('txt1', 'ok'),
    ]
    const segs = buildSegments(parts)
    expect(segs).toHaveLength(3)
    expect(segs.map(s => s.type)).toEqual(['error', 'compaction', 'text'])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest __tests__/segmentParts.test.ts --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// apps/mobile/src/components/chat/segmentParts.ts
import type { Part } from '../../types/message'

export type SegmentType = 'tool-group' | 'reasoning' | 'text' | 'error' | 'file' | 'compaction'

export interface Segment {
  type: SegmentType
  parts: Part[]
}

/** 将 parts[] 按连续同类分段：相邻 tool 合并，reasoning/text/error/file/compaction 各自独立 */
export function buildSegments(parts: Part[]): Segment[] {
  if (!parts || parts.length === 0) return []

  const result: Segment[] = []
  let i = 0

  while (i < parts.length) {
    const p = parts[i]
    if (p.type === 'tool') {
      // 收集连续的 tool parts
      const group: Part[] = []
      while (i < parts.length && parts[i].type === 'tool') {
        group.push(parts[i])
        i++
      }
      result.push({ type: 'tool-group', parts: group })
    } else {
      // reasoning / text / error / file / compaction 各自独立
      const segType: SegmentType = p.type as SegmentType
      result.push({ type: segType, parts: [p] })
      i++
    }
  }

  return result
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/mobile && npx jest __tests__/segmentParts.test.ts --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/src/components/chat/segmentParts.ts apps/mobile/__tests__/segmentParts.test.ts
git commit -m "feat(chat): add buildSegments pure function for part grouping"
```

---

### Task 2: ToolGroupCard 组件

**Files:**
- Create: `apps/mobile/src/components/chat/ToolGroupCard.tsx`
- Create: `apps/mobile/__tests__/ToolGroupCard.test.tsx`

**Step 1: Write the failing test**

```typescript
// apps/mobile/__tests__/ToolGroupCard.test.tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { ToolGroupCard } from '../src/components/chat/ToolGroupCard'
import type { Part } from '../src/types/message'

function makeToolParts(overrides: Partial<{ tool: string; status: string; input: Record<string, unknown> }>[] = []): Part[] {
  return overrides.map((o, i) => ({
    id: `tool_${i}`,
    type: 'tool' as const,
    data: {
      tool: o.tool ?? 'read',
      input: o.input ?? { path: `file${i}.ts` },
      status: o.status ?? 'success',
    },
  }))
}

describe('ToolGroupCard', () => {
  it('renders collapsed header with tool count', () => {
    const parts = makeToolParts([
      { tool: 'read' },
      { tool: 'glob' },
      { tool: 'bash' },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('3')
    expect(text).toContain('工具调用')
  })

  it('shows success summary when all tools succeeded', () => {
    const parts = makeToolParts([
      { tool: 'read', status: 'success' },
      { tool: 'edit', status: 'success' },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('✓')
  })

  it('shows failure summary when any tool failed', () => {
    const parts = makeToolParts([
      { tool: 'read', status: 'success' },
      { tool: 'bash', status: 'failed' },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('✗')
  })

  it('shows running indicator when any tool is in progress', () => {
    const parts = makeToolParts([
      { tool: 'read', status: 'success' },
      { tool: 'bash', status: 'progress' },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('⏳')
  })

  it('expands to show tool glance rows on press', () => {
    const parts = makeToolParts([
      { tool: 'read', input: { path: 'src/App.tsx' } },
      { tool: 'glob', input: { pattern: '**/*.ts' } },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    // Initially collapsed — no glance rows
    let allText = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(allText).not.toContain('App.tsx')

    // Press to expand
    const touchables = tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables[0].props.onPress() })

    allText = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(allText).toContain('App.tsx')
    expect(allText).toContain('**/*.ts')
  })

  it('shows chevron direction changes on expand/collapse', () => {
    const parts = makeToolParts([{ tool: 'read' }])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const chevrons = () => tree.root.findAll(
      (n: any) => n.type === Text && (n.props.children === '▶' || n.props.children === '▼')
    )
    expect(chevrons()).toHaveLength(1)
    expect(chevrons()[0].props.children).toBe('▶') // collapsed

    const touchables = tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables[0].props.onPress() })
    expect(chevrons()[0].props.children).toBe('▼') // expanded
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest __tests__/ToolGroupCard.test.tsx --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

参考 `BasicTool.tsx` 和 `ContextToolGroup.tsx` 的样式模式，创建 `ToolGroupCard.tsx`：
- 折叠态：显示标题栏（图标 + "工具调用（N 个）" + 状态 + 展开箭头）
- 展开态：每个 tool 一行 glance（复用 `getToolInfo` 获取图标/标题/副标题）
- 状态计算：遍历 parts 统计 success/failed/progress 数量

**Step 4: Run test to verify it passes**

Run: `cd apps/mobile && npx jest __tests__/ToolGroupCard.test.tsx --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/src/components/chat/ToolGroupCard.tsx apps/mobile/__tests__/ToolGroupCard.test.tsx
git commit -m "feat(chat): add ToolGroupCard for grouped tool call display"
```

---

### Task 3: ThinkingBlock 组件

**Files:**
- Create: `apps/mobile/src/components/chat/ThinkingBlock.tsx`
- Create: `apps/mobile/__tests__/ThinkingBlock.test.tsx`

**Step 1: Write the failing test**

```typescript
// apps/mobile/__tests__/ThinkingBlock.test.tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { ThinkingBlock } from '../src/components/chat/ThinkingBlock'

describe('ThinkingBlock', () => {
  it('renders collapsed by default with 思考过程 label', () => {
    const tree = TestRenderer.create(
      <ThinkingBlock content="分析代码结构..." />
    )
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('思考过程')
    expect(text).not.toContain('分析代码结构')
  })

  it('expands to show content on press', () => {
    const tree = TestRenderer.create(
      <ThinkingBlock content="分析代码结构，决定先读取..." />
    )
    const touchables = tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables[0].props.onPress() })

    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('分析代码结构')
  })

  it('collapses again on second press', () => {
    const tree = TestRenderer.create(
      <ThinkingBlock content="thinking..." />
    )
    const touchables = () => tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables()[0].props.onPress() }) // expand
    act(() => { touchables()[0].props.onPress() }) // collapse

    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).not.toContain('thinking...')
  })

  it('shows streaming indicator when streaming=true', () => {
    const tree = TestRenderer.create(
      <ThinkingBlock content="" streaming={true} />
    )
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('思考中')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest __tests__/ThinkingBlock.test.tsx --no-coverage`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

参考 `PartBlock.tsx` 中已有的 `ReasoningDisplay` 逻辑：
- 折叠态：`🧠 思考过程` + 展开箭头
- 展开态：MarkdownRenderer 渲染思考文本
- `streaming` prop：显示"思考中..."提示

**Step 4: Run test to verify it passes**

Run: `cd apps/mobile && npx jest __tests__/ThinkingBlock.test.tsx --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/mobile/src/components/chat/ThinkingBlock.tsx apps/mobile/__tests__/ThinkingBlock.test.tsx
git commit -m "feat(chat): add ThinkingBlock for collapsible reasoning display"
```

---

### Task 4: MessageItem 改造 — 集成分段渲染

**Files:**
- Modify: `apps/mobile/src/components/chat/MessageItem.tsx`
- Modify: `apps/mobile/__tests__/MessageItem.test.tsx`

**Step 1: Write the failing test**

在现有 `MessageItem.test.tsx` 中新增测试用例：

```typescript
it('renders tool parts as ToolGroupCard instead of individual PartBlocks', () => {
  const parts = [
    { id: 't1', type: 'tool', data: { tool: 'read', input: { path: 'a.ts' }, status: 'success' } },
    { id: 't2', type: 'tool', data: { tool: 'glob', input: { pattern: '*.ts' }, status: 'success' } },
  ]
  const tree = TestRenderer.create(
    <MessageItem item={makeMessage({ content: '', parts: parts as any })} onRevert={noop} />
  )
  // Should NOT render PartBlock for tools anymore
  const toolPartBlocks = tree.root.findAll(
    (n: any) => n.type === PartBlock && n.props?.part?.type === 'tool'
  )
  expect(toolPartBlocks).toHaveLength(0)
  // Should render ToolGroupCard
  const { ToolGroupCard } = require('../src/components/chat/ToolGroupCard')
  const groups = tree.root.findAllByType(ToolGroupCard)
  expect(groups).toHaveLength(1)
  expect(groups[0].props.parts).toHaveLength(2)
})

it('renders reasoning parts as ThinkingBlock', () => {
  const parts = [
    { id: 'r1', type: 'reasoning', data: { content: 'thinking...' } },
  ]
  const tree = TestRenderer.create(
    <MessageItem item={makeMessage({ content: '', parts: parts as any })} onRevert={noop} />
  )
  const { ThinkingBlock } = require('../src/components/chat/ThinkingBlock')
  const blocks = tree.root.findAllByType(ThinkingBlock)
  expect(blocks).toHaveLength(1)
  expect(blocks[0].props.content).toBe('thinking...')
})

it('preserves interleaving order of thinking and tools', () => {
  const parts = [
    { id: 'r1', type: 'reasoning', data: { content: 'think1' } },
    { id: 't1', type: 'tool', data: { tool: 'read', input: {}, status: 'success' } },
    { id: 'r2', type: 'reasoning', data: { content: 'think2' } },
    { id: 't2', type: 'tool', data: { tool: 'edit', input: {}, status: 'success' } },
  ]
  const tree = TestRenderer.create(
    <MessageItem item={makeMessage({ content: '', parts: parts as any })} onRevert={noop} />
  )
  const { ThinkingBlock } = require('../src/components/chat/ThinkingBlock')
  const { ToolGroupCard } = require('../src/components/chat/ToolGroupCard')
  const thinking = tree.root.findAllByType(ThinkingBlock)
  const tools = tree.root.findAllByType(ToolGroupCard)
  expect(thinking).toHaveLength(2)
  expect(tools).toHaveLength(2)
  // Verify interleaving via render order in tree
})
```

**Step 2: Run test to verify it fails**

Run: `cd apps/mobile && npx jest __tests__/MessageItem.test.tsx --no-coverage`
Expected: FAIL — ToolGroupCard / ThinkingBlock not rendered

**Step 3: Modify MessageItem**

改造 `MessageItem.tsx` 的渲染逻辑：

```typescript
// 改造前：直接 map parts → PartBlock
// {item.parts?.map((p) => <PartBlock key={p.id} part={p} ... />)}

// 改造后：buildSegments → 按 segment type 分别渲染
import { buildSegments } from './segmentParts'
import { ToolGroupCard } from './ToolGroupCard'
import { ThinkingBlock } from './ThinkingBlock'

// 在 MessageItem 内部：
const segments = useMemo(() => buildSegments(item.parts ?? []), [item.parts])

// 渲染：
{segments.map((seg) => {
  if (seg.type === 'tool-group') {
    return <ToolGroupCard key={`seg_${seg.parts[0].id}`} parts={seg.parts} />
  }
  if (seg.type === 'reasoning') {
    return <ThinkingBlock
      key={`seg_${seg.parts[0].id}`}
      content={String(seg.parts[0].data?.content ?? '')}
      streaming={item.status === 'streaming'}
    />
  }
  // text / error / file / compaction 仍走 PartBlock
  return seg.parts.map((p) => (
    <PartBlock key={p.id} part={p} message={item as any} onRevert={onRevert} />
  ))
})}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/mobile && npx jest __tests__/MessageItem.test.tsx --no-coverage`
Expected: PASS

**Step 5: Run all chat component tests to ensure no regression**

Run: `cd apps/mobile && npx jest __tests__/chatComponents.test.tsx __tests__/MessageItem.test.tsx __tests__/MessageList.test.tsx --no-coverage`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/mobile/src/components/chat/MessageItem.tsx apps/mobile/__tests__/MessageItem.test.tsx
git commit -m "feat(chat): integrate segmented rendering in MessageItem"
```

---

### Task 5: 全量测试 + 清理

**Files:**
- Delete or deprecate: `apps/mobile/src/components/chat/ContextToolGroup.tsx`
- Run: full test suite

**Step 1: Run full mobile test suite**

Run: `cd apps/mobile && npx jest --no-coverage --forceExit`
Expected: All tests PASS

**Step 2: Remove ContextToolGroup references**

检查是否还有文件引用 `ContextToolGroup`，如有则移除 import。确认无引用后删除文件。

**Step 3: Verify TypeScript compiles**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(chat): remove deprecated ContextToolGroup, clean up imports"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-08-27-conversation-grouped-mode.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
