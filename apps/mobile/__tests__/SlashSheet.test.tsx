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
    config: null, providers: [], vcs: null, loading: false, error: null,
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
    expect(text).toContain('No commands or agents loaded')
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
})
