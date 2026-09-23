/**
 * ChatMessageArea tests
 *
 * 覆盖：从 store 读消息渲染 / store 变化驱动重渲染 / grouped 模式合并连续 assistant 消息。
 * 该组件是聊天屏里唯一订阅 chatStore.messages 的地方（流式卡顿修复的核心）。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { ChatMessageArea, ChatMessageAreaProps } from '../src/components/chat/ChatMessageArea'
import { useChatStore } from '../src/stores/chatStore'
import { useSettingsStore } from '../src/stores/settingsStore'

function textOf(tree: TestRenderer.ReactTestRenderer): string {
  let s = ''
  const walk = (node: any) => {
    if (!node) return
    if (typeof node === 'string') { s += node; return }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree.toJSON())
  return s
}

function baseProps(over: Partial<ChatMessageAreaProps> = {}): ChatMessageAreaProps {
  return {
    renderMessage: (item) => (
      <Text key={item.id}>
        {item.content ||
          (item.parts || []).map((p: any) => String(p?.data?.content ?? '')).join('')}
      </Text>
    ),
    hasMoreHistory: false,
    historyLoading: false,
    onLoadMoreHistory: jest.fn(),
    ...over,
  }
}

beforeEach(() => {
  useChatStore.setState({ activeSessionId: 's1', messages: [] })
  useSettingsStore.setState({ chatDisplayMode: 'flat' })
  jest.clearAllMocks()
})

describe('ChatMessageArea', () => {
  it('renders messages from the store', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'Hi there', timestamp: 2000 },
      ],
    })
    const tree = TestRenderer.create(<ChatMessageArea {...baseProps()} />)
    const t = textOf(tree)
    expect(t).toContain('Hello')
    expect(t).toContain('Hi there')
  })

  it('re-renders when store messages change (store subscription, not just props)', () => {
    const tree = TestRenderer.create(<ChatMessageArea {...baseProps()} />)
    expect(textOf(tree)).not.toContain('streamed chunk')
    act(() => {
      useChatStore.setState({
        messages: [{ id: 'm1', role: 'assistant', content: 'streamed chunk', timestamp: 1 }],
      })
    })
    expect(textOf(tree)).toContain('streamed chunk')
  })

  it('merges consecutive assistant messages in grouped mode', () => {
    useSettingsStore.setState({ chatDisplayMode: 'grouped' })
    useChatStore.setState({
      messages: [
        { id: 'a1', role: 'assistant', content: 'part one', timestamp: 1 },
        { id: 'a2', role: 'assistant', content: 'part two', timestamp: 2 },
      ],
    })
    const tree = TestRenderer.create(<ChatMessageArea {...baseProps()} />)
    const t = textOf(tree)
    expect(t).toContain('part one')
    expect(t).toContain('part two')
  })
})
