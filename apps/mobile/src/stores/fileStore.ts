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

export interface ViewerImage {
  uri: string
  name: string
}

export type ViewerMode = 'text' | 'image' | 'html' | null

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

  /** 查看器类型（text / image / null） */
  viewerMode: ViewerMode
  /** 查看器图片数据 */
  viewerImage: ViewerImage | null
  /** 查看器字号偏好（持久化） */
  viewerFontSize: number
  /** 查看器是否显示行号（持久化） */
  viewerShowLineNumbers: boolean
  /** markdown 文件：是否显示源码（false=渲染） */
  viewerShowSource: boolean
  /** HTML 文件：是否显示渲染后的页面（true=WebView 渲染，false=源码） */
  viewerHtmlRendered: boolean
  /** 文本查看器：是否折行（true=换行模式，false=不换行+横向滚动） */
  viewerWrap: boolean

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
  /** 打开文本查看器 */
  openTextViewer: (file: FileContent) => void
  /** 打开图片查看器 */
  openImageViewer: (image: ViewerImage) => void
  /** 打开 HTML 查看器（WebView 渲染） */
  openHtmlViewer: (file: FileContent) => void
  /** 关闭查看器 */
  closeViewer: () => void
  /** 调节字号 */
  setViewerFontSize: (size: number) => void
  /** 切换行号显示 */
  toggleLineNumbers: () => void
  /** 切换 markdown 渲染/源码 */
  toggleViewerSource: () => void
  /** 切换 HTML 渲染/源码 */
  toggleHtmlRendered: () => void
  /** 切换换行/不换行模式 */
  toggleViewerWrap: () => void
  /** 导航到上级目录 */
  goUp: () => void
  /** 进入子目录 */
  enterDirectory: (dirName: string) => void
  /** 重置状态 */
  reset: () => void
}

/** 统一分隔符为 '/'，并折叠连续 '/'（Windows 反斜杠路径 → 前向斜杠） */
function normalizeSeparators(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/')
}

/**
 * 计算上级目录，兼容 Windows 盘符路径（修复盘符被当作根目录子目录拼接的问题）：
 *  - POSIX：/a/b/c → /a/b → /a → /
 *  - Windows 盘符：D:/a/b/c → D:/a/b → D:/a → D:/（盘符根不再上跳）
 *  - 反斜杠输入：D:\a\b 视为 D:/a/b
 */
function parentPath(p: string): string {
  const norm = normalizeSeparators(p)
  const driveMatch = /^([A-Za-z]:)(.*)$/.exec(norm)
  if (driveMatch) {
    const [, drive, rest] = driveMatch
    const parts = rest.split('/').filter(Boolean)
    if (parts.length === 0) return drive + '/' // 已在盘符根，保持不动
    parts.pop()
    return parts.length === 0 ? drive + '/' : drive + '/' + parts.join('/')
  }
  const parts = norm.split('/').filter(Boolean)
  if (parts.length === 0) return '/'
  parts.pop()
  return '/' + parts.join('/') || '/'
}

const initialState = {
  currentPath: '/',
  files: [],
  currentFile: null,
  searchResults: [],
  searchQuery: '',
  loading: false,
  error: null,
  viewerMode: null as ViewerMode,
  viewerImage: null,
  viewerFontSize: 14,
  viewerShowLineNumbers: true,
  viewerShowSource: false,
  viewerHtmlRendered: true,
  viewerWrap: true,
}

export const useFileStore = create<FileState>((set, get) => ({
  ...initialState,

  setCurrentPath: (path) => set({ currentPath: normalizeSeparators(path) }),

  setFiles: (files) => set({ files }),

  setCurrentFile: (file) => set({ currentFile: file }),

  setSearchResults: (results) => set({ searchResults: results }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  openTextViewer: (file) => set({
    currentFile: file,
    viewerMode: 'text',
    viewerImage: null,
    viewerShowSource: false,
  }),

  openImageViewer: (image) => set({
    viewerImage: image,
    viewerMode: 'image',
    currentFile: null,
  }),

  openHtmlViewer: (file) => set({
    currentFile: file,
    viewerMode: 'html',
    viewerImage: null,
    viewerHtmlRendered: true,
  }),

  closeViewer: () => set({ viewerMode: null, viewerImage: null }),

  setViewerFontSize: (size) => set({ viewerFontSize: Math.max(10, Math.min(24, size)) }),

  toggleLineNumbers: () => set((s) => ({ viewerShowLineNumbers: !s.viewerShowLineNumbers })),

  toggleViewerSource: () => set((s) => ({ viewerShowSource: !s.viewerShowSource })),

  toggleHtmlRendered: () => set((s) => ({ viewerHtmlRendered: !s.viewerHtmlRendered })),

  toggleViewerWrap: () => set((s) => ({ viewerWrap: !s.viewerWrap })),

  goUp: () => {
    const { currentPath } = get()
    if (!currentPath) return
    set({ currentPath: parentPath(currentPath) })
  },

  enterDirectory: (dirName) => {
    const { currentPath } = get()
    const base = normalizeSeparators(currentPath).replace(/\/+$/, '')
    const newPath = base === '' ? '/' + dirName : base + '/' + dirName
    set({ currentPath: newPath })
  },

  reset: () => set(initialState),
}))
