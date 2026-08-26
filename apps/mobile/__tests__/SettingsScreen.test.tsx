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
import { useSettingsStore } from '../src/stores/settingsStore'
import { useConfigStore } from '../src/stores/configStore'
import { APP_VERSION } from '../src/config/appInfo'
import { mockClient, resetAllStores, textOf, findAllPressable } from './test-utils'

beforeEach(() => {
  resetAllStores()
  useSettingsStore.setState({ defaultAgent: null, defaultModel: null, loaded: true })
  useConfigStore.setState({ agents: [], commands: [], models: [], loading: false, error: null })
})

/** 按 text 匹配找可按压节点（mock 下可能重复，取首个）。
 *  mode: 'exact' 全等 | 'prefix' 前缀（行内 label+value 双文本拼接场景）。
 *  弹窗条目类交互请勿用子树匹配——遮罩层 Touchable 子树包含全部文本，
 *  应改用"文本节点向上找可点击祖先"模式 */
function pressByText(
  tree: ReturnType<typeof TestRenderer.create>,
  label: string,
  mode: 'exact' | 'prefix' = 'exact',
) {
  const hit = findAllPressable(tree).find((b: any) => {
    const t = textOf({ toJSON: () => b } as any)
    return mode === 'exact' ? t === label : t.startsWith(label)
  })
  expect(hit).toBeDefined()
  return hit!
}

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

// ─── Defaults 区块（默认 Agent / 默认 Model）──────────────

describe('SettingsScreen — Defaults', () => {
  it('未设置时两个默认项均显示 Server default', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    const text = textOf(tree)
    expect(text).toContain('Default Agent')
    expect(text).toContain('Default Model')
    expect(text).toContain('Server default')
  })

  it('点击 Default Agent 行弹出候选并可选择', async () => {
    // opencode /api/agent 实际形态：只有 id + description，无 name/label 字段
    act(() => {
      useConfigStore.setState({
        agents: [
          { id: 'build', description: 'The default agent.' },
          { id: 'plan', description: 'Plan mode.' },
        ],
      })
    })
    const tree = TestRenderer.create(<SettingsScreen />)

    await act(async () => { pressByText(tree, 'Default Agent', 'prefix').props.onPress() })

    // 显示 id 而非 "Agent N" 占位
    expect(textOf(tree)).toContain('build')
    expect(textOf(tree)).toContain('plan')
    expect(textOf(tree)).not.toContain('Agent 1')

    await act(async () => { pressByText(tree, 'plan', 'prefix').props.onPress() })

    expect(useSettingsStore.getState().defaultAgent).toBe('plan')
  })

  it('候选行展示 description 副文本（有则显示）', async () => {
    act(() => {
      useConfigStore.setState({ agents: [{ id: 'build', description: 'The default agent.' }] })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    await act(async () => { pressByText(tree, 'Default Agent', 'prefix').props.onPress() })
    expect(textOf(tree)).toContain('The default agent.')
  })

  it('Agent 候选含清除项，选择后回到 Server default', async () => {
    useSettingsStore.setState({ defaultAgent: 'build' })
    act(() => {
      useConfigStore.setState({ agents: [{ id: 'build' }] })
    })
    const tree = TestRenderer.create(<SettingsScreen />)

    await act(async () => { pressByText(tree, 'Default Agent', 'prefix').props.onPress() })
    await act(async () => { pressByText(tree, 'Server default').props.onPress() })

    expect(useSettingsStore.getState().defaultAgent).toBeNull()
  })

  it('Default Model 经 ModelPickerModal 选择后写入 {id, providerID}', async () => {
    act(() => {
      useConfigStore.setState({ models: [{ id: 'm1', providerID: 'p1', name: 'Model One' }] })
    })
    const tree = TestRenderer.create(<SettingsScreen />)

    await act(async () => { pressByText(tree, 'Default Model', 'prefix').props.onPress() })

    expect(useSettingsStore.getState().defaultModel).toBeNull()
    // 遮罩层 Touchable 的子树同样包含条目文本，不能按子树文本匹配；
    // 采用"文本节点向上找最近可点击祖先"（与 ModelPickerModal.test 同款）
    const labelNode = tree.root.findAll(
      (n: any) => n.type && n.props?.children === 'Model One',
    )[0]
    expect(labelNode).toBeTruthy()
    let item: any = labelNode
    while (item && typeof item.props?.onPress !== 'function') item = item.parent
    await act(async () => { item.props.onPress() })

    expect(useSettingsStore.getState().defaultModel).toEqual({ id: 'm1', providerID: 'p1' })
  })

  it('已设置时行值展示 provider/model 标识', () => {
    useSettingsStore.setState({ defaultModel: { id: 'm1', providerID: 'p1' } })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('p1/m1')
  })
})

// ─── About 区块（版本信息）────────────────────────────────

describe('SettingsScreen — About', () => {
  it('展示 App 版本与 Bridge 版本', async () => {
    const client = mockClient({ 'health.ping': () => ({ ok: true, bridgeVersion: '0.2.0' }) })
    act(() => {
      useAuthStore.setState({ client: client as any })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    await act(async () => {})

    const text = textOf(tree)
    expect(text).toContain('App Version')
    expect(text).toContain('Bridge Version')
    expect(text).toContain(`v${APP_VERSION}`)
    expect(text).toContain('v0.2.0')
  })

  it('health.ping 失败时降级显示 unknown 且不崩溃', async () => {
    // mockClient 未声明 health.ping → call 抛错，走 catch 分支
    const client = mockClient({})
    act(() => {
      useAuthStore.setState({ client: client as any })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    await act(async () => {})

    expect(textOf(tree)).toContain('(unknown)')
  })
})
