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
      { tool: 'read' }, { tool: 'glob' }, { tool: 'bash' },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('3')
    expect(text).toContain('工具调用')
  })

  it('shows success summary when all tools succeeded', () => {
    const parts = makeToolParts([
      { tool: 'read', status: 'success' }, { tool: 'edit', status: 'success' },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('✓')
  })

  it('shows failure summary when any tool failed', () => {
    const parts = makeToolParts([
      { tool: 'read', status: 'success' }, { tool: 'bash', status: 'failed' },
    ])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const text = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(text).toContain('✗')
  })

  it('shows running indicator when any tool is in progress', () => {
    const parts = makeToolParts([
      { tool: 'read', status: 'success' }, { tool: 'bash', status: 'progress' },
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
    let allText = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(allText).not.toContain('App.tsx')

    const touchables = tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables[0].props.onPress() })

    allText = tree.root.findAllByType(Text).map(t => t.props.children).join('')
    expect(allText).toContain('App.tsx')
    expect(allText).toContain('**/*.ts')
  })

  it('chevron direction changes on expand/collapse', () => {
    const parts = makeToolParts([{ tool: 'read' }])
    const tree = TestRenderer.create(<ToolGroupCard parts={parts} />)
    const chevrons = () => tree.root.findAll(
      (n: any) => n.type === Text && (n.props.children === '▶' || n.props.children === '▼')
    )
    expect(chevrons()[0].props.children).toBe('▶')

    const touchables = tree.root.findAllByType(TouchableOpacity)
    act(() => { touchables[0].props.onPress() })
    expect(chevrons()[0].props.children).toBe('▼')
  })
})
