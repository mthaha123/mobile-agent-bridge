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
