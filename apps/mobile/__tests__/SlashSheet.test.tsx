import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { TouchableOpacity, Text } from 'react-native'
import { SlashSheet } from '../src/screens/SlashSheet'
import { useConfigStore } from '../src/stores/configStore'
import { textOf } from './test-utils'

const onSelect = jest.fn()
const onClose = jest.fn()

beforeEach(() => {
  useConfigStore.setState({
    agents: [{ name: 'CodeStral' }, { name: 'GPT-4o' }],
    commands: [{ command: 'model', description: 'Switch model' }, { command: 'agent', description: 'Switch agent' }],
    config: null, providers: [], loading: false, error: null,
  })
  jest.clearAllMocks()
})

describe('SlashSheet', () => {
  it('renders commands and agents when visible', () => {
    const tree = TestRenderer.create(<SlashSheet visible={true} onClose={onClose} onSelect={onSelect} />)
    const text = textOf(tree)
    expect(text).toContain('model')
    expect(text).toContain('CodeStral')
  })

  it('renders empty state', () => {
    useConfigStore.setState({ agents: [], commands: [] })
    const tree = TestRenderer.create(<SlashSheet visible={true} onClose={onClose} onSelect={onSelect} />)
    const text = textOf(tree)
    expect(text).toContain('无匹配项')
  })

  it('calls onSelect when item pressed', () => {
    const tree = TestRenderer.create(<SlashSheet visible={true} onClose={onClose} onSelect={onSelect} />)
    // Find all TouchableOpacity that have "/" as a Text child (command item)
    const all = tree.root.findAllByType(TouchableOpacity)
    for (const btn of all) {
      try {
        const texts = btn.findAllByType(Text, { deep: true })
        const hasSlash = texts.some((t) => t.props?.children === '/')
        const hasModel = texts.some((t) => {
          const v = t.props?.children
          return typeof v === 'string' && v.includes('model')
        })
        if (hasSlash && hasModel && typeof btn.props.onPress === 'function') {
          act(() => { btn.props.onPress() })
        }
      } catch {}
    }
    expect(onSelect).toHaveBeenCalled()
  })

  it('calls onClose when overlay tapped', () => {
    const tree = TestRenderer.create(<SlashSheet visible={true} onClose={onClose} onSelect={onSelect} />)
    const all = tree.root.findAllByType(TouchableOpacity)
    // First TouchableOpacity is the overlay
    if (all.length > 0) {
      act(() => { all[0].props.onPress() })
      expect(onClose).toHaveBeenCalled()
    }
  })

  it('renders only agents when filter is @', () => {
    const tree = TestRenderer.create(<SlashSheet visible={true} onClose={onClose} onSelect={onSelect} onSwitchAgent={jest.fn()} filter="@" />)
    const text = textOf(tree)
    expect(text).toContain('CodeStral')
    expect(text).toContain('Switch agent')
    // Commands section hidden when filter=@
    expect(text).not.toContain('Commands')
  })

  it('renders only commands when filter is /', () => {
    const tree = TestRenderer.create(<SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="/" />)
    const text = textOf(tree)
    expect(text).toContain('model')
    expect(text).not.toContain('CodeStral')
  })

  it('calls onSwitchAgent when agent item pressed with callback provided', () => {
    const onSwitchAgent = jest.fn()
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} onSwitchAgent={onSwitchAgent} filter="@" />,
    )
    const all = tree.root.findAllByType(TouchableOpacity)
    for (const btn of all) {
      try {
        const texts = btn.findAllByType(Text, { deep: true })
        const hasAt = texts.some((t) => t.props?.children === '@')
        const hasAgent = texts.some((t) => {
          const v = t.props?.children
          return typeof v === 'string' && v.includes('CodeStral')
        })
        if (hasAt && hasAgent && typeof btn.props.onPress === 'function') {
          act(() => { btn.props.onPress() })
        }
      } catch {}
    }
    expect(onSwitchAgent).toHaveBeenCalledWith('CodeStral')
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onSelect with /agent when no switch callback provided', () => {
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="@" />,
    )
    const all = tree.root.findAllByType(TouchableOpacity)
    for (const btn of all) {
      try {
        const texts = btn.findAllByType(Text, { deep: true })
        const hasAt = texts.some((t) => t.props?.children === '@')
        const hasAgent = texts.some((t) => {
          const v = t.props?.children
          return typeof v === 'string' && v.includes('CodeStral')
        })
        if (hasAt && hasAgent && typeof btn.props.onPress === 'function') {
          act(() => { btn.props.onPress() })
        }
      } catch {}
    }
    expect(onSelect).toHaveBeenCalledWith('/agent CodeStral')
  })

  it('filters commands by typed prefix', () => {
    useConfigStore.setState({ agents: [], commands: [
      { command: 'model', description: 'Switch model' },
      { command: 'agent', description: 'Switch agent' },
      { command: 'compact', description: 'Compact session' },
    ] })
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="/mo" />,
    )
    const text = textOf(tree)
    expect(text).toContain('model')
    expect(text).not.toContain('compact')
  })

  it('shows empty state text when filtered result is empty', () => {
    useConfigStore.setState({ agents: [], commands: [{ command: 'model', description: 'Switch model' }] })
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="/zzz" />,
    )
    expect(textOf(tree)).toContain('无匹配项')
  })

  it('shows "选择 Agent" title when filter is @', () => {
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="@" />,
    )
    expect(textOf(tree)).toContain('选择 Agent')
  })

  it('filter @ shows agents but not commands', () => {
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="@" />,
    )
    const text = textOf(tree)
    expect(text).toContain('CodeStral')
    expect(text).toContain('GPT-4o')
    expect(text).not.toContain('model')
    expect(text).not.toContain('agent')
  })

  it('pressing an agent item calls onSwitchAgent with agent label', () => {
    const onSwitchAgent = jest.fn()
    const tree = TestRenderer.create(
      <SlashSheet
        visible={true}
        onClose={onClose}
        onSelect={onSelect}
        onSwitchAgent={onSwitchAgent}
        filter="@"
      />,
    )
    const all = tree.root.findAllByType(TouchableOpacity)
    for (const btn of all) {
      try {
        const texts = btn.findAllByType(Text, { deep: true })
        const hasAt = texts.some((t) => t.props?.children === '@')
        const hasAgent = texts.some((t) => {
          const v = t.props?.children
          return typeof v === 'string' && v.includes('CodeStral')
        })
        if (hasAt && hasAgent && typeof btn.props.onPress === 'function') {
          act(() => { btn.props.onPress() })
        }
      } catch {}
    }
    expect(onSwitchAgent).toHaveBeenCalledWith('CodeStral')
    expect(onClose).toHaveBeenCalled()
  })

  it('pressing agent item falls back to /agent command when no onSwitchAgent', () => {
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="@" />,
    )
    const all = tree.root.findAllByType(TouchableOpacity)
    for (const btn of all) {
      try {
        const texts = btn.findAllByType(Text, { deep: true })
        const hasAt = texts.some((t) => t.props?.children === '@')
        const hasAgent = texts.some((t) => {
          const v = t.props?.children
          return typeof v === 'string' && v.includes('CodeStral')
        })
        if (hasAt && hasAgent && typeof btn.props.onPress === 'function') {
          act(() => { btn.props.onPress() })
        }
      } catch {}
    }
    expect(onSelect).toHaveBeenCalledWith('/agent CodeStral')
  })

  it('filter / shows commands but not agents', () => {
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="/" />,
    )
    const text = textOf(tree)
    expect(text).toContain('model')
    expect(text).not.toContain('CodeStral')
  })

  it('filter text narrows down commands', () => {
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} filter="/mo" />,
    )
    const text = textOf(tree)
    expect(text).toContain('model')
    expect(text).not.toContain('agent')
  })

  // ── 当前 agent 标记（服务端权威值回显）──────────────────────────────
  it('marks the current agent and shows current hint', () => {
    const tree = TestRenderer.create(
      <SlashSheet
        visible={true}
        onClose={onClose}
        onSelect={onSelect}
        onSwitchAgent={jest.fn()}
        filter="@"
        currentAgent="CodeStral"
      />,
    )
    const text = textOf(tree)
    expect(text).toContain('当前：CodeStral')
    expect(text).toContain('当前 agent')
  })

  it('non-current agents keep the Switch agent label', () => {
    const tree = TestRenderer.create(
      <SlashSheet
        visible={true}
        onClose={onClose}
        onSelect={onSelect}
        onSwitchAgent={jest.fn()}
        filter="@"
        currentAgent="GPT-4o"
      />,
    )
    const text = textOf(tree)
    expect(text).toContain('当前：GPT-4o')
    expect(text).toContain('Switch agent')
    expect(text).toContain('当前 agent')
  })

  it('omits current hint when session has no explicit agent', () => {
    const tree = TestRenderer.create(
      <SlashSheet visible={true} onClose={onClose} onSelect={onSelect} onSwitchAgent={jest.fn()} filter="@" />,
    )
    const text = textOf(tree)
    expect(text).not.toContain('当前：')
    expect(text).toContain('Switch agent')
  })
})
