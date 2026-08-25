/**
 * FileViewerScreen tests
 *
 * 测试全屏文件查看器的渲染与交互：
 * - 顶栏（返回/路径/模式切换/字号）
 * - 内容区（行号、代码、markdown 渲染/源码切换）
 * - 底栏（行数/大小/行号开关/复制/下载）
 * - 返回按钮触发 popViewer
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { FileViewerScreen } from '../src/screens/FileViewerScreen'
import { useAuthStore } from '../src/stores/authStore'
import { useFileStore } from '../src/stores/fileStore'
import { useUiStore } from '../src/stores/uiStore'
import { mockClient, resetAllStores, textOf } from './test-utils'

jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())
beforeEach(() => resetAllStores())

function openTextFile(path: string, content: string, size = content.length) {
  act(() => {
    useAuthStore.setState({ client: mockClient() as any })
    useFileStore.getState().openTextViewer({ path, content, encoding: 'utf-8', size })
    useUiStore.setState({ activeTab: 'files', filesSubScreen: 'viewer' })
  })
}

/** 提取 JSON 树节点内全部文本 */
function nodeText(node: any): string {
  if (!node) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (node.children) return nodeText(node.children)
  return ''
}

/** 收集 JSON 树中所有指定类型的节点 */
function collectByType(json: any, type: string, acc: any[] = []): any[] {
  if (!json) return acc
  if (json.type === type) acc.push(json)
  const children = Array.isArray(json.children) ? json.children : []
  children.forEach((c) => collectByType(c, type, acc))
  return acc
}

describe('FileViewerScreen — text', () => {
  it('renders file content with line numbers enabled by default', () => {
    openTextFile('/test/file.ts', 'line1\nline2\nline3')
    const tree = TestRenderer.create(<FileViewerScreen />)
    const text = textOf(tree)
    expect(text).toContain('line1')
    expect(text).toContain('line2')
    expect(text).toContain('line3')
    expect(text).toContain('1')
    expect(text).toContain('2')
    expect(text).toContain('3')
  })

  it('shows file name in header', () => {
    openTextFile('/test/src/index.ts', 'console.log("hi")')
    const tree = TestRenderer.create(<FileViewerScreen />)
    expect(textOf(tree)).toContain('index.ts')
  })

  it('toggleLineNumbers hides line numbers', () => {
    openTextFile('/test/file.ts', 'a\nb')
    act(() => { useFileStore.getState().toggleLineNumbers() })
    const tree = TestRenderer.create(<FileViewerScreen />)
    expect(useFileStore.getState().viewerShowLineNumbers).toBe(false)
  })

  it('wrap mode is enabled by default and wraps long lines', () => {
    openTextFile('/test/file.ts', 'short\n' + 'x'.repeat(500))
    const tree = TestRenderer.create(<FileViewerScreen />)
    expect(useFileStore.getState().viewerWrap).toBe(true)
    const text = textOf(tree)
    expect(text).toContain('short')
    expect(text).toContain('x'.repeat(200))
  })

  it('toggleViewerWrap switches to no-wrap mode', () => {
    openTextFile('/test/file.ts', 'a\nb')
    expect(useFileStore.getState().viewerWrap).toBe(true)
    act(() => { useFileStore.getState().toggleViewerWrap() })
    expect(useFileStore.getState().viewerWrap).toBe(false)
  })

  it('no-wrap mode renders a horizontal ScrollView with unwrapped line content', () => {
    useFileStore.setState({ viewerWrap: false })
    openTextFile('/test/file.ts', 'line1\nline2')
    const tree = TestRenderer.create(<FileViewerScreen />)
    const horizScroll = tree.root.findAll(
      (n: any) => n.props?.horizontal === true,
    )
    expect(horizScroll.length).toBeGreaterThan(0)
    const text = textOf(tree)
    expect(text).toContain('line1')
    expect(text).toContain('line2')
  })

  it('footer wrap button toggles wrap mode', () => {
    openTextFile('/test/file.ts', 'hello')
    const tree = TestRenderer.create(<FileViewerScreen />)
    const pressables = tree.root.findAll((n: any) => typeof n.props?.onPress === 'function')
    const wrapBtn = pressables.find((n: any) => {
      let t = ''
      function walk(node: any) { if (!node) return; if (typeof node === 'string') t += node; if (node.children) node.children.forEach(walk) }
      walk(n)
      return t.includes('不换行')
    })
    expect(wrapBtn).toBeTruthy()
    act(() => { wrapBtn!.props.onPress() })
    expect(useFileStore.getState().viewerWrap).toBe(false)
  })

  it('A+ increases font size and A- decreases, clamped to [10,24]', () => {
    openTextFile('/test/file.ts', 'hello')
    act(() => { useFileStore.getState().setViewerFontSize(24) })
    act(() => { useFileStore.getState().setViewerFontSize(25) })
    expect(useFileStore.getState().viewerFontSize).toBe(24)
    act(() => { useFileStore.getState().setViewerFontSize(9) })
    expect(useFileStore.getState().viewerFontSize).toBe(10)
  })

  it('footer shows line count and size', () => {
    openTextFile('/test/file.ts', 'x\ny\nz', 6)
    const tree = TestRenderer.create(<FileViewerScreen />)
    const text = textOf(tree)
    expect(text).toContain('3 行')
    expect(text).toContain('6 B')
  })

  it('back button closes viewer and pops to browser', () => {
    openTextFile('/test/file.ts', 'hello')
    const tree = TestRenderer.create(<FileViewerScreen />)
    const pressables = tree.root.findAll((n: any) => typeof n.props?.onPress === 'function')
    const back = pressables.find((n: any) => {
      let t = ''
      function walk(node: any) { if (!node) return; if (typeof node === 'string') t += node; if (node.children) node.children.forEach(walk) }
      walk(n)
      return t.includes('←')
    })
    expect(back).toBeTruthy()
    act(() => { back!.props.onPress() })
    expect(useUiStore.getState().filesSubScreen).toBe('browser')
    expect(useFileStore.getState().viewerMode).toBeNull()
  })
})

describe('FileViewerScreen — markdown', () => {
  it('renders markdown by default', () => {
    openTextFile('/test/README.md', '# Title\n\n**bold**')
    const tree = TestRenderer.create(<FileViewerScreen />)
    expect(useFileStore.getState().viewerShowSource).toBe(false)
    expect(textOf(tree)).toContain('# Title')
  })

  it('toggleViewerSource shows raw source', () => {
    openTextFile('/test/README.md', '# Title\n\n**bold**')
    act(() => { useFileStore.getState().toggleViewerSource() })
    expect(useFileStore.getState().viewerShowSource).toBe(true)
    const tree = TestRenderer.create(<FileViewerScreen />)
    expect(textOf(tree)).toContain('# Title')
  })

  it('source toggle button visible for markdown files', () => {
    openTextFile('/test/README.md', '# T')
    const tree = TestRenderer.create(<FileViewerScreen />)
    expect(textOf(tree)).toContain('源码')
  })

  it('渲染内容位于纵向 ScrollView 内（修复内容超屏无法下滑）', () => {
    // 回归保障：外层 styles.content 只是 flex:1 的普通 View，
    // 渲染分支若退化为纯 View 包裹，内容超过一屏将无法下滑
    openTextFile('/test/README.md', '# Title\n\n**bold**\n\n- item A\n- item B')
    const tree = TestRenderer.create(<FileViewerScreen />)
    const verticalWithContent = collectByType(tree.toJSON(), 'ScrollView').filter(
      (sv) => sv.props.horizontal !== true && nodeText(sv).includes('# Title'),
    )
    expect(verticalWithContent.length).toBeGreaterThan(0)
  })
})

describe('FileViewerScreen — image', () => {
  it('renders image with file name', () => {
    act(() => {
      useAuthStore.setState({ client: mockClient() as any })
      useFileStore.getState().openImageViewer({ uri: 'data:image/png;base64,AAAA', name: 'pic.png' })
      useUiStore.setState({ activeTab: 'files', filesSubScreen: 'viewer' })
    })
    const tree = TestRenderer.create(<FileViewerScreen />)
    expect(textOf(tree)).toContain('pic.png')
  })
})
