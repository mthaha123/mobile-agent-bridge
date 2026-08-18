/**
 * MessageItem — memoized 单条消息渲染单元测试
 *
 * 覆盖：三种身份的容器样式 / content 走 MarkdownRenderer /
 * parts 走 PartBlock / agent meta / 长按菜单 role 控制 / memo 行为。
 *
 * 注：MarkdownRenderer 被替换为可计数的 jest.fn 假组件，
 * 用于断言 memo 跳渲染（React 18 test-renderer 下 Profiler.onRender
 * 即使 memo 短路也会每次 commit 触发，无法作为跳渲染信号）。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { View, Text, Alert } from 'react-native'
import { MessageItem } from '../src/components/chat/MessageItem'
import { PartBlock } from '../src/components/chat/PartBlock'
import { MarkdownRenderer } from '../src/components/chat/MarkdownRenderer'
import { textOf } from './test-utils'
import type { ChatMessage, NewChatMessage } from '../src/stores/chatStore'

jest.mock('../src/components/chat/MarkdownRenderer', () => {
  const React = require('react')
  const { Text } = require('react-native')
  return {
    MarkdownRenderer: jest.fn((props: { content: string }) =>
      React.createElement(Text, null, props.content),
    ),
  }
})

function makeMessage(over: NewChatMessage = {}): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    status: 'complete',
    parts: [],
    ...over,
  } as ChatMessage
}

function noop() {}

/** 找到 MessageItem 最外层容器 View（userBubble 或 nonUserBlock） */
function containerView(tree: TestRenderer.ReactTestRenderer): any {
  const views = tree.root.findAllByType(View)
  const container = views.find(
    (n: any) =>
      n.props?.style &&
      (n.props.style.maxWidth === '80%' || n.props.style.paddingVertical === 6),
  )
  if (!container) throw new Error('MessageItem container View not found')
  return container
}

/** 找到 messageMeta 文本节点（agent 名称） */
function metaTextNodes(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (n: any) =>
      n.type === Text &&
      n.props?.style &&
      (n.props.style.fontSize === 11 || n.props.style.marginBottom === 4),
  )
}

describe('MessageItem', () => {
  it('renders user message in userBubble container', () => {
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'user', content: 'hello' })} onRevert={noop} />,
    )
    const style = containerView(tree).props.style
    expect(style).toMatchObject({ maxWidth: '80%', alignSelf: 'flex-end' })
  })

  it('renders assistant message in nonUserBlock container', () => {
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'assistant', content: 'hi' })} onRevert={noop} />,
    )
    const style = containerView(tree).props.style
    expect(style).toMatchObject({ paddingVertical: 6 })
    expect(style.alignSelf).toBeUndefined()
  })

  it('renders system message in nonUserBlock container', () => {
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'system', content: 'Session started' })} onRevert={noop} />,
    )
    const style = containerView(tree).props.style
    expect(style).toMatchObject({ paddingVertical: 6 })
    expect(textOf(tree)).toContain('Session started')
  })

  it('assistant content renders via MarkdownRenderer', () => {
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'assistant', content: '# Hello **world**' })} onRevert={noop} />,
    )
    const mdComponents = tree.root.findAllByType(MarkdownRenderer)
    expect(mdComponents).toHaveLength(1)
    expect(mdComponents[0].props.content).toBe('# Hello **world**')
    expect(textOf(tree)).toContain('Hello')
  })

  it('renders no MarkdownRenderer when content is empty', () => {
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'assistant', content: '' })} onRevert={noop} />,
    )
    expect(tree.root.findAllByType(MarkdownRenderer)).toHaveLength(0)
  })

  it('renders one PartBlock per part (tool/text/reasoning)', () => {
    const parts = [
      { id: 'p1', type: 'tool', data: { tool: 'read', input: { path: 'a.ts' }, status: 'success' } },
      { id: 'p2', type: 'text', data: { content: 'some text body' } },
      { id: 'p3', type: 'reasoning', data: { content: 'hidden thinking' } },
    ]
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ content: '', parts: parts as any })} onRevert={noop} />,
    )
    const blocks = tree.root.findAllByType(PartBlock)
    expect(blocks).toHaveLength(3)
    const t = textOf(tree)
    expect(t).toContain('Read')          // tool part → ToolPart 卡片
    expect(t).toContain('some text body') // text part
    expect(t).toContain('思考过程')        // reasoning part（默认折叠）
  })

  it('renders agent meta text when present, omits when absent', () => {
    const withAgent = TestRenderer.create(
      <MessageItem
        item={makeMessage({ role: 'assistant', content: 'x', agent: 'opencode/deepseek' })}
        onRevert={noop}
      />,
    )
    expect(textOf(withAgent)).toContain('opencode/deepseek')
    expect(metaTextNodes(withAgent).length).toBeGreaterThan(0)

    const withoutAgent = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'assistant', content: 'x' })} onRevert={noop} />,
    )
    expect(metaTextNodes(withoutAgent)).toHaveLength(0)
  })

  it('assistant content long-press offers revert and calls onRevert', () => {
    const onRevert = jest.fn()
    const alertSpy = jest.spyOn(Alert, 'alert')
    const tree = TestRenderer.create(
      <MessageItem
        item={makeMessage({ role: 'assistant', content: 'answer', messageID: 'msg-1' })}
        onRevert={onRevert}
      />,
    )
    const longPressables = tree.root.findAll((n: any) => typeof n.props?.onLongPress === 'function')
    expect(longPressables.length).toBeGreaterThan(0)
    act(() => { longPressables[0].props.onLongPress() })

    const buttons = alertSpy.mock.calls[0][2] as any[]
    expect(buttons.some((b) => b.text === '回退到此')).toBe(true)
    const revertBtn = buttons.find((b) => b.text === '回退到此')
    act(() => { revertBtn.onPress() })
    expect(onRevert).toHaveBeenCalledWith('msg-1', undefined)
    alertSpy.mockRestore()
  })

  it('user message content long-press does NOT offer revert', () => {
    const onRevert = jest.fn()
    const alertSpy = jest.spyOn(Alert, 'alert')
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'user', content: 'my question' })} onRevert={onRevert} />,
    )
    const longPressables = tree.root.findAll((n: any) => typeof n.props?.onLongPress === 'function')
    expect(longPressables.length).toBeGreaterThan(0)
    act(() => { longPressables[0].props.onLongPress() })

    const buttons = alertSpy.mock.calls[0][2] as any[]
    expect(buttons.some((b) => b.text === '复制消息')).toBe(true)
    expect(buttons.some((b) => b.text === '回退到此')).toBe(false)
    alertSpy.mockRestore()
  })

  it('assistant content wrapper exposes assistant-text-part testID', () => {
    const tree = TestRenderer.create(
      <MessageItem item={makeMessage({ role: 'assistant', content: 'hi' })} onRevert={noop} />,
    )
    const touchable = tree.root.find((n: any) => n.props?.testID === 'assistant-text-part')
    expect(touchable).toBeDefined()
  })

  it('memoizes: same item & onRevert references skip re-render, new item re-renders', () => {
    const mdMock = MarkdownRenderer as unknown as jest.Mock
    mdMock.mockClear()

    const item = makeMessage({ role: 'assistant', content: 'stable' })
    const onRevert = jest.fn()

    let tree: TestRenderer.ReactTestRenderer
    act(() => {
      tree = TestRenderer.create(<MessageItem item={item} onRevert={onRevert} />)
    })
    // 挂载渲染一次 → MarkdownRenderer 执行 1 次
    expect(mdMock).toHaveBeenCalledTimes(1)

    // 同一 item / onRevert 引用 → memo 短路跳渲染，MarkdownRenderer 不再执行
    act(() => {
      tree.update(<MessageItem item={item} onRevert={onRevert} />)
    })
    expect(mdMock).toHaveBeenCalledTimes(1)

    // 正向对照：新 item 引用 → 必须重渲染
    const item2 = makeMessage({ role: 'assistant', content: 'changed' })
    act(() => {
      tree.update(<MessageItem item={item2} onRevert={onRevert} />)
    })
    expect(mdMock).toHaveBeenCalledTimes(2)
  })
})