import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'
import { AppPressable } from '../src/components/common/AppPressable'

function render(props: Record<string, unknown> = {}) {
  let tree!: TestRenderer.ReactTestRenderer
  act(() => {
    tree = TestRenderer.create(
      <AppPressable {...props}>
        <Text>tap me</Text>
      </AppPressable>,
    )
  })
  return tree
}

describe('AppPressable', () => {
  it('renders children', () => {
    const tree = render()
    const text = tree.root.findByType(Text)
    expect(text.props.children).toBe('tap me')
  })

  it('renders a Pressable from react-native', () => {
    const tree = render()
    const pressables = tree.root.findAllByType('Pressable')
    expect(pressables.length).toBeGreaterThanOrEqual(1)
  })

  it('passes onPress handler', () => {
    const onPress = jest.fn()
    const tree = render({ onPress })
    const pressable = tree.root.findAllByType('Pressable')[0]
    act(() => {
      pressable.props.onPress()
    })
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('passes disabled prop', () => {
    const onPress = jest.fn()
    const tree = render({ onPress, disabled: true })
    const pressable = tree.root.findAllByType('Pressable')[0]
    expect(pressable.props.disabled).toBe(true)
  })

  it('passes onLongPress handler', () => {
    const onLongPress = jest.fn()
    const tree = render({ onLongPress })
    const pressable = tree.root.findAllByType('Pressable')[0]
    act(() => {
      pressable.props.onLongPress()
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('passes testID', () => {
    const tree = render({ testID: 'my-pressable' })
    const pressable = tree.root.findAllByType('Pressable')[0]
    expect(pressable.props.testID).toBe('my-pressable')
  })
})
