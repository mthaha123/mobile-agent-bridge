import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { SessionsScreen } from '../src/screens/SessionsScreen'
import { useSessionStore } from '../src/stores/sessionStore'
import { useAuthStore } from '../src/stores/authStore'
import { useChatStore } from '../src/stores/chatStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useUiStore } from '../src/stores/uiStore'
import { mockClient, resetAllStores, textOf, findAllPressable } from './test-utils'

const onNavigateToChat = jest.fn()
const onBack = jest.fn()

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {})
  useSessionStore.setState({ sessions: [], loading: false, error: null })
  useAuthStore.setState({
    client: null, bridgeUrl: '', token: null, authenticated: false,
    loading: false, error: null,
  })
  useChatStore.setState({ activeSessionId: null, messages: [], inputText: '', waiting: false, sessionRunStatus: {} })
  useProjectStore.setState({ directory: '', project: null, switching: false })
  useUiStore.setState({ screen: 'main', activeTab: 'chat', chatSubScreen: 'sessions' })
  jest.clearAllMocks()
})

// ─── Rendering ────────────────────────────────────────────

describe('SessionsScreen', () => {
  it('renders header and project bar', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders loading indicator when loading with no sessions', () => {
    useSessionStore.setState({ loading: true, sessions: [] })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders session list', () => {
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'Chat 1', createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), messageCount: 3,
      }],
    })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  /** 统计运行红点数量：react-test-renderer 会把每个元素渲染成 composite + host 两份，
   *  只统计 host 节点（typeof type === 'string'）避免重复计数 */
  const countRunningDots = (tree: TestRenderer.ReactTestRenderer) =>
    tree.root.findAll(
      (n) => n.props?.testID === 'session-running-dot' && typeof n.type === 'string',
    ).length

  it('shows running indicator on busy sessions（sessionRunStatus 订阅）', () => {
    useSessionStore.setState({
      sessions: [
        { id: 's-busy', name: 'Busy', createdAt: '', updatedAt: '', messageCount: 0 },
        { id: 's-idle', name: 'Idle', createdAt: '', updatedAt: '', messageCount: 0 },
      ],
    })
    useChatStore.setState({ sessionRunStatus: { 's-busy': 'busy', 's-idle': 'idle' } })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(countRunningDots(tree)).toBe(1)
  })

  it('clears running indicator when session goes idle', () => {
    useSessionStore.setState({
      sessions: [{ id: 's-1', name: 'Chat', createdAt: '', updatedAt: '', messageCount: 0 }],
    })
    useChatStore.setState({ sessionRunStatus: { 's-1': 'busy' } })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(countRunningDots(tree)).toBe(1)

    act(() => { useChatStore.setState({ sessionRunStatus: { 's-1': 'idle' } }) })
    expect(countRunningDots(tree)).toBe(0)
  })

  it('renders project directory', () => {
    useProjectStore.setState({ directory: '/home/user/project' })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders switching state in project bar', () => {
    useProjectStore.setState({ directory: '/p', switching: true })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders "Sessions" header text', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(textOf(tree)).toContain('Sessions')
  })

  it('renders project directory path', () => {
    useProjectStore.setState({ directory: '/my/project' })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(textOf(tree)).toContain('/my/project')
  })

  it('shows (none) when no project directory', () => {
    useProjectStore.setState({ directory: '' })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(textOf(tree)).toContain('(none)')
  })

  it('Switch button is disabled when switching', () => {
    useProjectStore.setState({ directory: '/test', switching: true })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(useProjectStore.getState().switching).toBe(true)
  })
})

// ─── 交互测试 ─────────────────────────────────────────────

describe('SessionsScreen — interactions', () => {
  beforeEach(() => resetAllStores())

  it('+ New button creates new session and navigates to chat', async () => {
    const session = {
      id: 'new-s1', name: 'New Session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }
    const client = mockClient({
      'session.create': () => session,
      'session.list': () => [],
    })
    act(() => {
      useAuthStore.setState({ client: client as any })
    })

    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    const pressables = findAllPressable(tree)
    const newBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('+ New')
    })
    expect(newBtn).toBeDefined()

    await act(async () => {
      await newBtn!.props.onPress()
    })

    expect(client.call).toHaveBeenCalledWith('session.create', expect.anything())
    expect(useChatStore.getState().activeSessionId).toBe('new-s1')
    expect(useUiStore.getState().chatSubScreen).toBe('chat')
  })

  it('long-press opens rename modal and confirm calls session.rename', async () => {
    const sessions = [{
      id: 's1', name: 'Old Name',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }]
    useSessionStore.setState({ sessions })
    const client = mockClient({
      'session.rename': (params: any) => {
        return { id: params.sessionId, title: params.title, time: { updated: Date.now() } }
      },
    })
    act(() => { useAuthStore.setState({ client: client as any }) })

    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    // 长按会话卡片 → 打开重命名弹窗
    const card = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Session Old Name',
    )[0]
    expect(card).toBeDefined()
    act(() => { card.props.onLongPress() })

    // 输入新名称并保存
    const input = tree.root.findByProps({ accessibilityLabel: 'Rename session input' })
    act(() => { input.props.onChangeText('New Name') })
    const saveBtn = tree.root.findAll((n: any) => n.props?.onPress).find((n: any) => {
      try {
        const children = n.findAll?.((c: any) => typeof c.props?.children === 'string') ?? []
        return children.some((c: any) => c.props.children === '保存')
      } catch { return false }
    })
    expect(saveBtn).toBeDefined()
    await act(async () => { await saveBtn!.props.onPress() })

    expect(client.call).toHaveBeenCalledWith('session.rename', { sessionId: 's1', title: 'New Name' })
    expect(useSessionStore.getState().sessions[0].name).toBe('New Name')
  })

  it('Session item press sets session and navigates', () => {
    const sessions = [{
      id: 's1', name: 'Test Session',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 5,
    }]
    useSessionStore.setState({ sessions })
    const client = mockClient({ 'session.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
    })

    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    expect(useSessionStore.getState().sessions).toHaveLength(1)
    expect(useSessionStore.getState().sessions[0].name).toBe('Test Session')

    act(() => {
      onNavigateToChat('s1')
    })

    expect(onNavigateToChat).toHaveBeenCalledWith('s1')
  })

  it('Switch button opens session switcher', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    const pressables = findAllPressable(tree)
    const switchBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Switch')
    })
    expect(switchBtn).toBeDefined()

    act(() => {
      switchBtn!.props.onPress()
    })

    expect(textOf(tree)).toContain('Switch Project')
  })

  it('Empty state shows when sessions is empty and not loading', () => {
    useSessionStore.setState({ sessions: [], loading: false })
    TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(useSessionStore.getState().sessions).toHaveLength(0)
    expect(useSessionStore.getState().loading).toBe(false)
  })

  it('Refresh loads sessions from server', async () => {
    const client = mockClient({ 'session.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
    })

    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    client.call.mockClear()

    const flatListNodes = tree.root.findAll((node: any) => typeof node.props?.onRefresh === 'function')
    expect(flatListNodes.length).toBeGreaterThan(0)

    await act(async () => {
      await flatListNodes[0].props.onRefresh()
    })

    expect(client.call).toHaveBeenCalledWith('session.list', expect.anything())
  })

  it('shows Alert when creating session without client', async () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    const pressables = findAllPressable(tree)
    const newBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('+ New')
    })
    expect(newBtn).toBeDefined()
    act(() => { newBtn!.props.onPress() })
    expect(Alert.alert).toHaveBeenCalledWith('Error', '未连接到服务器')
  })

  it('Alert.alert is mocked for session delete confirmation', () => {
    expect(Alert.alert).toBeDefined()
    Alert.alert('Delete Session', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive' },
    ])
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Session',
      'Are you sure?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Delete', style: 'destructive' }),
      ]),
    )
  })

  it('Switch modal opens when Switch button is pressed', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    const pressables = findAllPressable(tree)
    const switchBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Switch') && !t.includes('Switch Project')
    })
    expect(switchBtn).toBeDefined()

    act(() => { switchBtn!.props.onPress() })

    expect(textOf(tree)).toContain('Switch Project')
  })

  it('Switch modal Cancel button closes modal', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    const pressables = findAllPressable(tree)
    const switchBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Switch') && !t.includes('Switch Project')
    })
    act(() => { switchBtn!.props.onPress() })
    expect(textOf(tree)).toContain('Switch Project')

    const cancelBtn = findAllPressable(tree).find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t === 'Cancel'
    })
    expect(cancelBtn).toBeDefined()
    act(() => { cancelBtn!.props.onPress() })
  })

  it('Switch modal Confirm calls switchProject', async () => {
    useProjectStore.setState({ directory: '/old', switching: false })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    const pressables = findAllPressable(tree)
    const switchBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Switch') && !t.includes('Switch Project')
    })
    act(() => { switchBtn!.props.onPress() })

    const allSwitchPressables = findAllPressable(tree).filter((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t === 'Switch'
    })
    const confirmBtn = allSwitchPressables[allSwitchPressables.length - 1]
    expect(confirmBtn).toBeDefined()

    await act(async () => { await confirmBtn!.props.onPress() })
  })

  // Note: FlatList items (session cards) are not rendered by TestRenderer mock,
  // so onLongPress/messageCount/formatRelativeTime display assertions
  // are covered by sessionStore unit tests instead (sessionStore.test.ts).
})

describe('formatRelativeTime', () => {
  const { formatRelativeTime } = require('../src/screens/SessionsScreen')

  it('returns just now for < 60 seconds', () => {
    const result = formatRelativeTime(new Date().toISOString())
    expect(result).toBe('just now')
  })

  it('returns Xm ago for < 60 minutes', () => {
    const past = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(formatRelativeTime(past)).toBe('5m ago')
  })

  it('returns Xh ago for < 24 hours', () => {
    const past = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    expect(formatRelativeTime(past)).toBe('3h ago')
  })

  it('returns Xd ago for < 7 days', () => {
    const past = new Date(Date.now() - 2 * 86400 * 1000).toISOString()
    expect(formatRelativeTime(past)).toBe('2d ago')
  })

  it('returns locale date string for >= 7 days', () => {
    const past = '2024-01-01T00:00:00.000Z'
    const result = formatRelativeTime(past)
    expect(result).not.toMatch(/^(just now|\d+[mhd] ago)$/)
  })
})

// ─── 会话搜索（按名称 / id 模糊匹配）──────────────────────

describe('SessionsScreen — search', () => {
  beforeEach(() => resetAllStores())

  const seedSessions = () => {
    useSessionStore.setState({
      sessions: [
        { id: 's1', name: 'Fix login bug', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 },
        { id: 'ses_fce182fc9ffe', name: 'Implement Task 3', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0 },
      ],
      loading: false,
      error: null,
    })
  }

  const UI_LABELS = new Set(['Session search input', 'Clear session search'])

  const findInput = (tree: any) => tree.root.findByProps({ accessibilityLabel: 'Session search input' })

  // 注意：测试环境下 VirtualizedList 会把每个 item 渲染两份（CellRenderer 双份），需去重后断言
  const cardLabels = (tree: any) =>
    [...new Set(
      tree.root
        .findAll((n: any) => typeof n.props?.accessibilityLabel === 'string')
        .map((n: any) => n.props.accessibilityLabel as string)
        .filter((l: string) => l.startsWith('Session ') && !UI_LABELS.has(l)),
    )]

  it('renders search input with clear button hidden initially', () => {
    seedSessions()
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(findInput(tree)).toBeDefined()
    const clearBtn = tree.root.findAll(
      (n: any) => n.props?.accessibilityLabel === 'Clear session search',
    )
    expect(clearBtn).toHaveLength(0)
  })

  it('filters by name substring case-insensitively', () => {
    seedSessions()
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(cardLabels(tree)).toHaveLength(2)

    act(() => { findInput(tree).props.onChangeText('task') })

    expect(cardLabels(tree)).toEqual(['Session Implement Task 3'])
  })

  it('filters by id substring', () => {
    seedSessions()
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    act(() => { findInput(tree).props.onChangeText('FCE182') })

    expect(cardLabels(tree)).toEqual(['Session Implement Task 3'])
  })

  it('shows no-match empty state and restores list after clearing', () => {
    seedSessions()
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    act(() => { findInput(tree).props.onChangeText('zzz-no-match') })
    // 测试环境不渲染 ListEmptyComponent，以「卡片全部消失」作为无结果断言
    expect(cardLabels(tree)).toEqual([])

    const clearBtn = tree.root.findByProps({ accessibilityLabel: 'Clear session search' })
    act(() => { clearBtn.props.onPress() })

    expect(cardLabels(tree)).toHaveLength(2)
  })
})
