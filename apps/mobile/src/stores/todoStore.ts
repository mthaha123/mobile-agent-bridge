import { create } from 'zustand'

export interface TodoItem {
  content: string
  status: string
  priority: string
}

export interface TodoState {
  todos: Record<string, TodoItem[]>

  setTodos: (sessionId: string, todos: TodoItem[]) => void
  clearSession: (sessionId: string) => void
}

export const useTodoStore = create<TodoState>((set) => ({
  todos: {},

  setTodos: (sessionId, todos) => {
    set((state) => ({
      todos: { ...state.todos, [sessionId]: todos },
    }))
  },

  clearSession: (sessionId) => {
    set((state) => {
      const remaining = { ...state.todos }
      delete remaining[sessionId]
      return { todos: remaining }
    })
  },
}))
