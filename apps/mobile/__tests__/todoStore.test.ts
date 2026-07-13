import { useTodoStore, TodoItem } from '../src/stores/todoStore'

const sampleTodos: TodoItem[] = [
  { content: 'Fix login bug', status: 'pending', priority: 'high' },
  { content: 'Add tests', status: 'done', priority: 'medium' },
]

function resetStore() {
  useTodoStore.setState({ todos: {} })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  resetStore()
})

describe('setTodos', () => {
  it('stores todos keyed by sessionId', () => {
    useTodoStore.getState().setTodos('sess-1', sampleTodos)

    const todos = useTodoStore.getState().todos
    expect(todos['sess-1']).toEqual(sampleTodos)
  })

  it('replaces existing todos for the same sessionId', () => {
    useTodoStore.getState().setTodos('sess-1', sampleTodos)

    const replacement: TodoItem[] = [
      { content: 'Refactor module', status: 'in_progress', priority: 'low' },
    ]
    useTodoStore.getState().setTodos('sess-1', replacement)

    expect(useTodoStore.getState().todos['sess-1']).toEqual(replacement)
    expect(useTodoStore.getState().todos['sess-1']).toHaveLength(1)
  })

  it('stores todos for multiple sessions independently', () => {
    useTodoStore.getState().setTodos('sess-1', sampleTodos)
    useTodoStore.getState().setTodos('sess-2', [{ content: 'Write docs', status: 'pending', priority: 'high' }])

    expect(Object.keys(useTodoStore.getState().todos)).toEqual(['sess-1', 'sess-2'])
  })
})

describe('clearSession', () => {
  it('removes todos for the given sessionId', () => {
    useTodoStore.getState().setTodos('sess-1', sampleTodos)
    useTodoStore.getState().setTodos('sess-2', [{ content: 'Fix CI', status: 'pending', priority: 'critical' }])

    useTodoStore.getState().clearSession('sess-1')

    expect(useTodoStore.getState().todos['sess-1']).toBeUndefined()
    expect(useTodoStore.getState().todos['sess-2']).toBeDefined()
  })

  it('does not affect other sessions', () => {
    useTodoStore.getState().setTodos('sess-1', sampleTodos)
    useTodoStore.getState().clearSession('sess-2')

    expect(useTodoStore.getState().todos['sess-1']).toEqual(sampleTodos)
  })
})
