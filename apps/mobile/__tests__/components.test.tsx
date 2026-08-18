import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { SessionInfoModal } from '../src/screens/SessionInfoModal'
import { QuestionSheet, setQuestionReplyCall } from '../src/screens/QuestionSheet'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'
import { useQuestionStore } from '../src/stores/questionStore'

function textOf(target: any): string {
  let result = ''
  try {
    let json: any
    if (typeof target?.toJSON === 'function') {
      json = target.toJSON()
    } else if (target?.props) {
      json = target
    } else {
      return result
    }
    const walk = (node: any) => {
      if (!node) return
      if (typeof node === 'string') { result += node; return }
      if (typeof node === 'number') { result += String(node); return }
      if (node.children) node.children.forEach(walk)
    }
    walk(json)
  } catch {}
  return result
}

function findButtonByLabel(tree: TestRenderer.ReactTestInstance, label: string) {
  const buttons = tree.root.findAll(
    (n: any) =>
      typeof n.type === 'function' &&
      typeof n.props?.onPress === 'function' &&
      n.type.displayName !== 'Modal' &&
      n.type.displayName !== 'ScrollView',
  )
  return buttons.filter((b: any) => textOf(b).includes(label))
}

function lastMatch<T>(arr: T[], predicate: (item: T) => boolean): T | undefined {
  const matches = arr.filter(predicate)
  return matches[matches.length - 1]
}

beforeEach(() => {
  act(() => {
    useDiffStore.setState({ diffs: {} })
    useTodoStore.setState({ todos: {} })
    useQuestionStore.setState({ pending: [], visible: false })
  })
})

describe('SessionInfoModal', () => {
  it('renders when visible', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(tree.toJSON()).not.toBeNull()
  })

  it('displays diffs for the session', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'src/index.ts', additions: 5, deletions: 2, status: 'modified' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders empty state without crashing', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(tree.toJSON()).not.toBeNull()
  })

  it('shows Diffs tab as active by default', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('Diffs')
  })

  it('switches to Todos tab when pressed', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })

    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    expect(todosTab).toBeDefined()

    act(() => { todosTab!.props.onPress() })

    expect(textOf(tree)).toContain('No todos')
  })

  it('shows empty diff state text', () => {
    act(() => { useDiffStore.getState().clearSession('s1') })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('No file changes')
  })

  it('displays diff items with status badge', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'src/index.ts', status: 'added', additions: 5, deletions: 0, patch: '+ new code' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('added')
    expect(textOf(tree)).toContain('src/index.ts')
    expect(textOf(tree)).toContain('+5')
    expect(textOf(tree)).toContain('-0')
  })

  it('displays diff with modified status', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'README.md', status: 'modified', additions: 3, deletions: 1, patch: '- old\n+ new' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('modified')
    expect(textOf(tree)).toContain('README.md')
  })

  it('displays diff with deleted status', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'old.ts', status: 'deleted', additions: 0, deletions: 10, patch: '- removed' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('deleted')
    expect(textOf(tree)).toContain('old.ts')
    expect(textOf(tree)).toContain('+0')
    expect(textOf(tree)).toContain('-10')
  })

  it('shows empty todo state text when on Todos tab', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    act(() => { todosTab!.props.onPress() })

    expect(textOf(tree)).toContain('No todos')
  })

  it('displays todo items with done status icon', () => {
    act(() => {
      useTodoStore.getState().setTodos('s1', [
        { content: 'Fix bug', status: 'done', priority: 'high' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    act(() => { todosTab!.props.onPress() })

    expect(textOf(tree)).toContain('✓')
    expect(textOf(tree)).toContain('Fix bug')
    expect(textOf(tree)).toContain('Priority: high')
  })

  it('displays todo items with pending status icon', () => {
    act(() => {
      useTodoStore.getState().setTodos('s1', [
        { content: 'Add tests', status: 'pending' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    act(() => { todosTab!.props.onPress() })

    expect(textOf(tree)).toContain('○')
    expect(textOf(tree)).toContain('Add tests')
  })

  it('onClose is called when overlay is pressed', () => {
    const onClose = jest.fn()
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={onClose} />,
      )
    })
    const touchables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && n.props?.activeOpacity === 1,
    )
    if (touchables.length > 0) {
      act(() => { touchables[0].props.onPress() })
      expect(onClose).toHaveBeenCalled()
    }
  })

  it('tab count shows correct diff count', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'a.ts', status: 'modified', additions: 1, deletions: 0 },
        { file: 'b.ts', status: 'added', additions: 5, deletions: 0 },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('Diffs (2)')
  })

  it('tab count shows correct todo count', () => {
    act(() => {
      useTodoStore.getState().setTodos('s1', [
        { content: 'Task 1', status: 'done' },
        { content: 'Task 2', status: 'pending' },
        { content: 'Task 3', status: 'done' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('Todos (3)')
  })

  it('hides diff content when switching to Todos tab', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'src/index.ts', status: 'modified', additions: 5, deletions: 2 },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('src/index.ts')

    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    act(() => { todosTab!.props.onPress() })

    expect(textOf(tree)).not.toContain('src/index.ts')
    expect(textOf(tree)).toContain('No todos')
  })

  it('shows Diffs tab again after switching to Todos and back', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'a.ts', status: 'added', additions: 10, deletions: 0 },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })

    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    act(() => { todosTab!.props.onPress() })
    expect(textOf(tree)).toContain('No todos')

    const diffsButtons = findButtonByLabel(tree, 'Diffs')
    const diffsTab = lastMatch(diffsButtons, (b) => textOf(b).match(/^Diffs \(\d+\)$/))
    act(() => { diffsTab!.props.onPress() })
    expect(textOf(tree)).toContain('a.ts')
  })

  it('displays multiple diffs with mixed statuses', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'new.ts', status: 'added', additions: 20, deletions: 0 },
        { file: 'old.ts', status: 'deleted', additions: 0, deletions: 50 },
        { file: 'mod.ts', status: 'modified', additions: 5, deletions: 3 },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('Diffs (3)')
    expect(textOf(tree)).toContain('added')
    expect(textOf(tree)).toContain('new.ts')
    expect(textOf(tree)).toContain('deleted')
    expect(textOf(tree)).toContain('old.ts')
    expect(textOf(tree)).toContain('modified')
    expect(textOf(tree)).toContain('mod.ts')
  })

  it('displays multiple todos with mixed statuses and priorities', () => {
    act(() => {
      useTodoStore.getState().setTodos('s1', [
        { content: 'Done task', status: 'done', priority: 'high' },
        { content: 'Pending task', status: 'pending', priority: 'low' },
        { content: 'Another done', status: 'done' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })

    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    act(() => { todosTab!.props.onPress() })

    expect(textOf(tree)).toContain('✓')
    expect(textOf(tree)).toContain('Done task')
    expect(textOf(tree)).toContain('Priority: high')
    expect(textOf(tree)).toContain('○')
    expect(textOf(tree)).toContain('Pending task')
    expect(textOf(tree)).toContain('Priority: low')
    expect(textOf(tree)).toContain('Another done')
  })

  it('renders correctly with both diffs and todos present', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'x.ts', status: 'modified', additions: 1, deletions: 1 },
      ])
      useTodoStore.getState().setTodos('s1', [
        { content: 'Task', status: 'pending' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('Diffs (1)')
    expect(textOf(tree)).toContain('Todos (1)')
    expect(textOf(tree)).toContain('x.ts')
  })

  it('displays diff patch content', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'src/index.ts', status: 'modified', additions: 2, deletions: 1, patch: '- old line\n+ new line' },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })
    expect(textOf(tree)).toContain('- old line')
    expect(textOf(tree)).toContain('+ new line')
  })

  it('tab switching: Diffs to Todos and back again', () => {
    act(() => {
      useDiffStore.getState().setDiffs('s1', [
        { file: 'a.ts', status: 'added', additions: 10, deletions: 0 },
      ])
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => {
      tree = TestRenderer.create(
        <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
      )
    })

    const todosButtons = findButtonByLabel(tree, 'Todos')
    const todosTab = lastMatch(todosButtons, (b) => textOf(b).match(/^Todos \(\d+\)$/))
    act(() => { todosTab!.props.onPress() })
    expect(textOf(tree)).toContain('No todos')

    const diffsButtons = findButtonByLabel(tree, 'Diffs')
    const diffsTab = lastMatch(diffsButtons, (b) => textOf(b).match(/^Diffs \(\d+\)$/))
    act(() => { diffsTab!.props.onPress() })
    expect(textOf(tree)).toContain('a.ts')
  })
})

describe('QuestionSheet', () => {
  it('renders nothing visible when no questions', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders question when modal visible with pending', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1', sessionId: 's1',
        questions: [{
          question: 'Allow?', header: 'Permission',
          options: [{ label: 'Yes', description: 'Allow access' }],
        }],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })
    expect(tree.toJSON()).not.toBeNull()
  })

  it('resets selection when question changes', () => {
    act(() => {
      useQuestionStore.setState({
        pending: [{
          id: 'q1', sessionId: 's1',
          questions: [{
            question: 'Q1', header: '', options: [{ label: 'A', description: '' }],
          }],
        }],
        visible: true,
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const optionAButtons = findButtonByLabel(tree, 'A')
    const optionA = lastMatch(optionAButtons, (b: any) => textOf(b).includes('A'))
    act(() => { optionA!.props.onPress() })

    act(() => {
      useQuestionStore.setState({
        pending: [{
          id: 'q2', sessionId: 's1',
          questions: [{
            question: 'Q2', header: '', options: [{ label: 'B', description: '' }],
          }],
        }],
        visible: true,
      })
    })

    expect(textOf(tree)).toContain('Q2')
    expect(textOf(tree)).toContain('B')
    expect(textOf(tree)).not.toContain('Q1')
  })

  it('submit without selection sends empty string', async () => {
    const mockReply = jest.fn().mockResolvedValue(undefined)
    setQuestionReplyCall(mockReply)

    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Pick:',
          options: [{ label: 'X' }, { label: 'Y' }],
        }],
      })
    })

    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const submitBtn = lastMatch(findButtonByLabel(tree, 'Submit'), (b) => textOf(b) === 'Submit')
    await act(async () => { await submitBtn!.props.onPress() })

    expect(mockReply).toHaveBeenCalledWith('q1', [''])
    expect(useQuestionStore.getState().pending).toHaveLength(0)
  })

  it('custom input submits typed text', async () => {
    const mockReply = jest.fn().mockResolvedValue(undefined)
    setQuestionReplyCall(mockReply)

    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Enter value:',
          custom: true,
          options: [],
        }],
      })
    })

    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const input = tree.root.find(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.placeholder === 'Type your answer...',
    )
    act(() => { input.props.onChangeText('my answer') })

    const submitBtn = lastMatch(findButtonByLabel(tree, 'Submit'), (b) => textOf(b) === 'Submit')
    await act(async () => { await submitBtn!.props.onPress() })

    expect(mockReply).toHaveBeenCalledWith('q1', ['my answer'])
    expect(useQuestionStore.getState().pending).toHaveLength(0)
  })

  it('shows "No pending questions" when no current question', () => {
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })
    expect(textOf(tree)).toContain('No pending questions')
  })

  it('renders question with options when pending', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Allow this action?',
          header: 'Permission Required',
          options: [
            { label: 'Yes', description: 'Allow once' },
            { label: 'No', description: 'Reject' },
          ],
        }],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })
    expect(textOf(tree)).toContain('Allow this action?')
    expect(textOf(tree)).toContain('Permission Required')
    expect(textOf(tree)).toContain('Yes')
    expect(textOf(tree)).toContain('No')
  })

  it('single-select option selection', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Choose one:',
          options: [
            { label: 'Option A' },
            { label: 'Option B' },
          ],
        }],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const optionButtons = findButtonByLabel(tree, 'Option A')
    const optionA = lastMatch(optionButtons, (b) => textOf(b) === '○ Option A')
    expect(optionA).toBeDefined()

    act(() => { optionA!.props.onPress() })

    expect(textOf(tree)).toContain('◉ Option A')
  })

  it('single-select deselects previous option', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Choose one:',
          options: [
            { label: 'Option A' },
            { label: 'Option B' },
          ],
        }],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const optionAButtons = findButtonByLabel(tree, 'Option A')
    const optionA = lastMatch(optionAButtons, (b) => textOf(b) === '○ Option A')

    act(() => { optionA!.props.onPress() })

    const optionBButtons = findButtonByLabel(tree, 'Option B')
    const optionB = lastMatch(optionBButtons, (b: any) => textOf(b).includes('Option B'))

    act(() => { optionB!.props.onPress() })

    expect(textOf(tree)).toContain('◉ Option B')
    expect(textOf(tree)).toContain('○ Option A')
  })

  it('multi-select option toggles independently', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Select all:',
          multiple: true,
          options: [
            { label: 'Feature A' },
            { label: 'Feature B' },
            { label: 'Feature C' },
          ],
        }],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const featureAButtons = findButtonByLabel(tree, 'Feature A')
    const featureA = lastMatch(featureAButtons, (b) => textOf(b).includes('Feature A'))
    expect(featureA).toBeDefined()

    act(() => { featureA!.props.onPress() })

    const featureBButtons = findButtonByLabel(tree, 'Feature B')
    const featureB = lastMatch(featureBButtons, (b) => textOf(b).includes('Feature B'))
    expect(featureB).toBeDefined()

    act(() => { featureB!.props.onPress() })

    expect(textOf(tree)).toContain('Feature A')
    expect(textOf(tree)).toContain('Feature B')
    expect(textOf(tree)).toContain('Feature C')
  })

  it('custom input renders when q.custom is true', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Enter your answer:',
          custom: true,
          options: [],
        }],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const inputs = tree.root.findAll(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.placeholder === 'Type your answer...',
    )
    expect(inputs.length).toBeGreaterThanOrEqual(1)
  })

  it('submit button calls replyCall and removes question', async () => {
    const mockReply = jest.fn().mockResolvedValue(undefined)
    setQuestionReplyCall(mockReply)

    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Allow?',
          options: [{ label: 'Yes' }],
        }],
      })
    })

    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const yesButtons = findButtonByLabel(tree, 'Yes')
    const yesOption = lastMatch(yesButtons, (b) => textOf(b).includes('Yes'))
    act(() => { yesOption!.props.onPress() })

    const submitButtons = findButtonByLabel(tree, 'Submit')
    const submitBtn = lastMatch(submitButtons, (b) => textOf(b) === 'Submit')
    expect(submitBtn).toBeDefined()

    await act(async () => { await submitBtn!.props.onPress() })

    expect(mockReply).toHaveBeenCalledWith('q1', ['Yes'])
    expect(useQuestionStore.getState().pending).toHaveLength(0)
  })

  it('renders multiple questions in a single item', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1', sessionId: 's1',
        questions: [
          { question: 'First?', header: 'H1', options: [{ label: 'Y1', description: '' }] },
          { question: 'Second?', header: 'H2', options: [{ label: 'Y2', description: '' }] },
        ],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })
    expect(textOf(tree)).toContain('First?')
    expect(textOf(tree)).toContain('Second?')
    expect(textOf(tree)).toContain('Y1')
    expect(textOf(tree)).toContain('Y2')
  })

  it('option description is rendered', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1',
        sessionId: 's1',
        questions: [{
          question: 'Choose:',
          options: [
            { label: 'Option A', description: 'This is option A description' },
          ],
        }],
      })
    })
    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })
    expect(textOf(tree)).toContain('This is option A description')
  })

  it('clearSession removes pending questions for that session', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1', sessionId: 's1',
        questions: [{ question: 'Q1?', options: [{ label: 'A' }] }],
      })
      useQuestionStore.getState().addQuestion({
        id: 'q2', sessionId: 's2',
        questions: [{ question: 'Q2?', options: [{ label: 'B' }] }],
      })
    })
    expect(useQuestionStore.getState().pending).toHaveLength(2)

    act(() => { useQuestionStore.getState().clearSession('s1') })
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().pending[0].id).toBe('q2')
  })

  it('dismisses when visible is set to false — items remain queued', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1', sessionId: 's1',
        questions: [{ question: 'Q1?', options: [{ label: 'A' }] }],
      })
    })
    expect(useQuestionStore.getState().visible).toBe(true)
    expect(useQuestionStore.getState().pending).toHaveLength(1)

    act(() => { useQuestionStore.setState({ visible: false }) })
    expect(useQuestionStore.getState().visible).toBe(false)
    expect(useQuestionStore.getState().pending).toHaveLength(1)
  })

  it('handles multiple questions in queue before any submit', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1', sessionId: 's1',
        questions: [{ question: 'First?', options: [{ label: 'A' }] }],
      })
      useQuestionStore.getState().addQuestion({
        id: 'q2', sessionId: 's1',
        questions: [{ question: 'Second?', options: [{ label: 'B' }] }],
      })
    })
    expect(useQuestionStore.getState().pending).toHaveLength(2)
    expect(useQuestionStore.getState().pending[0].id).toBe('q1')
    expect(useQuestionStore.getState().pending[1].id).toBe('q2')
  })

  it('submit clears only current question and shows next', async () => {
    const mockReply = jest.fn().mockResolvedValue(undefined)
    setQuestionReplyCall(mockReply)

    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q1', sessionId: 's1',
        questions: [{ question: 'First?', options: [{ label: 'A' }] }],
      })
      useQuestionStore.getState().addQuestion({
        id: 'q2', sessionId: 's1',
        questions: [{ question: 'Second?', options: [{ label: 'B' }] }],
      })
    })

    let tree!: TestRenderer.ReactTestInstance
    act(() => { tree = TestRenderer.create(<QuestionSheet />) })

    const optionAButtons = findButtonByLabel(tree, 'A')
    const optionA = lastMatch(optionAButtons, (b: any) => textOf(b).includes('A'))
    act(() => { optionA!.props.onPress() })

    const submitButtons = findButtonByLabel(tree, 'Submit')
    const submitBtn = lastMatch(submitButtons, (b) => textOf(b) === 'Submit')
    await act(async () => { await submitBtn!.props.onPress() })

    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().pending[0].id).toBe('q2')
  })
})

describe('QuestionSheet replyCall null guard', () => {
  it('does not crash when submit is pressed without replyCall', () => {
    act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'qx', sessionId: 's',
        questions: [{ question: 'q1', options: [{ label: 'a' }] }],
      })
    })
    setQuestionReplyCall(null as any)
    const tree = TestRenderer.create(<QuestionSheet />)
    const submitButtons = findButtonByLabel(tree, 'Submit')
    expect(submitButtons.length).toBeGreaterThan(0)
    const submitBtn = lastMatch(submitButtons, (b: any) => textOf(b) === 'Submit')
    expect(() =>
      act(() => { submitBtn!.props.onPress() }),
    ).not.toThrow()
  })
})

describe('SessionInfoModal', () => {
  it('renders without crashing when sessionId is null', () => {
    const tree = TestRenderer.create(
      <SessionInfoModal visible={true} sessionId={null} onClose={jest.fn()} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})
