/**
 * SettingsScreen tests
 *
 * 测试 SettingsScreen 的渲染和交互：显示连接信息、Disconnect 按钮。
 * 所有 server 交互通过 mock client 模拟。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { SettingsScreen } from '../src/screens/SettingsScreen'
import { Alert } from 'react-native'
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
  it('Disconnect button calls logout and navigates to connect', async () => {
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

    await act(async () => { disconnectBtn!.props.onPress() })

    expect(useAuthStore.getState().authenticated).toBe(false)
    expect(useAuthStore.getState().client).toBeNull()
    expect(useUiStore.getState().screen).toBe('connect')
  })
})

// ─── 死区块删减负向断言（2026-08 设置页重构）──────────────

describe('SettingsScreen — removed dead sections', () => {
  it('不再渲染 Config 区块（后端 stub 已移除）', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).not.toContain('Config')
    expect(textOf(tree)).not.toContain('Edit Config')
  })

  it('不再渲染 Providers 名单区块', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).not.toContain('Providers')
  })

  it('不再渲染 Agents 名单区块', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).not.toContain('Agents')
  })
})

// ─── 权限规则完整管理（2026-08 设置页重构）────────────────

describe('SettingsScreen — permissions management', () => {
  const rules = [
    { id: 'r1', tool: 'bash', action: 'allow *' },
    { id: 'r2', tool: 'bash', action: 'allow ls' },
    { id: 'r3', tool: 'edit', action: 'allow **' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, tool: 'web', action: `allow ${i}` })),
  ]

  function setup() {
    const client = mockClient({
      'permission.saved.list': () => rules,
      'permission.saved.remove': () => ({}),
    })
    act(() => {
      useAuthStore.setState({ client: client as any })
    })
    let tree!: TestRenderer.ReactTestRenderer
    act(() => {
      tree = TestRenderer.create(<SettingsScreen />)
    })
    return { client, tree }
  }

  async function flush() {
    await act(async () => {})
  }

  it('按 tool 分组渲染全部规则（无 10 条截断）', async () => {
    const { tree } = setup()
    await flush()

    const text = textOf(tree)
    expect(text).toContain('bash (2)')
    expect(text).toContain('edit (1)')
    expect(text).toContain('web (12)')
    expect(text).toContain('allow 11')
  })

  it('删除需二次确认，确认后才调用 permission.saved.remove', async () => {
    const alertMock = Alert.alert as jest.Mock
    alertMock.mockClear()
    const { client, tree } = setup()
    await flush()

    const deleteButtons = findAllPressable(tree).filter((b: any) =>
      textOf({ toJSON: () => b } as any) === 'Delete',
    )
    // 每条规则至少一个 Delete 入口（mock 下 pressable 可能重复计数）
    expect(deleteButtons.length).toBeGreaterThanOrEqual(rules.length)

    await act(async () => { deleteButtons[0].props.onPress() })

    // 仅弹确认，尚未删除
    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(client.call).not.toHaveBeenCalledWith('permission.saved.remove', expect.anything())

    // 模拟用户点击 Alert 的 Delete（destructive）
    const buttons = alertMock.mock.calls[0][2] as Array<{ style?: string; onPress?: () => void }>
    const destructive = buttons.find((b) => b.style === 'destructive')
    expect(destructive).toBeDefined()
    await act(async () => { destructive!.onPress!() })

    expect(client.call).toHaveBeenCalledWith('permission.saved.remove', { id: 'r1' })
  })
})
