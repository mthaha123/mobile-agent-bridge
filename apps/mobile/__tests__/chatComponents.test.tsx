/**
 * chat 子组件单元测试
 *
 * 覆盖此前 0 测试覆盖的核心聊天组件：
 * PermissionDock / QuestionDock / ShellOutput / DiffDisplay /
 * ThinkingShimmer / ToolErrorCard / ContextToolGroup / AttachmentBar / BasicTool / PartBlock
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert, Clipboard } from 'react-native'
import { PermissionDock } from '../src/components/chat/PermissionDock'
import { QuestionDock } from '../src/components/chat/QuestionDock'
import { ShellOutput } from '../src/components/chat/ShellOutput'
import { DiffDisplay } from '../src/components/chat/DiffDisplay'
import { ThinkingShimmer } from '../src/components/chat/ThinkingShimmer'
import { ToolErrorCard } from '../src/components/chat/ToolErrorCard'
import { ContextToolGroup, groupContextTools, isContextTool } from '../src/components/chat/ContextToolGroup'
import { AttachmentBar } from '../src/components/chat/AttachmentBar'
import { ToolPart } from '../src/components/chat/BasicTool'
import { PartBlock } from '../src/components/chat/PartBlock'
import { useToolStore } from '../src/stores/toolStore'
import { useQuestionStore } from '../src/stores/questionStore'
import { useAttachmentStore } from '../src/stores/attachmentStore'
import { useAuthStore } from '../src/stores/authStore'
import { resetAllStores, textOf, findAllPressable } from './test-utils'

function mockClient() {
  return {
    call: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    connected: true,
    token: 'mock-token',
  }
}

/** 找到文本包含 label 的 onPress 节点 */
function findPressableByText(tree: TestRenderer.ReactTestRenderer, label: string) {
  const pressables = findAllPressable(tree)
  return pressables.find((n) => {
    let text = ''
    function walk(node: any) {
      if (!node) return
      if (typeof node === 'string') { text += node; return }
      if (node.children) {
        if (Array.isArray(node.children)) node.children.forEach(walk)
        else walk(node.children)
      }
    }
    walk(n)
    return text.includes(label)
  })
}

beforeEach(() => {
  resetAllStores()
  jest.clearAllMocks()
})

// ─── PermissionDock ───────────────────────────────────────

describe('PermissionDock', () => {
  const approval = { id: 'a1', tool: 'read', args: { path: 'src/index.ts' }, sessionId: 's1', requestedAt: 1 }

  it('renders nothing when no approvals', () => {
    const tree = TestRenderer.create(<PermissionDock />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders tool name and args', () => {
    useToolStore.setState({ pendingApprovals: [approval] })
    const tree = TestRenderer.create(<PermissionDock />)
    expect(textOf(tree)).toContain('read')
    expect(textOf(tree)).toContain('src/index.ts')
    expect(textOf(tree)).toContain('Reject')
    expect(textOf(tree)).toContain('Approve')
    expect(textOf(tree)).toContain('Always Allow')
  })

  it('reject button calls reject and dequeues', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useToolStore.setState({ pendingApprovals: [approval] })
    const tree = TestRenderer.create(<PermissionDock />)
    const btn = findPressableByText(tree, 'Reject')!
    await act(async () => { btn.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('permission.reply', {
      sessionId: 's1', id: 'a1', reply: 'reject',
    })
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('approve button calls approve and dequeues', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useToolStore.setState({ pendingApprovals: [approval] })
    const tree = TestRenderer.create(<PermissionDock />)
    const btn = findPressableByText(tree, 'Approve')!
    await act(async () => { btn.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('permission.reply', {
      sessionId: 's1', id: 'a1', reply: 'once',
    })
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('always allow button calls alwaysAllow and dequeues', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useToolStore.setState({ pendingApprovals: [approval] })
    const tree = TestRenderer.create(<PermissionDock />)
    const btn = findPressableByText(tree, 'Always Allow')!
    await act(async () => { btn.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('permission.reply', {
      sessionId: 's1', id: 'a1', reply: 'always',
    })
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('does not crash when no client connected', async () => {
    useToolStore.setState({ pendingApprovals: [approval] })
    const tree = TestRenderer.create(<PermissionDock />)
    const btn = findPressableByText(tree, 'Approve')!
    await act(async () => { btn.props.onPress() })
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('renders multiple approvals', () => {
    useToolStore.setState({
      pendingApprovals: [
        approval,
        { id: 'a2', tool: 'write', args: { path: '/b.ts' }, sessionId: 's1', requestedAt: 2 },
      ],
    })
    const tree = TestRenderer.create(<PermissionDock />)
    const t = textOf(tree)
    expect(t).toContain('read')
    expect(t).toContain('write')
  })
})

// ─── QuestionDock ─────────────────────────────────────────

describe('QuestionDock', () => {
  const question = {
    id: 'q1',
    sessionId: 's1',
    questions: [{
      question: '选择操作方式',
      header: 'mode',
      options: [
        { label: '只读', description: 'read only' },
        { label: '写入', description: 'write' },
      ],
      multiple: false,
    }],
  }

  it('renders nothing when not visible', () => {
    useQuestionStore.setState({ pending: [question], visible: false })
    const tree = TestRenderer.create(<QuestionDock />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders question text and options when visible', () => {
    useQuestionStore.setState({ pending: [question], visible: true })
    const tree = TestRenderer.create(<QuestionDock />)
    const t = textOf(tree)
    expect(t).toContain('选择操作方式')
    expect(t).toContain('只读')
    expect(t).toContain('写入')
    expect(t).toContain('Reject')
    expect(t).toContain('Submit')
  })

  it('reject calls question.reject and removes question', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useQuestionStore.setState({ pending: [question], visible: true })
    const tree = TestRenderer.create(<QuestionDock />)
    const btn = findPressableByText(tree, 'Reject')!
    await act(async () => { btn.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('question.reject', { id: 'q1' })
    expect(useQuestionStore.getState().pending).toHaveLength(0)
  })

  it('submit with no selection sends empty answer', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useQuestionStore.setState({ pending: [question], visible: true })
    const tree = TestRenderer.create(<QuestionDock />)
    const btn = findPressableByText(tree, 'Submit')!
    await act(async () => { btn.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('question.reply', {
      id: 'q1', sessionId: 's1', answers: [''],
    })
  })

  it('selecting an option and submitting sends that answer', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useQuestionStore.setState({ pending: [question], visible: true })
    const tree = TestRenderer.create(<QuestionDock />)
    const opt = findPressableByText(tree, '只读')!
    await act(async () => { opt.props.onPress() })
    const submit = findPressableByText(tree, 'Submit')!
    await act(async () => { submit.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('question.reply', {
      id: 'q1', sessionId: 's1', answers: ['只读'],
    })
  })

  it('multi-select question collects multiple labels', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useQuestionStore.setState({
      visible: true,
      pending: [{
        id: 'q2', sessionId: 's1',
        questions: [{
          question: '多选', header: 'multi',
          options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
          multiple: true,
        }],
      }],
    })
    const tree = TestRenderer.create(<QuestionDock />)
    const optA = findPressableByText(tree, 'A')!
    const optB = findPressableByText(tree, 'B')!
    await act(async () => { optA.props.onPress() })
    await act(async () => { optB.props.onPress() })
    const submit = findPressableByText(tree, 'Submit')!
    await act(async () => { submit.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('question.reply', {
      id: 'q2', sessionId: 's1', answers: ['A, B'],
    })
  })

  it('single-select toggles off on second press', async () => {
    const client = mockClient()
    useAuthStore.setState({ client: client as any })
    useQuestionStore.setState({ pending: [question], visible: true })
    const tree = TestRenderer.create(<QuestionDock />)
    const opt = findPressableByText(tree, '只读')!
    await act(async () => { opt.props.onPress() })
    await act(async () => { opt.props.onPress() })
    const submit = findPressableByText(tree, 'Submit')!
    await act(async () => { submit.props.onPress() })
    expect(client.call).toHaveBeenCalledWith('question.reply', {
      id: 'q1', sessionId: 's1', answers: [''],
    })
  })
})

// ─── ShellOutput ──────────────────────────────────────────

describe('ShellOutput', () => {
  it('renders command with $ prefix', () => {
    const tree = TestRenderer.create(<ShellOutput result="out" input={{ command: 'ls -la' }} />)
    expect(textOf(tree)).toContain('$ ls -la')
  })

  it('accepts cmd key as alternative to command', () => {
    const tree = TestRenderer.create(<ShellOutput result="out" input={{ cmd: 'echo hi' }} />)
    expect(textOf(tree)).toContain('$ echo hi')
  })

  it('renders output lines with line numbers and count', () => {
    const tree = TestRenderer.create(
      <ShellOutput result={'file1\nfile2\nfile3'} input={{ command: 'ls' }} />,
    )
    const t = textOf(tree)
    expect(t).toContain('file1')
    expect(t).toContain('file2')
    expect(t).toContain('3 lines')
  })

  it('renders container even when no result and no command', () => {
    const tree = TestRenderer.create(<ShellOutput result="" input={{}} />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('shows "显示全部" button when >20 lines and expands on press', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line-${i}`).join('\n')
    const tree = TestRenderer.create(<ShellOutput result={lines} input={{ command: 'ls' }} />)
    const before = textOf(tree)
    expect(before).toContain('显示全部 25 行')

    const btn = findPressableByText(tree, '显示全部')!
    act(() => { btn.props.onPress() })
    const after = textOf(tree)
    expect(after).toContain('line-24')
    expect(after).toContain('收起')
  })

  it('does not show expand button when within 20 lines', () => {
    const tree = TestRenderer.create(<ShellOutput result={'a\nb'} input={{ command: 'ls' }} />)
    expect(textOf(tree)).not.toContain('显示全部')
    expect(textOf(tree)).toContain('2 lines')
  })

  it('renders empty result without output block', () => {
    const tree = TestRenderer.create(<ShellOutput result="" input={{ command: 'ls' }} />)
    const t = textOf(tree)
    expect(t).toContain('$ ls')
    expect(t).not.toContain('lines')
  })
})

// ─── DiffDisplay ──────────────────────────────────────────

describe('DiffDisplay', () => {
  it('renders nothing when both strings empty', () => {
    const tree = TestRenderer.create(<DiffDisplay oldString="" newString="" />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders file path header', () => {
    const tree = TestRenderer.create(
      <DiffDisplay oldString="a" newString="b" filePath="src/a.ts" />,
    )
    expect(textOf(tree)).toContain('src/a.ts')
  })

  it('renders added and removed lines with markers', () => {
    const tree = TestRenderer.create(
      <DiffDisplay oldString="old line" newString="new line" />,
    )
    const t = textOf(tree)
    expect(t).toContain('-old line')
    expect(t).toContain('+new line')
  })

  it('renders unchanged lines as context', () => {
    const tree = TestRenderer.create(
      <DiffDisplay oldString="same" newString="same" />,
    )
    expect(textOf(tree)).toContain('same')
  })

  it('renders multi-line diff mixing context and changes', () => {
    const oldStr = 'keep1\nold2\nkeep3'
    const newStr = 'keep1\nnew2\nkeep3'
    const tree = TestRenderer.create(<DiffDisplay oldString={oldStr} newString={newStr} />)
    const t = textOf(tree)
    expect(t).toContain('keep1')
    expect(t).toContain('-old2')
    expect(t).toContain('+new2')
    expect(t).toContain('keep3')
  })
})

// ─── ThinkingShimmer ──────────────────────────────────────

describe('ThinkingShimmer', () => {
  it('renders default message', () => {
    const tree = TestRenderer.create(<ThinkingShimmer animated={false} />)
    expect(textOf(tree)).toContain('Thinking')
  })

  it('renders custom message', () => {
    const tree = TestRenderer.create(<ThinkingShimmer message="分析中" animated={false} />)
    expect(textOf(tree)).toContain('分析中')
  })

  it('animated shows message without dots initially', () => {
    jest.useFakeTimers()
    let tree: TestRenderer.ReactTestRenderer
    act(() => { tree = TestRenderer.create(<ThinkingShimmer />) })
    expect(textOf(tree)).toBe('Thinking')
    jest.useRealTimers()
  })

  it('animated adds dots after interval ticks', () => {
    jest.useFakeTimers()
    let tree: TestRenderer.ReactTestRenderer
    act(() => { tree = TestRenderer.create(<ThinkingShimmer />) })
    act(() => { jest.advanceTimersByTime(400) })
    expect(textOf(tree)).toBe('Thinking.')
    act(() => { jest.advanceTimersByTime(400) })
    expect(textOf(tree)).toBe('Thinking..')
    act(() => { jest.advanceTimersByTime(400) })
    expect(textOf(tree)).toBe('Thinking...')
    act(() => { jest.advanceTimersByTime(400) })
    expect(textOf(tree)).toBe('Thinking')
    jest.useRealTimers()
  })
})

// ─── ToolErrorCard ────────────────────────────────────────

describe('ToolErrorCard', () => {
  it('renders tool name and error', () => {
    const tree = TestRenderer.create(<ToolErrorCard tool="bash" error="command not found" />)
    const t = textOf(tree)
    expect(t).toContain('bash')
    expect(t).toContain('command not found')
  })

  it('uses title over tool when title provided', () => {
    const tree = TestRenderer.create(
      <ToolErrorCard tool="bash" title="Shell 错误" error="boom" />,
    )
    expect(textOf(tree)).toContain('Shell 错误')
    expect(textOf(tree)).not.toContain('bash')
  })

  it('collapses error body on header press', () => {
    const tree = TestRenderer.create(<ToolErrorCard tool="bash" error="secret" />)
    expect(textOf(tree)).toContain('secret')
    const header = findPressableByText(tree, 'bash')!
    act(() => { header.props.onPress() })
    expect(textOf(tree)).not.toContain('secret')
  })

  it('copy button copies error and shows 已复制', () => {
    const tree = TestRenderer.create(<ToolErrorCard tool="bash" error="copy me" />)
    const btn = findPressableByText(tree, '复制错误')!
    act(() => { btn.props.onPress() })
    expect(Clipboard.setString).toHaveBeenCalledWith('copy me')
    expect(textOf(tree)).toContain('已复制')
  })
})

// ─── ContextToolGroup ─────────────────────────────────────

describe('ContextToolGroup', () => {
  it('isContextTool recognizes read/glob/grep/list', () => {
    expect(isContextTool('read')).toBe(true)
    expect(isContextTool('glob')).toBe(true)
    expect(isContextTool('grep')).toBe(true)
    expect(isContextTool('list')).toBe(true)
    expect(isContextTool('edit')).toBe(false)
    expect(isContextTool('bash')).toBe(false)
  })

  it('groupContextTools splits context vs others', () => {
    const parts = [
      { tool: 'read', data: {} },
      { tool: 'edit', data: {} },
      { tool: 'grep', data: {} },
    ]
    const { context, others } = groupContextTools(parts)
    expect(context).toHaveLength(2)
    expect(others).toHaveLength(1)
    expect(others[0].tool).toBe('edit')
  })

  it('renders nothing when no tools', () => {
    const tree = TestRenderer.create(<ContextToolGroup tools={[]} />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders summary with file and search counts', () => {
    const tools = [
      { tool: 'read', data: { path: 'a.ts' } },
      { tool: 'read', data: { path: 'b.ts' } },
      { tool: 'grep', data: { query: 'x' } },
    ]
    const tree = TestRenderer.create(<ContextToolGroup tools={tools} />)
    const t = textOf(tree)
    expect(t).toContain('已收集上下文')
    expect(t).toContain('2 个文件')
    expect(t).toContain('1 次搜索')
  })

  it('expands to show tool details on press', () => {
    const tools = [
      { tool: 'read', data: { path: 'src/a.ts' } },
      { tool: 'grep', data: { query: 'import' } },
    ]
    const tree = TestRenderer.create(<ContextToolGroup tools={tools} />)
    expect(textOf(tree)).not.toContain('src/a.ts')
    const header = findPressableByText(tree, '已收集上下文')!
    act(() => { header.props.onPress() })
    const t = textOf(tree)
    expect(t).toContain('src/a.ts')
    expect(t).toContain('import')
  })
})

// ─── AttachmentBar ────────────────────────────────────────

describe('AttachmentBar', () => {
  it('renders nothing when no attachments', () => {
    const tree = TestRenderer.create(<AttachmentBar />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders file attachment chip with name', () => {
    useAttachmentStore.setState({
      attachments: [{ id: 'a1', type: 'file', name: 'data.json', data: '{}' }],
    })
    const tree = TestRenderer.create(<AttachmentBar />)
    const t = textOf(tree)
    expect(t).toContain('data.json')
    expect(t).toContain('📄')
  })

  it('renders text attachment chip', () => {
    useAttachmentStore.setState({
      attachments: [{ id: 'a1', type: 'text', name: 'note.txt', data: 'hello' }],
    })
    const tree = TestRenderer.create(<AttachmentBar />)
    expect(textOf(tree)).toContain('note.txt')
    expect(textOf(tree)).toContain('📝')
  })

  it('remove button removes attachment', () => {
    useAttachmentStore.setState({
      attachments: [{ id: 'a1', type: 'file', name: 'data.json', data: '{}' }],
    })
    const tree = TestRenderer.create(<AttachmentBar />)
    const btn = findPressableByText(tree, '✕')!
    act(() => { btn.props.onPress() })
    expect(useAttachmentStore.getState().attachments).toHaveLength(0)
  })

  it('renders image attachment', () => {
    useAttachmentStore.setState({
      attachments: [{ id: 'a1', type: 'image', name: 'pic.png', data: 'data:image/png;base64,xx' }],
    })
    const tree = TestRenderer.create(<AttachmentBar />)
    expect(textOf(tree)).toContain('pic.png')
  })
})

// ─── BasicTool (ToolPart) ─────────────────────────────────

describe('ToolPart', () => {
  it('renders tool title and subtitle', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'read', input: { path: 'src/index.ts' }, status: 'called' }} messageRole="assistant" />,
    )
    const t = textOf(tree)
    expect(t).toContain('Read')
    expect(t).toContain('src/index.ts')
  })

  it('shows success checkmark for assistant tool', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'read', input: {}, status: 'success' }} messageRole="assistant" />,
    )
    expect(textOf(tree)).toContain('✓')
  })

  it('shows failed cross', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'read', input: {}, status: 'failed' }} messageRole="assistant" />,
    )
    expect(textOf(tree)).toContain('✗')
  })

  it('shows loading spinner for called/progress', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'read', input: {}, status: 'called' }} messageRole="assistant" />,
    )
    expect(textOf(tree)).toContain('⏳')
  })

  it('does not show status icon for user tool', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'read', input: {}, status: 'success' }} messageRole="user" />,
    )
    expect(textOf(tree)).not.toContain('✓')
  })

  it('expands to show result on trigger press', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'read', input: { path: 'a.ts' }, status: 'success', result: 'file content here' }} messageRole="assistant" />,
    )
    expect(textOf(tree)).not.toContain('file content here')
    const trigger = findAllPressable(tree)[0]
    act(() => { trigger.props.onPress() })
    expect(textOf(tree)).toContain('file content here')
  })

  it('bash tool renders shell output when expanded', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'bash', input: { command: 'ls' }, status: 'success', result: 'a.txt' }} messageRole="assistant" />,
    )
    const trigger = findAllPressable(tree)[0]
    act(() => { trigger.props.onPress() })
    const t = textOf(tree)
    expect(t).toContain('$ ls')
    expect(t).toContain('a.txt')
  })

  it('renders error preview when tool has error', () => {
    const tree = TestRenderer.create(
      <ToolPart data={{ tool: 'read', input: {}, status: 'failed', error: 'permission denied' }} messageRole="assistant" />,
    )
    const trigger = findAllPressable(tree)[0]
    act(() => { trigger.props.onPress() })
    expect(textOf(tree)).toContain('permission denied')
  })
})

// ─── PartBlock ────────────────────────────────────────────

describe('PartBlock', () => {
  const message = { id: 'm1', role: 'assistant' as const, parts: [] }

  it('renders text part content', () => {
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'text', data: { content: 'hello **world**' } }} message={message} />,
    )
    expect(textOf(tree)).toContain('hello')
  })

  it('renders reasoning part collapsible (collapsed by default)', () => {
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'reasoning', data: { content: 'thinking here' } }} message={message} />,
    )
    expect(textOf(tree)).toContain('思考过程')
    expect(textOf(tree)).not.toContain('thinking here')
  })

  it('renders error part via ToolErrorCard', () => {
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'error', data: { tool: 'bash', error: 'boom' } }} message={message} />,
    )
    const t = textOf(tree)
    expect(t).toContain('bash')
    expect(t).toContain('boom')
  })

  it('renders file part with name', () => {
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'file', data: { name: 'package.json' } }} message={message} />,
    )
    expect(textOf(tree)).toContain('package.json')
  })

  it('renders compaction divider', () => {
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'compaction', data: {} }} message={message} />,
    )
    expect(textOf(tree)).toContain('上下文压缩')
  })

  it('renders nothing for unknown part type', () => {
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'unknown' as any, data: {} }} message={message} />,
    )
    expect(tree.toJSON()).toBeNull()
  })

  it('text part long-press triggers Alert menu', () => {
    const alertSpy = jest.spyOn(Alert, 'alert')
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'text', data: { content: 'copyable' } }} message={message} />,
    )
    const longPressables = tree.root.findAll((n: any) => typeof n.props?.onLongPress === 'function')
    expect(longPressables.length).toBeGreaterThan(0)
    act(() => { longPressables[0].props.onLongPress() })
    expect(alertSpy).toHaveBeenCalled()
    alertSpy.mockRestore()
  })

  it('tool part renders tool card', () => {
    const tree = TestRenderer.create(
      <PartBlock part={{ id: 'p1', type: 'tool', data: { tool: 'read', input: { path: 'a.ts' }, status: 'success' } }} message={message} />,
    )
    expect(textOf(tree)).toContain('Read')
  })
})
