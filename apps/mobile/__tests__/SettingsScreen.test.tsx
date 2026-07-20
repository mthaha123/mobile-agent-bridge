/**
 * SettingsScreen tests
 *
 * 测试 SettingsScreen 的渲染和交互：显示连接信息、Disconnect 按钮。
 * 所有 server 交互通过 mock client 模拟。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { SettingsScreen } from '../src/screens/SettingsScreen'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useUiStore } from '../src/stores/uiStore'
import { mockClient, resetAllStores, textOf, findAllPressable } from './test-utils'

beforeEach(() => resetAllStores())

// ─── 渲染测试 ─────────────────────────────────────────────

describe('SettingsScreen', () => {
  it('renders title', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Settings')
  })

  it('displays bridge URL', () => {
    act(() => {
      useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('ws://localhost:8080/ws')
  })

  it('shows (none) when no bridge URL', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('(none)')
  })

  it('shows Connected when client.connected=true', () => {
    const client = mockClient()
    client.connected = true
    act(() => {
      useAuthStore.setState({ client: client as any })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Connected')
  })

  it('shows Disconnected when client.connected=false', () => {
    const client = mockClient()
    client.connected = false
    act(() => {
      useAuthStore.setState({ client: client as any })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Disconnected')
  })

  it('shows Disconnected when no client', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Disconnected')
  })

  it('displays project directory', () => {
    act(() => {
      useProjectStore.setState({ directory: '/home/user/project' })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('/home/user/project')
  })

  it('shows (none) when no project directory', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('(none)')
  })

  it('renders Connection section label', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Connection')
  })

  it('renders Project section label', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Project')
  })

  it('renders Bridge URL row label', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Bridge URL')
  })

  it('renders Status row label', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Status')
  })

  it('renders Directory row label', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Directory')
  })
})

// ─── 交互测试 ─────────────────────────────────────────────

describe('SettingsScreen — interactions', () => {
  it('Disconnect button calls logout and navigates to connect', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({
        client: client as any,
        authenticated: true,
        bridgeUrl: 'ws://test/ws',
      })
      useUiStore.setState({ screen: 'main' })
    })

    const tree = TestRenderer.create(<SettingsScreen />)
    const pressables = findAllPressable(tree)
    const disconnectBtn = pressables.find((b: any) => {
      const t = textOf({ toJSON: () => b } as any)
      return t.includes('Disconnect')
    })
    expect(disconnectBtn).toBeDefined()

    act(() => { disconnectBtn!.props.onPress() })

    expect(useAuthStore.getState().authenticated).toBe(false)
    expect(useAuthStore.getState().client).toBeNull()
    expect(useUiStore.getState().screen).toBe('connect')
  })
})
