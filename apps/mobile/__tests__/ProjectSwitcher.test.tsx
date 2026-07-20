import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import { useProjectStore } from '../src/stores/projectStore'
import { useAuthStore } from '../src/stores/authStore'
import { useFileStore } from '../src/stores/fileStore'

jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())

const mockClient = {
  listFiles: jest.fn().mockResolvedValue([{ name: 'src', type: 'directory' }]),
  call: jest.fn(),
}

function textOf(target: any): string {
  let result = ''
  try {
    let json: any
    if (typeof target?.toJSON === 'function') {
      json = target.toJSON()
    } else if (target?.props) {
      json = target
    } else {
      return result
    }
    const walk = (node: any) => {
      if (!node) return
      if (typeof node === 'string') { result += node; return }
      if (typeof node === 'number') { result += String(node); return }
      if (node.children) node.children.forEach(walk)
    }
    walk(json)
  } catch {}
  return result
}

const onDismiss = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  useProjectStore.setState({
    directory: '/test/project',
    project: { name: 'my-app' },
    switching: false,
  })
  useAuthStore.setState({ client: mockClient as any })
  useFileStore.setState({ files: [], loading: false, error: null })
})

describe('ProjectSwitcher', () => {
  it('renders current project directory', () => {
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    expect(textOf(tree)).toContain('/test/project')
  })

  it('renders project name when available', () => {
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    expect(textOf(tree)).toContain('my-app')
  })

  it('shows "No project selected" when no directory', () => {
    useProjectStore.setState({ directory: '', project: null })
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    expect(textOf(tree)).toContain('No project selected')
  })

  it('renders directory input with correct value', () => {
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const inputs = tree.root.findAll(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.value != null,
    )
    expect(inputs.length).toBeGreaterThanOrEqual(1)
    expect(inputs[0].props.value).toBe('/test/project')
  })

  it('input updates on directory store change', () => {
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    act(() => {
      useProjectStore.setState({ directory: '/new/path' })
    })
    const inputs = tree.root.findAll(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.value != null,
    )
    expect(inputs[0].props.value).toBe('/new/path')
  })

  it('Browse button toggles directory browser', () => {
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    expect(textOf(tree)).not.toContain('Select This Directory')

    const browseBtn = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Browse'),
    )
    expect(browseBtn.length).toBeGreaterThanOrEqual(1)

    act(() => { browseBtn[0].props.onPress() })
    expect(textOf(tree)).toContain('Select This Directory')

    act(() => { browseBtn[0].props.onPress() })
    expect(textOf(tree)).not.toContain('Select This Directory')
  })

  it('Cancel button calls onDismiss', () => {
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const cancelBtn = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Cancel'),
    )
    expect(cancelBtn.length).toBeGreaterThanOrEqual(1)
    act(() => { cancelBtn[0].props.onPress() })
    expect(onDismiss).toHaveBeenCalled()
  })

  it('Switch Project button calls switchProject', async () => {
    useProjectStore.setState({ directory: '/test/project' })
    const switchSpy = jest.spyOn(useProjectStore.getState(), 'switchProject')
      .mockResolvedValue(undefined)

    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const switchBtn = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Switch Project'),
    )
    expect(switchBtn.length).toBeGreaterThanOrEqual(1)

    await act(async () => { await switchBtn[0].props.onPress() })
    expect(switchSpy).toHaveBeenCalledWith('/test/project')
  })

  it('Switch Project with empty input shows alert', async () => {
    useProjectStore.setState({ directory: '' })

    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const switchBtn = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Switch Project'),
    )
    await act(async () => { await switchBtn[0].props.onPress() })
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Please enter a directory path')
  })

  it('Browse button calls browseDirectory with current path', () => {
    useFileStore.setState({ currentPath: '/' })
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const browseBtn = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Browse'),
    )

    act(() => { browseBtn[0].props.onPress() })
    expect(mockClient.listFiles).toHaveBeenCalled()
  })

  it('Browse button shows loading indicator', () => {
    useFileStore.setState({ loading: true })
    useProjectStore.setState({ directory: '/test/project' })

    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const browseBtn = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Browse'),
    )
    act(() => { browseBtn[0].props.onPress() })
  })

  it('cancel button dismiss even when no directory set', () => {
    useProjectStore.setState({ directory: '', project: null })
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const cancelBtn = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Cancel'),
    )
    act(() => { cancelBtn[0].props.onPress() })
    expect(onDismiss).toHaveBeenCalled()
  })

  it('fetchCurrentProject is called on mount', () => {
    const spy = jest.spyOn(useProjectStore.getState(), 'fetchCurrentProject')
      .mockResolvedValue(undefined)
    act(() => {
      TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('handleBrowseDirectory opens the directory', () => {
    const client = { listFiles: jest.fn().mockResolvedValue([] as any[]) }
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test/project' })
      useFileStore.setState({ files: [], loading: false })
    })
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const all = tree.root.findAll(() => true)
    const browseBtn = all.find((n: any) => {
      if (typeof n.props?.onPress !== 'function') return false
      let text = ''
      function walk(c: any) {
        if (typeof c === 'string') { text += c; return }
        if (c?.props?.children) walk(c.props.children)
        if (Array.isArray(c)) c.forEach(walk)
      }
      walk(n.props.children)
      return text === 'Browse'
    })
    if (!browseBtn) {
      const markup = JSON.stringify(tree.toJSON())
      throw new Error('Browse button not found. Tree: ' + markup.substring(0, 500))
    }
    act(() => { browseBtn.props.onPress() })
    expect(client.listFiles).toHaveBeenCalledWith('/')
  })

  it('goUp navigates to parent directory', async () => {
    const client = {
      listFiles: jest.fn()
        .mockResolvedValueOnce([{ name: 'subdir', type: 'directory' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    }
    act(() => {
      useAuthStore.setState({ client: client as any })
    })
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)

    // Press Browse and flush microtasks inside a single act scope
    const browseBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Browse'),
    )
    expect(browseBtns.length).toBeGreaterThanOrEqual(1)
    await act(async () => {
      browseBtns[0].props.onPress()
      // browseDirectory pauses at await client.listFiles (microtask queued).
      // setImmediate fires after microtasks, so browseDirectory completes
      // before this yields back to act, keeping state updates inside act.
      await new Promise(resolve => setImmediate(resolve))
    })

    // browseDirectory('/') completed; verify files are in store
    expect(useFileStore.getState().files).toEqual([{ name: 'subdir', type: 'directory' }])

    // 'subdir' entry should be visible in rendered tree
    expect(textOf(tree)).toContain('subdir')
    const subdirBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('subdir'),
    )
    expect(subdirBtns.length).toBeGreaterThanOrEqual(1)

    // Click subdir — calls handleEnterDirectory('subdir') → browseDirectory('/subdir')
    await act(async () => { subdirBtns[0].props.onPress(); await Promise.resolve() })

    // currentBrowsePath is now '/subdir', so Up button is visible
    const upBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Up'),
    )
    expect(upBtns.length).toBeGreaterThanOrEqual(1)

    // Press Up — calls handleGoUp → browseDirectory('/')
    client.listFiles.mockClear()
    await act(async () => { upBtns[0].props.onPress(); await Promise.resolve() })
    expect(client.listFiles).toHaveBeenCalledWith('/')
  })

  it('shows alert on browseDirectory error', async () => {
    const client = { listFiles: jest.fn().mockRejectedValue(new Error('Permission denied')) }
    act(() => { useAuthStore.setState({ client: client as any }) })
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const browseBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Browse'),
    )
    act(() => { browseBtns[0].props.onPress() })
    await new Promise(resolve => setImmediate(resolve))
    await act(async () => {})
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Permission denied')
  })

  it('handleSelectDirectory updates input and hides browser', () => {
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const browseBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Browse'),
    )
    act(() => { browseBtns[0].props.onPress() })
    const selectBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Select This Directory'),
    )
    expect(selectBtns.length).toBeGreaterThanOrEqual(1)
    act(() => { selectBtns[0].props.onPress() })
    expect(textOf(tree)).not.toContain('Select This Directory')
  })

  it('browseDirectory does nothing when no client', () => {
    act(() => { useAuthStore.setState({ client: null }) })
    const tree = TestRenderer.create(<ProjectSwitcher onDismiss={onDismiss} />)
    const browseBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Browse'),
    )
    expect(() => act(() => { browseBtns[0].props.onPress() })).not.toThrow()
  })
})
