/**
 * fileStore — 单元测试
 */
import { useFileStore } from '../src/stores/fileStore'

describe('fileStore', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('should have initial state', () => {
    const state = useFileStore.getState()
    expect(state.currentPath).toBe('/')
    expect(state.files).toEqual([])
    expect(state.currentFile).toBeNull()
    expect(state.searchResults).toEqual([])
    expect(state.searchQuery).toBe('')
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('should set current path', () => {
    useFileStore.getState().setCurrentPath('/home/user')
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })

  it('should set files', () => {
    const files = [
      { name: 'test.txt', type: 'file' as const, size: 100, modified: '', permissions: '' },
      { name: 'src', type: 'directory' as const, size: 0, modified: '', permissions: '' },
    ]
    useFileStore.getState().setFiles(files)
    expect(useFileStore.getState().files).toEqual(files)
  })

  it('should set current file', () => {
    const file = {
      content: 'Hello World',
      encoding: 'utf-8',
      size: 11,
      path: '/test.txt',
    }
    useFileStore.getState().setCurrentFile(file)
    expect(useFileStore.getState().currentFile).toEqual(file)
  })

  it('should set search results', () => {
    const results = [
      { file: '/test.txt', line: 1, content: 'Hello', match: 'Hello' },
    ]
    useFileStore.getState().setSearchResults(results)
    expect(useFileStore.getState().searchResults).toEqual(results)
  })

  it('should set search query', () => {
    useFileStore.getState().setSearchQuery('test')
    expect(useFileStore.getState().searchQuery).toBe('test')
  })

  it('should set loading', () => {
    useFileStore.getState().setLoading(true)
    expect(useFileStore.getState().loading).toBe(true)
  })

  it('should set error', () => {
    useFileStore.getState().setError('Test error')
    expect(useFileStore.getState().error).toBe('Test error')
  })

  it('should go up', () => {
    useFileStore.getState().setCurrentPath('/home/user/docs')
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })

  it('should go up from root', () => {
    useFileStore.getState().setCurrentPath('/')
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('/')
  })

  it('should go up on Windows drive path without mangling drive letter', () => {
    useFileStore.getState().setCurrentPath('D:/code/mobile-agent-bridge')
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('D:/code')
  })

  it('should go up to drive root on Windows', () => {
    useFileStore.getState().setCurrentPath('D:/code')
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('D:/')
  })

  it('should stay at drive root when going up on Windows', () => {
    useFileStore.getState().setCurrentPath('D:/')
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('D:/')
  })

  it('should normalize backslash Windows path on goUp', () => {
    useFileStore.getState().setCurrentPath('D:\\code\\mobile-agent-bridge')
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('D:/code')
  })

  it('should normalize backslashes when setting current path', () => {
    useFileStore.getState().setCurrentPath('D:\\code\\mobile-agent-bridge')
    expect(useFileStore.getState().currentPath).toBe('D:/code/mobile-agent-bridge')
  })

  it('should enter directory on Windows drive path', () => {
    useFileStore.getState().setCurrentPath('D:/code')
    useFileStore.getState().enterDirectory('mobile-agent-bridge')
    expect(useFileStore.getState().currentPath).toBe('D:/code/mobile-agent-bridge')
  })

  it('should enter directory at Windows drive root', () => {
    useFileStore.getState().setCurrentPath('D:/')
    useFileStore.getState().enterDirectory('code')
    expect(useFileStore.getState().currentPath).toBe('D:/code')
  })

  it('should enter directory from backslash path', () => {
    useFileStore.getState().setCurrentPath('D:\\code')
    useFileStore.getState().enterDirectory('src')
    expect(useFileStore.getState().currentPath).toBe('D:/code/src')
  })

  it('should enter directory', () => {
    useFileStore.getState().setCurrentPath('/home')
    useFileStore.getState().enterDirectory('user')
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })

  it('should enter directory with trailing slash', () => {
    useFileStore.getState().setCurrentPath('/home/')
    useFileStore.getState().enterDirectory('user')
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })

  it('should reset state', () => {
    useFileStore.getState().setCurrentPath('/test')
    useFileStore.getState().setFiles([{ name: 'test', type: 'file', size: 0, modified: '', permissions: '' }])
    useFileStore.getState().setLoading(true)

    useFileStore.getState().reset()

    const state = useFileStore.getState()
    expect(state.currentPath).toBe('/')
    expect(state.files).toEqual([])
    expect(state.loading).toBe(false)
  })
})

describe('fileStore — HTML viewer', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('should open HTML viewer with viewerMode html and viewerHtmlRendered true', () => {
    const file = { content: '<h1>Hello</h1>', encoding: 'utf-8', size: 14, path: '/test.html' }
    useFileStore.getState().openHtmlViewer(file)
    const state = useFileStore.getState()
    expect(state.viewerMode).toBe('html')
    expect(state.currentFile).toEqual(file)
    expect(state.viewerHtmlRendered).toBe(true)
    expect(state.viewerImage).toBeNull()
  })

  it('should toggle html rendered state', () => {
    const file = { content: '<p>Hi</p>', encoding: 'utf-8', size: 9, path: '/test.html' }
    useFileStore.getState().openHtmlViewer(file)
    expect(useFileStore.getState().viewerHtmlRendered).toBe(true)
    useFileStore.getState().toggleHtmlRendered()
    expect(useFileStore.getState().viewerHtmlRendered).toBe(false)
    useFileStore.getState().toggleHtmlRendered()
    expect(useFileStore.getState().viewerHtmlRendered).toBe(true)
  })

  it('should close HTML viewer', () => {
    const file = { content: '<p>Hi</p>', encoding: 'utf-8', size: 9, path: '/test.html' }
    useFileStore.getState().openHtmlViewer(file)
    expect(useFileStore.getState().viewerMode).toBe('html')
    useFileStore.getState().closeViewer()
    expect(useFileStore.getState().viewerMode).toBeNull()
  })

  it('should reset viewerHtmlRendered on reset', () => {
    useFileStore.getState().toggleHtmlRendered()
    expect(useFileStore.getState().viewerHtmlRendered).toBe(false)
    useFileStore.getState().reset()
    expect(useFileStore.getState().viewerHtmlRendered).toBe(true)
  })
})
