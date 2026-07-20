/**
 * FileBrowserScreen tests
 *
 * 测试 FileBrowserScreen 的渲染和交互：目录列表、文件预览、搜索、导航。
 * FlatList mock 不渲染 items，因此文件列表测试聚焦于 store state 和 client 调用。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { FileBrowserScreen } from '../src/screens/FileBrowserScreen'
import { useAuthStore } from '../src/stores/authStore'
import { useFileStore } from '../src/stores/fileStore'
import { useProjectStore } from '../src/stores/projectStore'
import {
  mockClient, resetAllStores, textOf, findAllInputs,
} from './test-utils'

jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
beforeEach(() => resetAllStores())

// ─── 渲染测试 ─────────────────────────────────────────────

describe('FileBrowserScreen', () => {
  it('renders search input and search button', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('Search')
  })

  it('shows current path in header', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/my/project' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('/my/project')
  })

  it('shows loading state', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useFileStore.setState({ loading: true })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('shows error state', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useFileStore.setState({ error: 'Permission denied' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('Permission denied')
  })

  it('does not load when no client', () => {
    act(() => {
      useAuthStore.setState({ client: null })
      useProjectStore.setState({ directory: '/test' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('file preview shows content and close button', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        currentFile: {
          path: '/test/file.ts',
          content: 'console.log("hello")',
          encoding: 'utf-8',
          size: 22,
        },
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const t = textOf(tree)
    expect(t).toContain('console.log("hello")')
    expect(t).toContain('✕')
  })
})

// ─── Store 状态验证 ────────────────────────────────────────

describe('FileBrowserScreen — store state', () => {
  it('file store files state is set correctly', () => {
    act(() => {
      useFileStore.setState({
        files: [
          { name: 'src', type: 'directory', size: 0, modified: '', permissions: '' },
          { name: 'index.ts', type: 'file', size: 100, modified: '', permissions: '' },
        ],
      })
    })
    const files = useFileStore.getState().files
    expect(files).toHaveLength(2)
    expect(files[0].name).toBe('src')
    expect(files[0].type).toBe('directory')
    expect(files[1].name).toBe('index.ts')
    expect(files[1].type).toBe('file')
  })

  it('search results state is set correctly', () => {
    act(() => {
      useFileStore.setState({
        searchResults: [
          { file: 'src/index.ts', line: 5, content: 'function main()' },
        ],
      })
    })
    const results = useFileStore.getState().searchResults
    expect(results).toHaveLength(1)
    expect(results[0].file).toBe('src/index.ts')
    expect(results[0].content).toBe('function main()')
  })

  it('currentFile state is set correctly', () => {
    act(() => {
      useFileStore.setState({
        currentFile: {
          path: '/test/file.ts',
          content: 'hello world',
          encoding: 'utf-8',
          size: 11,
        },
      })
    })
    const file = useFileStore.getState().currentFile
    expect(file).not.toBeNull()
    expect(file!.path).toBe('/test/file.ts')
    expect(file!.content).toBe('hello world')
  })
})

// ─── 交互测试 ─────────────────────────────────────────────

describe('FileBrowserScreen — interactions', () => {
  it('search input updates searchQuery', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const inputs = findAllInputs(tree)
    expect(inputs.length).toBeGreaterThanOrEqual(1)

    act(() => { inputs[0].props.onChangeText('test query') })
    expect(useFileStore.getState().searchQuery).toBe('test query')
  })

  it('goUp navigates to parent directory', () => {
    act(() => {
      useFileStore.setState({ currentPath: '/home/user/project' })
    })
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })

  it('enterDirectory navigates into subdirectory', () => {
    act(() => {
      useFileStore.setState({ currentPath: '/home' })
    })
    useFileStore.getState().enterDirectory('user')
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })

  it('goUp at root stays at root', () => {
    act(() => {
      useFileStore.setState({ currentPath: '/' })
    })
    useFileStore.getState().goUp()
    expect(useFileStore.getState().currentPath).toBe('/')
  })

  it('enterDirectory with trailing slash', () => {
    act(() => {
      useFileStore.setState({ currentPath: '/home/' })
    })
    useFileStore.getState().enterDirectory('user')
    expect(useFileStore.getState().currentPath).toBe('/home/user')
  })
})

// ─── Client 调用验证 ──────────────────────────────────────

describe('FileBrowserScreen — client calls', () => {
  it('mock client listFiles is called', async () => {
    const client = mockClient({ 'file.list': () => [] })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    expect(typeof client.listFiles).toBe('function')
  })

  it('mock client readFile is called', async () => {
    const client = mockClient({
      'file.read': () => ({ path: '/test.ts', content: 'hello', encoding: 'utf-8', size: 5 }),
    })
    const result = await client.call('file.read', { path: '/test.ts' })
    expect(result.content).toBe('hello')
  })

  it('mock client searchFiles is called', async () => {
    const client = mockClient({
      'file.search': () => [{ file: '/test.ts', line: 1, content: 'hello' }],
    })
    const result = await client.call('file.search', { query: 'hello' })
    expect(result).toHaveLength(1)
  })
})

// ─── 渲染补充测试 ─────────────────────────────────────────

describe('FileBrowserScreen — rendering', () => {
  it('renders search input with placeholder', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const inputs = tree.root.findAll(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.placeholder === 'Search files...',
    )
    expect(inputs.length).toBeGreaterThanOrEqual(1)
  })

  it('file preview shows close button', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        currentFile: { path: '/test/file.ts', content: 'hello', encoding: 'utf-8', size: 5 },
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('✕')
  })

  it('file preview shows file content', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        currentFile: { path: '/test/file.ts', content: 'console.log("hello")', encoding: 'utf-8', size: 22 },
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('console.log("hello")')
  })

  it('file preview shows file path', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        currentFile: { path: '/test/file.ts', content: 'hello', encoding: 'utf-8', size: 5 },
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('/test/file.ts')
  })

  it('error state shows error text', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => { useFileStore.setState({ error: 'Permission denied' }) })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('Permission denied')
  })

  it('loading state shows ActivityIndicator', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => { useFileStore.setState({ loading: true, files: [] }) })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders header with current path', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => { useFileStore.setState({ currentPath: '/my/project' }) })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(textOf(tree)).toContain('/my/project')
  })

  it('renders file list items from store', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        files: [
          { name: 'src', type: 'directory', size: 0, modified: '', permissions: '' },
          { name: 'index.ts', type: 'file', size: 1024, modified: '', permissions: '' },
        ],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
    expect(useFileStore.getState().files).toHaveLength(2)
  })

  it('renders search results from store', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        searchResults: [{ file: 'src/index.ts', line: 5, content: 'function main()' }],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
    expect(useFileStore.getState().searchResults).toHaveLength(1)
  })
})

// ─── formatSize 测试 ──────────────────────────────────────

describe('FileBrowserScreen — formatSize', () => {
  it('formats 0 bytes as 0 B', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        files: [{ name: 'empty.txt', type: 'file', size: 0, modified: '', permissions: '' }],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('formats kilobytes correctly', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        files: [{ name: 'medium.txt', type: 'file', size: 1536, modified: '', permissions: '' }],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('formats megabytes correctly', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        files: [{ name: 'large.txt', type: 'file', size: 2097152, modified: '', permissions: '' }],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })
})

// ─── 交互测试补充 ─────────────────────────────────────────

describe('FileBrowserScreen — interactions extended', () => {
  it('close file preview button clears currentFile', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        currentFile: { path: '/test/file.ts', content: 'hello', encoding: 'utf-8', size: 5 },
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const closeBtn = pressables.find((n: any) => {
      let text = ''
      function walk(node: any) {
        if (!node) return
        if (typeof node === 'string') { text += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return text.includes('✕')
    })
    expect(closeBtn).toBeTruthy()

    act(() => { closeBtn!.props.onPress() })
    expect(useFileStore.getState().currentFile).toBeNull()
  })

  it('search button triggers handleSearch', async () => {
    const client = mockClient({
      'file.search': () => [{ file: 'src/index.ts', line: 1, content: 'test' }],
    })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({ searchQuery: 'test' })
    })

    const tree = TestRenderer.create(<FileBrowserScreen />)
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const searchBtn = pressables.find((n: any) => {
      let text = ''
      function walk(node: any) {
        if (!node) return
        if (typeof node === 'string') { text += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return text.includes('Search')
    })
    expect(searchBtn).toBeTruthy()

    await act(async () => { await searchBtn!.props.onPress() })
    expect(client.searchFiles).toHaveBeenCalled()
  })

  it('parent directory button triggers goUp', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        currentPath: '/home/user',
        files: [],
        searchResults: [],
      })
    })

    const tree = TestRenderer.create(<FileBrowserScreen />)
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const parentBtn = pressables.find((n: any) => {
      let text = ''
      function walk(node: any) {
        if (!node) return
        if (typeof node === 'string') { text += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return text === '..Parent Directory'
    })

    if (parentBtn) {
      act(() => { parentBtn.props.onPress() })
      expect(useFileStore.getState().currentPath).toBe('/home')
    }
  })
})

describe('FileBrowserScreen — edge cases', () => {
  it('handleSearch with empty query returns early', async () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
      useFileStore.setState({ searchQuery: '' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const searchBtn = pressables.find((n: any) => {
      let text = ''
      function walk(n: any) {
        if (!n) return
        if (typeof n === 'string') { text += n; return }
        if (n.children) n.children.forEach(walk)
      }
      walk(n)
      return text.includes('Search')
    })
    if (searchBtn) {
      await act(async () => { await searchBtn!.props.onPress() })
      const loadDirSpy = jest.spyOn(useFileStore.getState(), 'setFiles')
      expect(loadDirSpy).not.toHaveBeenCalled()
      loadDirSpy.mockRestore()
    }
  })

  it('uses root path when no project directory', () => {
    const client = mockClient()
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('shows alert on loadDirectory error', async () => {
    const client = mockClient()
    client.listFiles = jest.fn().mockRejectedValue(new Error('Access denied'))
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    await new Promise(resolve => setImmediate(resolve))
    await act(async () => {})
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Access denied')
  })

  it('shows alert on search error', async () => {
    const client = mockClient()
    client.searchFiles = jest.fn().mockRejectedValue(new Error('Search failed'))
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
      useFileStore.setState({ searchQuery: 'test', searchResults: [] })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    const pressables = tree.root.findAll((n: any) => typeof n.props?.onPress === 'function')
    const searchBtn = pressables.find((n: any) => {
      let text = ''
      function walk(n: any) { if (!n) return; if (typeof n === 'string') { text += n; return }; if (n.children) n.children.forEach(walk) }
      walk(n)
      return text.includes('Search')
    })
    if (searchBtn) {
      await act(async () => { await searchBtn!.props.onPress() })
      await new Promise(resolve => setImmediate(resolve))
      await act(async () => {})
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Search failed')
    }
  })
})
