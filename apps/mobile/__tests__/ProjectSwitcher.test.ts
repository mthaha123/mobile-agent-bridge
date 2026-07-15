/**
 * ProjectSwitcher — 单元测试
 */
import { useProjectStore } from '../src/stores/projectStore'
import { useFileStore } from '../src/stores/fileStore'

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      directory: '',
      project: null,
      switching: false,
    })
  })

  it('should have initial state', () => {
    const state = useProjectStore.getState()
    expect(state.directory).toBe('')
    expect(state.project).toBeNull()
    expect(state.switching).toBe(false)
  })

  it('should set directory', () => {
    useProjectStore.getState().setDirectory('/home/user/project')
    expect(useProjectStore.getState().directory).toBe('/home/user/project')
  })

  it('should set project', () => {
    useProjectStore.getState().setProject({
      directory: '/home/user/project',
      project: { name: 'my-project' },
    })
    const state = useProjectStore.getState()
    expect(state.directory).toBe('/home/user/project')
    expect(state.project).toEqual({ name: 'my-project' })
  })

  it('should set switching state', () => {
    useProjectStore.setState({ switching: true })
    expect(useProjectStore.getState().switching).toBe(true)
  })
})

describe('fileStore', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('should have initial state', () => {
    const state = useFileStore.getState()
    expect(state.currentPath).toBe('/')
    expect(state.files).toEqual([])
    expect(state.currentFile).toBeNull()
  })

  it('should set files', () => {
    const files = [
      { name: 'src', type: 'directory' as const, size: 0, modified: '', permissions: '' },
      { name: 'package.json', type: 'file' as const, size: 100, modified: '', permissions: '' },
    ]
    useFileStore.getState().setFiles(files)
    expect(useFileStore.getState().files).toEqual(files)
  })

  it('should navigate up', () => {
    useFileStore.getState().setCurrentPath('/home/user/project')
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })

  it('should enter directory', () => {
    useFileStore.getState().setCurrentPath('/home')
    useFileStore.getState().enterDirectory('user')
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })
})
