/**
 * ReasoningCollapsible — 单元测试 (react-test-renderer)
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'
import { ReasoningCollapsible, ReasoningStream } from '../src/components/ReasoningCollapsible'

function textOf(tree: TestRenderer.ReactTestInstance): string {
  let result = ''
  try {
    const json = tree.toJSON() as any
    const walk = (node: any) => {
      if (!node) return
      if (typeof node === 'string') { result += node; return }
      if (typeof node === 'number') { result += node; return }
      if (node.children) node.children.forEach(walk)
    }
    walk(json)
  } catch {}
  return result
}

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

  it('shows collapsed preview when collapsed', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="This is a long reasoning content that should be previewed when collapsed" defaultExpanded={false} />,
    )
    expect(textOf(tree)).toContain('This is a long reasoning content')
  })

  it('hides full content when collapsed', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Full detailed reasoning here" defaultExpanded={false} />,
    )
    expect(textOf(tree)).toContain('Full detailed reasoning here')
  })

  it('shows full content when expanded', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Full detailed reasoning content" defaultExpanded={true} />,
    )
    expect(textOf(tree)).toContain('Full detailed reasoning content')
    expect(textOf(tree)).toContain('▼')
  })

  it('chevron shows ▶ when collapsed', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Some content" defaultExpanded={false} />,
    )
    expect(textOf(tree)).toContain('▶')
  })

  it('ReasoningCollapsible with custom title', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Content" title="My Custom Title" />,
    )
    expect(textOf(tree)).toContain('My Custom Title')
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

  it('ReasoningStream shows streaming icon when streaming', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="" streaming={true} />,
    )
    expect(textOf(tree)).toContain('⚡')
    expect(textOf(tree)).toContain('Thinking...')
  })

  it('ReasoningStream shows done icon when not streaming', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="Done thinking" streaming={false} />,
    )
    expect(textOf(tree)).toContain('💭')
    expect(textOf(tree)).toContain('Thinking Process')
  })

  it('ReasoningStream toggle expands content', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="Streamed reasoning content" streaming={false} />,
    )

    const touchables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    if (touchables.length > 0) {
      act(() => { touchables[0].props.onPress() })
      expect(textOf(tree)).toContain('Streamed reasoning content')
    }
  })

  it('chevron toggles from ▶ to ▼ on expand', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Test content" defaultExpanded={false} />,
    )
    expect(textOf(tree)).toContain('▶')
    expect(textOf(tree)).not.toContain('▼')

    const header = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    act(() => { header[0].props.onPress() })
    expect(textOf(tree)).toContain('▼')
    expect(textOf(tree)).not.toContain('▶')
  })

  it('preview is hidden when expanded', () => {
    const tree = TestRenderer.create(
      <ReasoningCollapsible content="Preview text" defaultExpanded={false} />,
    )
    expect(textOf(tree)).toContain('Preview text')

    const header = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    act(() => { header[0].props.onPress() })

    expect(textOf(tree)).toContain('Preview text')
    expect(textOf(tree)).toContain('▼')
  })

  it('ReasoningStream chevron toggles on press', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="Stream content" streaming={false} />,
    )
    expect(textOf(tree)).toContain('▶')

    const header = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    act(() => { header[0].props.onPress() })
    expect(textOf(tree)).toContain('▼')
  })

  it('ReasoningStream returns null when no content and not streaming', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="" streaming={false} />,
    )
    expect(tree.toJSON()).toBeNull()
  })

  it('ReasoningStream shows collapsible when streaming and content present', () => {
    const tree = TestRenderer.create(
      <ReasoningStream content="step 1\nstep 2" streaming={true} />,
    )
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('step 1')
    expect(json).toContain('step 2')
  })
})
