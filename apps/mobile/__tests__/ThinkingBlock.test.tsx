import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'
import { ThinkingBlock } from '../src/components/chat/ThinkingBlock'

describe('ThinkingBlock', () => {
  it('renders collapsed by default with 思考过程 label', () => {
    const tree = TestRenderer.create(<ThinkingBlock content="分析代码结构..." />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('思考过程')
    expect(text).not.toContain('分析代码结构')
  })

  it('expands to show content on press', () => {
    const tree = TestRenderer.create(<ThinkingBlock content="分析代码结构，决定先读取..." />)
    const touchables = tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables[0].props.onPress() })

    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('分析代码结构')
  })

  it('collapses again on second press', () => {
    const tree = TestRenderer.create(<ThinkingBlock content="thinking..." />)
    const touchables = () => tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables()[0].props.onPress() })
    act(() => { touchables()[0].props.onPress() })

    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).not.toContain('thinking...')
  })

  it('shows streaming indicator when streaming=true', () => {
    const tree = TestRenderer.create(<ThinkingBlock content="" streaming={true} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('思考中')
  })
})
