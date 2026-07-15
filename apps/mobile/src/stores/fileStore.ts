/**
 * fileStore — 文件浏览器状态管理
 *
 * 管理文件列表、当前路径、文件内容等
 */
import { create } from 'zustand'

export interface FileInfo {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modified: string
  permissions: string
}

export interface FileContent {
  content: string
  encoding: string
  size: number
  path: string
}

export interface SearchResult {
  file: string
  line: number
  content: string
  match?: string
}

export interface FileState {
  /** 当前浏览路径 */
  currentPath: string
  /** 目录列表 */
  files: FileInfo[]
  /** 当前打开的文件内容 */
  currentFile: FileContent | null
  /** 搜索结果 */
  searchResults: SearchResult[]
  /** 搜索关键词 */
  searchQuery: string
  /** 加载状态 */
  loading: boolean
  /** 错误信息 */
  error: string | null

  /** 设置当前路径 */
  setCurrentPath: (path: string) => void
  /** 设置文件列表 */
  setFiles: (files: FileInfo[]) => void
  /** 设置当前文件内容 */
  setCurrentFile: (file: FileContent | null) => void
  /** 设置搜索结果 */
  setSearchResults: (results: SearchResult[]) => void
  /** 设置搜索关键词 */
  setSearchQuery: (query: string) => void
  /** 设置加载状态 */
  setLoading: (loading: boolean) => void
  /** 设置错误信息 */
  setError: (error: string | null) => void
  /** 导航到上级目录 */
  goUp: () => void
  /** 进入子目录 */
  enterDirectory: (dirName: string) => void
  /** 重置状态 */
  reset: () => void
}

const initialState = {
  currentPath: '/',
  files: [],
  currentFile: null,
  searchResults: [],
  searchQuery: '',
  loading: false,
  error: null,
}

export const useFileStore = create<FileState>((set, get) => ({
  ...initialState,

  setCurrentPath: (path) => set({ currentPath: path }),

  setFiles: (files) => set({ files }),

  setCurrentFile: (file) => set({ currentFile: file }),

  setSearchResults: (results) => set({ searchResults: results }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  goUp: () => {
    const { currentPath } = get()
    const parts = currentPath.split('/').filter(Boolean)
    if (parts.length > 0) {
      parts.pop()
      set({ currentPath: '/' + parts.join('/') || '/' })
    }
  },

  enterDirectory: (dirName) => {
    const { currentPath } = get()
    const newPath = currentPath.endsWith('/')
      ? currentPath + dirName
      : currentPath + '/' + dirName
    set({ currentPath: newPath })
  },

  reset: () => set(initialState),
}))
