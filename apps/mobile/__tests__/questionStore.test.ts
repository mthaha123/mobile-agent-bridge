import { useQuestionStore } from '../src/stores/questionStore'

beforeEach(() => {
  useQuestionStore.setState({ pending: [], visible: false })
})

describe('addQuestion', () => {
  it('appends a question and sets visible', () => {
    useQuestionStore.getState().addQuestion({
      id: 'q1', sessionId: 's1',
      questions: [{ question: 'Allow?', header: 'Permission', options: [{ label: 'Yes', description: 'Allow it' }] }],
    })
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().pending[0].id).toBe('q1')
    expect(useQuestionStore.getState().visible).toBe(true)
  })
})

describe('removeQuestion', () => {
  it('removes by id', () => {
    useQuestionStore.setState({
      pending: [{ id: 'q1', sessionId: 's1', questions: [] }],
      visible: true,
    })
    useQuestionStore.getState().removeQuestion('q1')
    expect(useQuestionStore.getState().pending).toHaveLength(0)
    expect(useQuestionStore.getState().visible).toBe(false)
  })
})

describe('clearSession', () => {
  it('removes all questions for a session', () => {
    useQuestionStore.setState({
      pending: [
        { id: 'q1', sessionId: 's1', questions: [] },
        { id: 'q2', sessionId: 's1', questions: [] },
        { id: 'q3', sessionId: 's2', questions: [] },
      ],
      visible: true,
    })
    useQuestionStore.getState().clearSession('s1')
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().pending[0].id).toBe('q3')
    expect(useQuestionStore.getState().visible).toBe(true)
  })
})

describe('setVisible', () => {
  it('toggles visible state', () => {
    useQuestionStore.getState().setVisible(true)
    expect(useQuestionStore.getState().visible).toBe(true)
    useQuestionStore.getState().setVisible(false)
    expect(useQuestionStore.getState().visible).toBe(false)
  })
})

describe('removeQuestion edge cases', () => {
  it('does nothing for non-existent id', () => {
    useQuestionStore.setState({
      pending: [{ id: 'q1', sessionId: 's1', questions: [] }],
      visible: true,
    })
    useQuestionStore.getState().removeQuestion('non-existent')
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().visible).toBe(true)
  })

  it('hides visible when removing last question', () => {
    useQuestionStore.setState({
      pending: [{ id: 'q1', sessionId: 's1', questions: [] }],
      visible: true,
    })
    useQuestionStore.getState().removeQuestion('q1')
    expect(useQuestionStore.getState().pending).toHaveLength(0)
    expect(useQuestionStore.getState().visible).toBe(false)
  })

  it('keeps visible when other questions remain', () => {
    useQuestionStore.setState({
      pending: [
        { id: 'q1', sessionId: 's1', questions: [] },
        { id: 'q2', sessionId: 's1', questions: [] },
      ],
      visible: true,
    })
    useQuestionStore.getState().removeQuestion('q1')
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().visible).toBe(true)
  })
})

describe('addQuestion edge cases', () => {
  it('appends to existing pending questions', () => {
    useQuestionStore.getState().addQuestion({
      id: 'q1', sessionId: 's1',
      questions: [{ question: 'Q1', header: '', options: [] }],
    })
    useQuestionStore.getState().addQuestion({
      id: 'q2', sessionId: 's2',
      questions: [{ question: 'Q2', header: '', options: [] }],
    })
    expect(useQuestionStore.getState().pending).toHaveLength(2)
    expect(useQuestionStore.getState().pending[0].id).toBe('q1')
    expect(useQuestionStore.getState().pending[1].id).toBe('q2')
  })
})

describe('clearSession edge cases', () => {
  it('does nothing for non-existent session', () => {
    useQuestionStore.setState({
      pending: [{ id: 'q1', sessionId: 's1', questions: [] }],
      visible: true,
    })
    useQuestionStore.getState().clearSession('non-existent')
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().visible).toBe(true)
  })

  it('hides visible when all questions cleared', () => {
    useQuestionStore.setState({
      pending: [{ id: 'q1', sessionId: 's1', questions: [] }],
      visible: true,
    })
    useQuestionStore.getState().clearSession('s1')
    expect(useQuestionStore.getState().pending).toHaveLength(0)
    expect(useQuestionStore.getState().visible).toBe(false)
  })
})
