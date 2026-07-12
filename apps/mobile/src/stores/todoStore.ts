import { create } from 'zustand'

export interface TodoItem {
  content: string
  status: string
  priority: string
}

export interface TodoState {
  todos: Record<string, TodoItem[]>

  setTodos: (sessionID: string, todos: TodoItem[]) => void
  clearSession: (sessionID: string) => void
}

export const useTodoStore = create<TodoState>((set) => ({
  todos: {},

  setTodos: (sessionID, todos) => {
    set((state) => ({
      todos: { ...state.todos, [sessionID]: todos },
    }))
  },

  clearSession: (sessionID) => {
    set((state) => {
      const remaining = { ...state.todos }
      delete remaining[sessionID]
      return { todos: remaining }
    })
  },
}))
