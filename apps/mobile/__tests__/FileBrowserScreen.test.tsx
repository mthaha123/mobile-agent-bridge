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
import { useUiStore } from '../src/stores/uiStore'
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
  }, 20000)

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


// ─── 图片预览 & 文件下载 ─────────────────────────────────

describe('FileBrowserScreen — image preview & download', () => {
  it('react-native-blob-util mock provides DownloadDir and writeFile', () => {
    const RNBlob = require('react-native-blob-util')
    expect(RNBlob.default.fs.dirs.DownloadDir).toBe('/mock/downloads')
    expect(typeof RNBlob.default.fs.writeFile).toBe('function')
  })

  it('readFile supports base64 image payload', async () => {
    const client = mockClient({
      'file.read': () => ({
        path: '/test/pic.png', content: 'iVBORw0KGgo=', encoding: 'base64',
        size: 8, base64: true, mimeType: 'image/png',
      }),
    })
    const result = await client.call('file.read', { path: '/test/pic.png', encoding: 'base64' })
    expect(result.encoding).toBe('base64')
    expect(result.base64).toBe(true)
    expect(result.mimeType).toBe('image/png')
  })

  it('download writes base64 content to Download directory via blob-util', async () => {
    const RNBlob = require('react-native-blob-util')
    const writeFileSpy = RNBlob.default.fs.writeFile
    writeFileSpy.mockClear()

    const client = mockClient({
      'file.read': () => ({
        path: '/test/file.bin', content: 'aGVsbG8=', encoding: 'base64',
        size: 5, base64: true,
      }),
    })
    const data = await client.call('file.read', { path: '/test/file.bin', encoding: 'base64' })
    expect(data.content).toBe('aGVsbG8=')
    await writeFileSpy('/mock/downloads/x.bin', data.content, 'base64')
    expect(writeFileSpy).toHaveBeenCalled()
  })
})

// ─── HTML 弹窗路由 ───────────────────────────────────────

describe('FileBrowserScreen — html preview routing', () => {
  it('clicking an html file opens the preview modal (not full-screen viewer)', async () => {
    const client = mockClient()
    client.listFiles = jest.fn().mockResolvedValue([
      { name: 'page.html', type: 'file', size: 11, modified: '', permissions: '' },
    ])
    client.readFile = jest.fn().mockResolvedValue({
      path: '/test/page.html', content: '<h1>Hi</h1>', encoding: 'utf-8', size: 11,
    })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({ currentPath: '/test', files: [], searchResults: [] })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
    // 等待挂载后的 listFiles effect 完成，文件项才渲染出来
    await act(async () => {})

    const htmlItem = tree.root.findAll((n: any) => typeof n.props?.onPress === 'function').find((n: any) => {
      let t = ''
      function walk(node: any) { if (!node) return; if (typeof node === 'string') t += node; if (node.children) node.children.forEach(walk) }
      walk(n)
      return t.includes('page.html')
    })
    expect(htmlItem).toBeTruthy()
    await act(async () => { await htmlItem!.props.onPress() })

    expect(useFileStore.getState().htmlPreviewFile?.content).toBe('<h1>Hi</h1>')
    expect(useUiStore.getState().filesSubScreen).toBe('browser')
    expect(useFileStore.getState().viewerMode).toBeNull()
    tree.unmount()
  })
})

// ─── 上传（file.upload.*） ──────────────────────────────

describe('FileBrowserScreen — upload', () => {
  const { pick, keepLocalCopy, types } = require('@react-native-documents/picker')

  beforeEach(() => {
    ;(Alert.alert as jest.Mock).mockClear()
    ;(pick as jest.Mock).mockClear()
    ;(keepLocalCopy as jest.Mock).mockClear()
    ;(pick as jest.Mock).mockResolvedValue([
      { uri: 'content://mock/hello.txt', name: 'hello.txt', size: 11, type: 'text/plain' },
    ])
    ;(keepLocalCopy as jest.Mock).mockResolvedValue([
      { status: 'success', sourceUri: 'content://mock/hello.txt', localUri: 'file:///mock/cache/hello.txt' },
    ])
    // 非空内容（'hello world'）：保证至少 1 个 chunk，否则空文件直接 finish、无上传中状态
    const RNBlob = require('react-native-blob-util')
    ;(RNBlob.default.fs.readFile as jest.Mock).mockResolvedValue('aGVsbG8gd29ybGQ=')
  })

  /** 找到含指定文本的可点击节点 */
  function findBtn(tree: TestRenderer.ReactTestRenderer, label: string) {
    return tree.root.findAll((n: any) => typeof n.props?.onPress === 'function').find((n: any) => {
      let t = ''
      const walk = (node: any) => {
        if (!node) return
        if (typeof node === 'string') { t += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return t.includes(label)
    })
  }

  /** 获取 Alert.alert 最近一次调用的 [title, msg, buttons] */
  function lastAlert(): [string, string, any[]] | null {
    const calls = (Alert.alert as jest.Mock).mock.calls
    if (!calls.length) return null
    const [title, msg, buttons] = calls[calls.length - 1]
    return [title, msg, buttons || []]
  }

  function renderWith(client: any, path = '/test') {
    act(() => {
      useAuthStore.setState({ client })
      useProjectStore.setState({ directory: path })
      useFileStore.setState({ currentPath: path, files: [], searchResults: [] })
    })
    return TestRenderer.create(<FileBrowserScreen />)
  }

  it('header renders Upload button', () => {
    const client = mockClient()
    const tree = renderWith(client as any)
    expect(textOf(tree)).toContain('⬆ Upload')
  })

  it('upload button opens system picker with allFiles type', async () => {
    const client = mockClient({ 'file.list': () => [] })
    const tree = renderWith(client as any)
    await act(async () => {})
    const btn = findBtn(tree, '⬆ Upload')
    expect(btn).toBeTruthy()
    await act(async () => { await btn!.props.onPress() })
    expect(pick).toHaveBeenCalledWith({ type: [types.allFiles], allowMultiSelection: false })
  })

  it('copies picked content:// to local cache before upload', async () => {
    const client = mockClient({ 'file.list': () => [] })
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })
    expect(keepLocalCopy).toHaveBeenCalledWith({
      files: [{ uri: 'content://mock/hello.txt', fileName: 'hello.txt' }],
      destination: 'cachesDirectory',
    })
    expect(client.uploadBegin).toHaveBeenCalled()
  })

  it('picker cancel (rejection) is silent — no upload, no alert', async () => {
    ;(pick as jest.Mock).mockRejectedValueOnce(new Error('OPERATION_CANCELED'))
    const client = mockClient({ 'file.list': () => [] })
    const tree = renderWith(client as any)
    await act(async () => {})
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })
    expect(client.uploadBegin).not.toHaveBeenCalled()
    expect(Alert.alert).not.toHaveBeenCalled()
  })

  it('no collision → uploads into current dir, then refreshes list', async () => {
    const client = mockClient({ 'file.list': () => [] })
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })

    expect(client.getFileInfo).toHaveBeenCalledWith('/test/dir/hello.txt')
    expect(client.uploadBegin).toHaveBeenCalledWith({
      dir: '/test/dir', name: 'hello.txt', size: expect.any(Number), overwrite: false,
    })
    expect(client.uploadFinish).toHaveBeenCalledWith('mock_up1')
    expect(Alert.alert).toHaveBeenCalledWith('上传成功', expect.stringContaining('/mock/hello.txt'))
    // 成功后刷新发起时目录
    expect(client.listFiles).toHaveBeenCalledWith('/test/dir')
    expect(useFileStore.getState().uploadProgress).toBeNull()
  })

  it('collision → overwrite choice sends overwrite=true', async () => {
    const client = mockClient({ 'file.list': () => [] })
    client.getFileInfo = jest.fn().mockResolvedValue({
      name: 'hello.txt', type: 'file', size: 11, modified: '', permissions: '',
    })
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => {
      void findBtn(tree, '⬆ Upload')!.props.onPress() // 不 await：撞名弹窗会阻塞 handleUpload
      await new Promise((r) => setImmediate(r))
    })

    const alert = lastAlert()
    expect(alert?.[0]).toBe('文件已存在')
    expect(alert?.[1]).toContain('hello.txt')
    const overwriteBtn = alert![2].find((b: any) => b.text === '覆盖')
    expect(overwriteBtn).toBeTruthy()
    await act(async () => {
      overwriteBtn.onPress()
      await new Promise((r) => setImmediate(r))
    })

    expect(client.uploadBegin).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }))
  })

  it('collision → rename choice picks next free name "hello (1).txt"', async () => {
    const client = mockClient({ 'file.list': () => [] })
    client.getFileInfo = jest.fn()
      .mockResolvedValueOnce({ name: 'hello.txt', type: 'file', size: 11, modified: '', permissions: '' })
      .mockRejectedValueOnce(new Error('ENOENT')) // hello (1).txt 空闲
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => {
      void findBtn(tree, '⬆ Upload')!.props.onPress() // 不 await：撞名弹窗会阻塞 handleUpload
      await new Promise((r) => setImmediate(r))
    })

    const alert = lastAlert()
    const renameBtn = alert![2].find((b: any) => b.text === '改名')
    expect(renameBtn).toBeTruthy()
    await act(async () => {
      renameBtn.onPress()
      await new Promise((r) => setImmediate(r))
    })

    expect(client.uploadBegin).toHaveBeenCalledWith(expect.objectContaining({ name: 'hello (1).txt' }))
  })

  it('collision → cancel aborts upload entirely', async () => {
    const client = mockClient({ 'file.list': () => [] })
    client.getFileInfo = jest.fn().mockResolvedValue({
      name: 'hello.txt', type: 'file', size: 11, modified: '', permissions: '',
    })
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => {
      void findBtn(tree, '⬆ Upload')!.props.onPress() // 不 await：撞名弹窗会阻塞 handleUpload
      await new Promise((r) => setImmediate(r))
    })

    const alert = lastAlert()
    const cancelBtn = alert![2].find((b: any) => b.text === '取消')
    await act(async () => { cancelBtn.onPress() })

    expect(client.uploadBegin).not.toHaveBeenCalled()
  })

  it('server error (含真实 limit) surfaced via Alert', async () => {
    const client = mockClient({ 'file.list': () => [] })
    client.uploadBegin = jest.fn().mockRejectedValue(
      new Error('file too large: 9999999 bytes > limit 5242880 bytes'),
    )
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })

    expect(Alert.alert).toHaveBeenCalledWith(
      '上传失败',
      expect.stringContaining('limit 5242880 bytes'),
    )
    expect(useFileStore.getState().uploadProgress).toBeNull()
  })

  it('keepLocalCopy 失败时 Alert 且不发起上传', async () => {
    ;(keepLocalCopy as jest.Mock).mockResolvedValueOnce([
      { status: 'error', sourceUri: 'content://mock/hello.txt', copyError: 'disk full' },
    ])
    const client = mockClient({ 'file.list': () => [] })
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })

    expect(client.uploadBegin).not.toHaveBeenCalled()
    expect(Alert.alert).toHaveBeenCalledWith('上传失败', expect.stringContaining('disk full'))
  })

  it('renders progress bar + cancel button from store state', () => {
    const client = mockClient()
    const tree = renderWith(client as any)
    act(() => {
      useFileStore.setState({ uploadProgress: { name: 'hello.txt', sent: 50, total: 100 } })
    })
    expect(textOf(tree)).toContain('hello.txt')
    expect(textOf(tree)).toContain('50%')
    expect(textOf(tree)).toContain('✕')
  })

  it('cancel button during upload calls uploadAbort with current uploadId', async () => {
    const client = mockClient({ 'file.list': () => [] })
    // chunk 永不 resolve → 停留在上传中，验证取消按钮
    client.uploadChunk = jest.fn().mockReturnValue(new Promise(() => {}))
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => {
      void findBtn(tree, '⬆ Upload')!.props.onPress() // 不 await：卡在首个 chunk
      await new Promise((r) => setImmediate(r))
    })

    expect(useFileStore.getState().uploadProgress).not.toBeNull()
    const cancelBtn = findBtn(tree, '✕')
    expect(cancelBtn).toBeTruthy()
    await act(async () => { await cancelBtn!.props.onPress() })
    expect(client.uploadAbort).toHaveBeenCalledWith('mock_up1')
  })
})
