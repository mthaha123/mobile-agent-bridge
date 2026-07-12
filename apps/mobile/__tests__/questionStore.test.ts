import { useQuestionStore } from '../src/stores/questionStore'

beforeEach(() => {
  useQuestionStore.setState({ pending: [], visible: false })
})

describe('addQuestion', () => {
  it('appends a question and sets visible', () => {
    useQuestionStore.getState().addQuestion({
      id: 'q1', sessionID: 's1',
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
      pending: [{ id: 'q1', sessionID: 's1', questions: [] }],
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
        { id: 'q1', sessionID: 's1', questions: [] },
        { id: 'q2', sessionID: 's1', questions: [] },
        { id: 'q3', sessionID: 's2', questions: [] },
      ],
      visible: true,
    })
    useQuestionStore.getState().clearSession('s1')
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().pending[0].id).toBe('q3')
    expect(useQuestionStore.getState().visible).toBe(true)
  })
})
