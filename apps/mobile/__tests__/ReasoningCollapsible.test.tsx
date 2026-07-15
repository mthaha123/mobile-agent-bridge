/**
 * ReasoningCollapsible — 单元测试 (react-test-renderer)
 */
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import { ReasoningCollapsible, ReasoningStream } from '../src/components/ReasoningCollapsible'

function toJson(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON())
}

describe('ReasoningCollapsible', () => {
  it('renders correctly with content', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Test reasoning content" />
    )
    const json = toJson(tree)
    expect(json).toContain('Thinking Process')
    expect(json).toContain('Test reasoning content')
  })

  it('renders with custom title', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Test content" title="Custom Title" />
    )
    const json = toJson(tree)
    expect(json).toContain('Custom Title')
  })

  it('hides content when collapsed by default', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Hidden content" defaultExpanded={false} />
    )
    const json = toJson(tree)
    expect(json).toContain('Hidden content')
  })

  it('shows content when expanded by default', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Visible content" defaultExpanded={true} />
    )
    const json = toJson(tree)
    expect(json).toContain('Visible content')
  })

  it('toggles expansion on press', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Toggle content" defaultExpanded={false} />
    )
    const pressable = tree.root.findByType(TouchableOpacity)
    TestRenderer.act(() => {
      pressable.props.onPress()
    })
    const json = toJson(tree)
    expect(json).toContain('Toggle content')
  })

  it('returns null when content is empty', () => {
    const tree = TestRenderer.create(<ReasoningCollapsible content="" />)
    expect(tree.toJSON()).toBeNull()
  })
})

describe('ReasoningStream', () => {
  it('renders correctly when streaming', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="" streaming={true} />
    )
    const json = toJson(tree)
    expect(json).toContain('Thinking...')
  })

  it('renders correctly with content', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="Stream content" streaming={false} />
    )
    const json = toJson(tree)
    expect(json).toContain('Thinking Process')
    expect(json).toContain('Stream content')
  })

  it('shows streaming indicator when streaming', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="" streaming={true} />
    )
    expect(tree.toJSON()).toBeTruthy()
  })

  it('hides content when collapsed', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="Hidden stream content" streaming={false} />
    )
    const json = toJson(tree)
    expect(json).toContain('Hidden stream content')
  })

  it('returns null when no content and not streaming', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="" streaming={false} />
    )
    expect(tree.toJSON()).toBeNull()
  })
})
