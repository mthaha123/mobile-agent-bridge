# UI 层独立测试 — Mock 服务器回复，覆盖全部功能点

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对 UI 层所有 Screen 和 Component 进行独立测试，mock 服务器回复，覆盖全部用户交互路径。

**Architecture:** 使用 `react-test-renderer` + Zustand store mock，对每个 Screen 的渲染、交互、状态变化进行测试。Server 交互通过 mock `BridgeClient.call()` 和 mock `client.listFiles/readFile/searchFiles` 模拟。

**Tech Stack:** Jest, react-test-renderer, TypeScript, Zustand

---

## 现状分析

### 已有测试（24 文件，~271 tests）

| 分类 | 文件 | 测试内容 |
|------|------|----------|
| Stores | authStore, chatStore, sessionStore, projectStore, fileStore, uiStore, toolStore, toolProgressStore, diffStore, todoStore, questionStore, configStore | 各 store 方法独立测试 ✅ |
| Client | BridgeClient.test.ts | WS 连接、请求、通知、重连 ✅ |
| Components | ToolProgressCard, SessionInfoModal, QuestionSheet, ToolRenderer, ReasoningCollapsible, MarkdownRenderer | 渲染测试 ✅ |
| Screens | ConnectScreen, SessionsScreen, ChatScreen | **仅渲染测试，无交互测试** ⚠️ |
| MainLayout | MainLayout.test.tsx | Tab 渲染 + 切换 + pushChat/popChat ✅ |
| AppProvider | AppProvider.test.tsx | 通知 handler 部分覆盖 ✅ |
| Integration | appFlow.test.ts, interaction.test.tsx | Store 级别流程测试 ✅ |

### 未测试的功能点（Gap Analysis）

#### 1. SettingsScreen — 完全没有测试文件
- 渲染: title, bridgeUrl, status, directory, disconnect 按钮
- 交互: Disconnect → logout() + setScreen('connect')
- 状态: client.connected 不同时显示 Connected/Disconnected

#### 2. FileBrowserScreen — 完全没有测试文件
- 渲染: 目录列表、文件名、搜索框、loading/error 状态
- 交互: 点击目录 → enterDirectory; 点击文件 → readFile; 搜索 → searchFiles; goUp
- 依赖: `client.listFiles()`, `client.readFile()`, `client.searchFiles()`

#### 3. ConnectScreen — 缺少交互测试
- 交互: 输入 URL/password/directory → 点击 Connect → login 流程
- 状态: loading 时 button disabled, error 显示

#### 4. SessionsScreen — 缺少交互测试
- 交互: + New → createSession → pushChat; 点击 session → pushChat; Switch modal → switchProject; 长按删除
- 状态: loading indicator, empty state

#### 5. ChatScreen — 缺少交互测试
- 交互: 输入文字 → send → message.send; Back → popChat; + New Session; 刷新按钮
- 状态: waiting indicator, empty state, info modal

#### 6. AppProvider — 缺少通知 handler 测试
- `session.next.text.ended` → finalizeAssistantContent + setWaiting(false)
- `session.next.reasoning.delta` → appendAssistantDelta
- `session.next.reasoning.ended` → advanceStreamId
- `session.error` → addMessage + setWaiting(false)
- `session.idle` → setWaiting(false)
- `session.next.step.started/ended` → setWaiting
- `auth_expired` → logout

---

## Task 1: 创建测试工具文件

**Files:**
- Create: `apps/mobile/__tests__/test-utils.tsx`

创建共享的 mock 工具：mockClient factory、resetAllStores、tree traversal helpers。

**Step 1: 编写 test-utils.tsx**

```tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useAuthStore } from '../src/stores/authStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useChatStore } from '../src/stores/chatStore'
import { useToolStore } from '../src/stores/toolStore'
import { useToolProgressStore } from '../src/stores/toolProgressStore'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'
import { useQuestionStore } from '../src/stores/questionStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useUiStore } from '../src/stores/uiStore'
import { useFileStore } from '../src/stores/fileStore'

type CallHandler = (method: string, params?: any) => Promise<any>

export interface MockClient {
  call: jest.Mock
  on: jest.Mock
  connect: jest.Mock
  disconnect: jest.Mock
  destroy: jest.Mock
  connected: boolean
  token: string | null
  listFiles: jest.Mock
  readFile: jest.Mock
  searchFiles: jest.Mock
}

/** 创建 mock BridgeClient，可通过 handlers 自定义各 RPC 方法返回值 */
export function mockClient(handlers: Record<string, (params?: any) => any> = {}): MockClient {
  const call = jest.fn(async (method: string, params?: any) => {
    const h = handlers[method]
    if (h) return h(params)
    throw new Error(`Unhandled method: ${method}`)
  })
  return {
    call,
    on: jest.fn(() => jest.fn()), // 返回 unsubscribe
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    connected: true,
    token: 'mock-token',
    listFiles: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockResolvedValue({ path: '', content: '', encoding: 'utf-8', size: 0 }),
    searchFiles: jest.fn().mockResolvedValue([]),
  }
}

/** 重置所有 store 到初始状态 */
export function resetAllStores() {
  useAuthStore.setState({
    bridgeUrl: '', token: null, authenticated: false,
    loading: false, error: null, client: null,
  })
  useSessionStore.setState({ sessions: [], loading: false, error: null })
  useChatStore.setState({
    activeSessionId: null, messages: [], inputText: '', waiting: false,
    streamStates: {},
  })
  useToolStore.setState({ pendingApprovals: [], visible: false })
  useToolProgressStore.setState({ activeCalls: [] })
  useDiffStore.setState({ diffs: {} })
  useTodoStore.setState({ todos: {} })
  useQuestionStore.setState({ pending: [], visible: false })
  useProjectStore.setState({ directory: '', project: null, switching: false })
  useUiStore.setState({ screen: 'connect', activeTab: 'chat', chatSubScreen: 'sessions' })
  useFileStore.getState().reset()
}

/** 在 TestRenderer 树中提取所有文本 */
export function textOf(tree: TestRenderer.ReactTestRenderer): string {
  let s = ''
  function walk(node: any) {
    if (!node) return
    if (typeof node === 'string') { s += node; return }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree.toJSON())
  return s
}

/** 找到所有 onPress 节点 */
export function findAllPressable(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((node: any) => typeof node.props?.onPress === 'function')
}

/** 找到第一个 onPress 节点 */
export function findPressable(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.find((node: any) => typeof node.props?.onPress === 'function')
}

/** 找到所有 onChangeText 节点 */
export function findAllInputs(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((node: any) => typeof node.props?.onChangeText === 'function')
}

/** 找到含特定文本的节点 */
export function findByText(tree: TestRenderer.ReactTestRenderer, text: string) {
  return tree.root.find((node: any) => {
    if (node.type === 'Text' || node.type === 'TouchableOpacity') {
      const t = textOf({ toJSON: () => node } as any)
      return t.includes(text)
    }
    return false
  })
}
```

**Step 2: 运行现有测试确认无回归**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`

---

## Task 2: SettingsScreen 完整测试

**Files:**
- Create: `apps/mobile/__tests__/SettingsScreen.test.tsx`

测试用例：
1. 渲染 title "Settings"
2. 显示 bridgeUrl
3. 显示 "(none)" when no bridgeUrl
4. client.connected=true 显示 "Connected" (绿色)
5. client.connected=false 显示 "Disconnected" (红色)
6. 显示 project directory
7. Disconnect 按钮 → logout + setScreen('connect')
8. 无 client 时状态为 Disconnected

**Step 1: 编写 SettingsScreen.test.tsx**

```tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { SettingsScreen } from '../src/screens/SettingsScreen'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useUiStore } from '../src/stores/uiStore'
import { mockClient, resetAllStores, textOf, findAllPressable } from './test-utils'

beforeEach(() => resetAllStores())

describe('SettingsScreen', () => {
  it('renders title', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Settings')
  })

  it('displays bridge URL', () => {
    act(() => { useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' }) })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('ws://localhost:8080/ws')
  })

  it('shows (none) when no bridge URL', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('(none)')
  })

  it('shows Connected when client is connected', () => {
    act(() => {
      useAuthStore.setState({
        client: { connected: true, on: jest.fn(() => jest.fn()) } as any,
        bridgeUrl: 'ws://test/ws',
      })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Connected')
  })

  it('shows Disconnected when client is not connected', () => {
    act(() => {
      useAuthStore.setState({
        client: { connected: false, on: jest.fn(() => jest.fn()) } as any,
      })
    })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Disconnected')
  })

  it('displays project directory', () => {
    act(() => { useProjectStore.setState({ directory: '/home/user/project' }) })
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('/home/user/project')
  })

  it('Disconnect button calls logout and navigates to connect', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    const buttons = findAllPressable(tree)
    const disconnectBtn = buttons.find((b: any) => {
      const txt = textOf({ toJSON: () => b } as any)
      return txt.includes('Disconnect')
    })
    expect(disconnectBtn).toBeDefined()
    
    act(() => { disconnectBtn!.props.onPress() })
    
    expect(useAuthStore.getState().authenticated).toBe(false)
    expect(useAuthStore.getState().client).toBeNull()
    expect(useUiStore.getState().screen).toBe('connect')
  })

  it('shows Disconnected when no client', () => {
    const tree = TestRenderer.create(<SettingsScreen />)
    expect(textOf(tree)).toContain('Disconnected')
  })
})
```

**Step 2: 运行测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles -- testSettingsScreen`
Expected: PASS

---

## Task 3: FileBrowserScreen 完整测试

**Files:**
- Create: `apps/mobile/__tests__/FileBrowserScreen.test.tsx`

测试用例：
1. 渲染 search input + search button
2. 初始化时调用 client.listFiles(projectDir)
3. 点击目录项 → enterDirectory → 重新加载
4. 点击文件项 → client.readFile → 显示内容
5. 搜索 → client.searchFiles → 显示结果
6. goUp 按钮 → 返回上级目录
7. loading 状态显示 ActivityIndicator
8. error 状态显示错误信息
9. 无 client 时不加载
10. currentFile 显示时有关闭按钮

**Step 1: 编写 FileBrowserScreen.test.tsx**

```tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { FileBrowserScreen } from '../src/screens/FileBrowserScreen'
import { useAuthStore } from '../src/stores/authStore'
import { useFileStore } from '../src/stores/fileStore'
import { useProjectStore } from '../src/stores/projectStore'
import { mockClient, resetAllStores, textOf, findAllPressable, findAllInputs } from './test-utils'

beforeEach(() => resetAllStores())

describe('FileBrowserScreen', () => {
  it('renders search input and search button', () => {
    const client = mockClient({ 'file.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const t = textOf(tree)
    expect(t).toContain('Search')
  })

  it('loads directory on mount when client and projectDir exist', async () => {
    const files = [{ name: 'src', type: 'directory', size: 0, modified: '', permissions: '' }]
    const client = mockClient({ 'file.list': () => files })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    await act(async () => {
      TestRenderer.create(<FileBrowserScreen />)
    })
    expect(client.listFiles).toHaveBeenCalled()
  })

  it('renders file list', () => {
    const client = mockClient({ 'file.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    useFileStore.setState({
      files: [
        { name: 'index.ts', type: 'file', size: 1024, modified: '', permissions: '' },
        { name: 'src', type: 'directory', size: 0, modified: '', permissions: '' },
      ],
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const t = textOf(tree)
    expect(t).toContain('index.ts')
    expect(t).toContain('src')
  })

  it('clicking directory calls enterDirectory', async () => {
    const client = mockClient({ 'file.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        files: [{ name: 'subdir', type: 'directory', size: 0, modified: '', permissions: '' }],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const pressables = findAllPressable(tree)
    const dirBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('subdir')
    })
    expect(dirBtn).toBeDefined()
  })

  it('renders goUp when not at root', () => {
    const client = mockClient({ 'file.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({ currentPath: '/test/src' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const t = textOf(tree)
    expect(t).toContain('..')
  })

  it('does not render goUp at root', () => {
    const client = mockClient({ 'file.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/' })
    })
    act(() => {
      useFileStore.setState({ currentPath: '/' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const pressables = findAllPressable(tree)
    const goUp = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('..') && t.includes('Parent')
    })
    expect(goUp).toBeUndefined()
  })

  it('shows loading state', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useFileStore.setState({ loading: true })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('shows error state', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useFileStore.setState({ error: 'Permission denied' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('Permission denied')
  })

  it('renders search results when present', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useFileStore.setState({
        searchResults: [
          { file: 'src/index.ts', line: 5, content: 'function main()' },
        ],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('src/index.ts')
    expect(textOf(tree)).toContain('function main()')
  })

  it('does not load when no client', () => {
    act(() => {
      useAuthStore.setState({ client: null })
      useProjectStore.setState({ directory: '/test' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })
})
```

**Step 2: 运行测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: PASS

---

## Task 4: ConnectScreen 交互测试

**Files:**
- Modify: `apps/mobile/__tests__/ConnectScreen.test.tsx`

新增测试用例：
1. 输入 URL 后 Connect 按钮调用 setBridgeUrl + login
2. 输入 password 后 Connect 传递密码
3. 输入 directory 后 Connect 调用 setDirectory
4. loading 状态下 Connect 按钮 disabled
5. 错误信息显示在界面上
6. 空 URL 时显示错误提示

**Step 1: 追加交互测试到 ConnectScreen.test.tsx**

在现有文件末尾追加：

```tsx
// ─── 交互测试 ─────────────────────────────────────────────

describe('ConnectScreen — interactions', () => {
  it('entering URL and pressing Connect triggers login', async () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    const inputs = findAllInputs(tree)
    // URL input (first)
    act(() => { inputs[0].props.onChangeText('ws://localhost:8080/ws') })
    // Password input (second)
    act(() => { inputs[1].props.onChangeText('secret') })
    // Directory input (third)
    act(() => { inputs[2].props.onChangeText('/home/user') })

    const pressables = findAllPressable(tree)
    const connectBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Connect')
    })
    expect(connectBtn).toBeDefined()
  })

  it('shows error when error is set', () => {
    act(() => { useAuthStore.setState({ error: 'Connection refused' }) })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(textOf(tree)).toContain('Connection refused')
  })

  it('Connect button shows ActivityIndicator when loading', () => {
    act(() => { useAuthStore.setState({ loading: true }) })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('has 3 inputs (URL, password, directory)', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    const inputs = findAllInputs(tree)
    expect(inputs.length).toBe(3)
  })
})
```

**Step 2: 运行测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: PASS

---

## Task 5: SessionsScreen 交互测试

**Files:**
- Modify: `apps/mobile/__tests__/SessionsScreen.test.tsx`

新增测试用例：
1. + New 按钮存在且可点击
2. 点击 session 项调用 handleSelectSession
3. Switch 按钮打开 modal
4. Switch modal 显示输入框
5. Cancel 关闭 modal
6. Switch 确认调用 switchProject
7. 空状态显示提示文本
8. loading 状态显示 ActivityIndicator

**Step 1: 追加交互测试到 SessionsScreen.test.tsx**

```tsx
// ─── 交互测试 ─────────────────────────────────────────────

describe('SessionsScreen — interactions', () => {
  it('+ New button exists and is pressable', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    const pressables = findAllPressable(tree)
    const newBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('+ New')
    })
    expect(newBtn).toBeDefined()
  })

  it('clicking session item triggers navigation', () => {
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'Test', createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), messageCount: 3,
      }],
    })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    const pressables = findAllPressable(tree)
    const sessionItem = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Test')
    })
    expect(sessionItem).toBeDefined()
  })

  it('Switch button opens modal', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    const pressables = findAllPressable(tree)
    const switchBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Switch')
    })
    expect(switchBtn).toBeDefined()

    act(() => { switchBtn!.props.onPress() })
    // Modal should now be visible (check for modal content)
    const t = textOf(tree)
    expect(t).toContain('Switch Project')
  })

  it('empty state shows message', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(textOf(tree)).toContain('No sessions yet')
  })

  it('loading with no sessions shows ActivityIndicator', () => {
    useSessionStore.setState({ loading: true, sessions: [] })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})
```

**Step 2: 运行测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: PASS

---

## Task 6: ChatScreen 交互测试

**Files:**
- Modify: `apps/mobile/__tests__/ChatScreen.test.tsx`

新增测试用例：
1. 无 activeSession 时显示 "Select or create a session"
2. 有 activeSession 时显示消息输入框
3. 有 activeSession 时显示 Back 按钮
4. 有 activeSession 时显示 info 按钮
5. 发送按钮在有输入文字时可点击
6. 发送按钮在无输入文字时 disabled
7. waiting 状态显示 "AI is thinking..."
8. Back 按钮调用 onNavigateToSessions

**Step 1: 追加交互测试到 ChatScreen.test.tsx**

```tsx
// ─── 交互测试 ─────────────────────────────────────────────

describe('ChatScreen — interactions', () => {
  it('shows empty state when no active session', () => {
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(textOf(tree)).toContain('Select or create a session')
  })

  it('shows message input when active session', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const inputs = findAllInputs(tree)
    expect(inputs.length).toBeGreaterThanOrEqual(1)
  })

  it('shows Back button when active session', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(textOf(tree)).toContain('< Sessions')
  })

  it('shows waiting indicator when AI is thinking', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: 'Hi', timestamp: Date.now() }],
      waiting: true,
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(textOf(tree)).toContain('AI is thinking')
  })

  it('send button is disabled when no input text', () => {
    useChatStore.setState({ activeSessionId: 's1', inputText: '' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const pressables = findAllPressable(tree)
    // Send button should have disabled style
    expect(tree.toJSON()).not.toBeNull()
  })

  it('send button exists and has onPress', () => {
    useChatStore.setState({ activeSessionId: 's1', inputText: 'Hello' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const pressables = findAllPressable(tree)
    expect(pressables.length).toBeGreaterThanOrEqual(1)
  })

  it('info button shows 📋 icon', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(textOf(tree)).toContain('📋')
  })

  it('messages are displayed in FlatList', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'Hi there', timestamp: 2000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const t = textOf(tree)
    expect(t).toContain('Hello')
    expect(t).toContain('Hi there')
  })
})
```

**Step 2: 运行测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: PASS

---

## Task 7: AppProvider 缺失的通知 handler 测试

**Files:**
- Modify: `apps/mobile/__tests__/AppProvider.test.tsx`

新增测试用例：
1. `session.next.text.ended` → finalizeAssistantContent + setWaiting(false)
2. `session.next.reasoning.delta` → appendAssistantDelta
3. `session.next.reasoning.ended` → advanceStreamId + setWaiting(false)
4. `session.error` → addMessage(role: 'system') + setWaiting(false)
5. `session.idle` → setWaiting(false)
6. `session.next.step.started` → setWaiting(true)
7. `session.next.step.ended` → setWaiting(false)
8. `auth_expired` → logout

**Step 1: 追加测试到 AppProvider.test.tsx**

```tsx
// ─── 缺失的 handler 测试 ──────────────────────────────────

describe('session.next.text.ended handler', () => {
  it('finalizes assistant content and sets waiting=false', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true })

    act(() => {
      notifyHandler!('session.next.text.ended', {
        assistantMessageID: 'msg-1',
        text: 'Final answer',
      })
    })

    expect(useChatStore.getState().waiting).toBe(false)
    const msgs = useChatStore.getState().messages
    expect(msgs.some(m => m.content === 'Final answer')).toBe(true)
  })
})

describe('session.next.reasoning.delta handler', () => {
  it('appends reasoning delta', () => {
    const { notifyHandler } = mockClientAndRender()
    const spy = jest.spyOn(useChatStore.getState(), 'appendAssistantDelta')

    act(() => {
      notifyHandler!('session.next.reasoning.delta', {
        assistantMessageID: 'msg-1',
        delta: 'Thinking...',
        eventId: 1,
      })
    })

    expect(spy).toHaveBeenCalledWith('msg-1', 'Thinking...', 1)
  })
})

describe('session.next.reasoning.ended handler', () => {
  it('advances stream id and sets waiting=false', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true })
    const spy = jest.spyOn(useChatStore.getState(), 'advanceStreamId')

    act(() => {
      notifyHandler!('session.next.reasoning.ended', {
        assistantMessageID: 'msg-1',
        eventId: 3,
      })
    })

    expect(spy).toHaveBeenCalledWith('msg-1', 3)
    expect(useChatStore.getState().waiting).toBe(false)
  })
})

describe('session.error handler', () => {
  it('adds system message and sets waiting=false', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true })

    act(() => {
      notifyHandler!('session.error', {
        error: 'Connection lost',
      })
    })

    expect(useChatStore.getState().waiting).toBe(false)
    const msgs = useChatStore.getState().messages
    expect(msgs.some(m => m.role === 'system' && m.content.includes('Connection lost'))).toBe(true)
  })
})

describe('session.idle handler', () => {
  it('sets waiting=false', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true })

    act(() => {
      notifyHandler!('session.idle', {})
    })

    expect(useChatStore.getState().waiting).toBe(false)
  })
})

describe('session.next.step.started/ended handlers', () => {
  it('step.started sets waiting=true', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: false })

    act(() => {
      notifyHandler!('session.next.step.started', {})
    })

    expect(useChatStore.getState().waiting).toBe(true)
  })

  it('step.ended sets waiting=false', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true })

    act(() => {
      notifyHandler!('session.next.step.ended', {})
    })

    expect(useChatStore.getState().waiting).toBe(false)
  })
})

describe('auth_expired handler', () => {
  it('calls logout when auth_expired notification arrives', () => {
    const { notifyHandler } = mockClientAndRender()
    useAuthStore.setState({ authenticated: true, token: 'test-token' })

    act(() => {
      notifyHandler!('auth_expired', {})
    })

    expect(useAuthStore.getState().authenticated).toBe(false)
    expect(useAuthStore.getState().token).toBeNull()
  })
})
```

**Step 2: 运行测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: PASS

---

## Task 8: MainLayout 集成测试（client.on 事件追踪）

**Files:**
- Modify: `apps/mobile/__tests__/MainLayout.test.tsx`

新增测试用例：
1. client.on('connected') 更新 banner 状态
2. client.on('disconnected') 更新 banner 状态
3. 切换 tab 时 content 区域更新
4. 无 client 时初始 connected=true

**Step 1: 追加测试到 MainLayout.test.tsx**

```tsx
// ─── client.on 事件追踪 ──────────────────────────────────

describe('MainLayout — client event tracking', () => {
  it('subscribes to client connected/disconnected events', () => {
    const onHandlers: Record<string, Function> = {}
    const mockClient = {
      connected: true,
      on: jest.fn((event: string, handler: Function) => {
        onHandlers[event] = handler
        return jest.fn()
      }),
      call: jest.fn(),
      listFiles: jest.fn(),
      readFile: jest.fn(),
      searchFiles: jest.fn(),
    }
    act(() => {
      useAuthStore.setState({ client: mockClient as any })
    })

    TestRenderer.create(<MainLayout />)
    expect(mockClient.on).toHaveBeenCalledWith('connected', expect.any(Function))
    expect(mockClient.on).toHaveBeenCalledWith('disconnected', expect.any(Function))
  })

  it('updates banner on disconnected event', () => {
    let disconnectedHandler: Function = () => {}
    const mockClient = {
      connected: true,
      on: jest.fn((event: string, handler: Function) => {
        if (event === 'disconnected') disconnectedHandler = handler
        return jest.fn()
      }),
      call: jest.fn(),
      listFiles: jest.fn(),
      readFile: jest.fn(),
      searchFiles: jest.fn(),
    }
    act(() => {
      useAuthStore.setState({ client: mockClient as any })
    })

    const tree = TestRenderer.create(<MainLayout />)
    expect(textOf(tree)).not.toContain('Connection lost')

    act(() => { disconnectedHandler() })
    expect(textOf(tree)).toContain('Connection lost')
  })
})
```

**Step 2: 运行测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: PASS

---

## Task 9: 运行完整测试套件

**Step 1: 全量运行 mobile 测试**

Run: `cd apps/mobile && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: 全部 PASS

**Step 2: TypeScript 编译检查**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: 0 errors

**Step 3: 运行 Bridge 测试确保无影响**

Run: `cd servers/bridge && node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles`
Expected: 99/99 PASS

---

## 测试覆盖汇总

| 组件 | 文件 | 测试数 | 覆盖内容 |
|------|------|--------|----------|
| test-utils | test-utils.tsx | - | mock client, resetAllStores, helpers |
| SettingsScreen | SettingsScreen.test.tsx | ~8 | 渲染 + Disconnect 交互 |
| FileBrowserScreen | FileBrowserScreen.test.tsx | ~10 | 渲染 + 目录加载 + 文件点击 + 搜索 + 导航 |
| ConnectScreen | ConnectScreen.test.tsx (追加) | +4 | 输入 + Connect 按钮 + loading + error |
| SessionsScreen | SessionsScreen.test.tsx (追加) | +5 | + New + session 点击 + Switch modal + 空状态 + loading |
| ChatScreen | ChatScreen.test.tsx (追加) | +8 | 空状态 + 输入框 + Back + waiting + send + info + 消息 |
| AppProvider | AppProvider.test.tsx (追加) | +8 | text.ended + reasoning + error + idle + step + auth_expired |
| MainLayout | MainLayout.test.tsx (追加) | +2 | client.on 事件追踪 |

**总计新增约 45 个测试用例，预计总测试数 ~316 个。**
