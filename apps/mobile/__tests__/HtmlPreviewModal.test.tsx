/**
 * HtmlPreviewModal tests
 *
 * 覆盖：空态不渲染 / 渲染 WebView / 源码切换 / 关闭 / 外部打开。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { HtmlPreviewModal } from '../src/screens/HtmlPreviewModal'
import { useFileStore } from '../src/stores/fileStore'
import { resetAllStores, textOf } from './test-utils'

jest.spyOn(Alert, 'alert').mockImplementation(jest.fn())

let trees: TestRenderer.ReactTestRenderer[] = []

function render() {
  const tree = TestRenderer.create(<HtmlPreviewModal />)
  trees.push(tree)
  return tree
}

function open(path: string, content: string) {
  act(() => {
    useFileStore.getState().openHtmlPreview({ path, content, encoding: 'utf-8', size: content.length })
  })
}

/** 找到聚合文本恰好等于 needle 的 onPress 节点（精确匹配，避免命中外层 backdrop） */
function findExactButton(tree: TestRenderer.ReactTestRenderer, needle: string) {
  return tree.root.findAll((n: any) => typeof n.props?.onPress === 'function').find((n: any) => {
    let t = ''
    function walk(node: any) { if (!node) return; if (typeof node === 'string') t += node; if (node.children) node.children.forEach(walk) }
    walk(n)
    return t.trim() === needle
  })
}

beforeEach(() => {
  resetAllStores()
  const RNBlob = require('react-native-blob-util').default
  RNBlob.fs.writeFile.mockClear()
  RNBlob.android.actionViewIntent.mockClear()
  RNBlob.fs.writeFile.mockResolvedValue('/mock/cache/x.html')
  ;(Alert.alert as jest.Mock).mockClear()
})

afterEach(() => {
  trees.forEach((t) => t.unmount())
  trees = []
})

describe('HtmlPreviewModal', () => {
  it('renders nothing when no html file is open', () => {
    const tree = render()
    expect(tree.toJSON()).toBeNull()
  })

  it('renders WebView with html source by default', () => {
    open('/test/index.html', '<h1>Hello</h1>')
    const tree = render()
    const webviews = tree.root.findAll((n: any) => n.props?.testID === 'webview')
    expect(webviews.length).toBe(1)
    expect(webviews[0].props.source.html).toBe('<h1>Hello</h1>')
    expect(webviews[0].props.javaScriptEnabled).toBe(false)
    expect(textOf(tree)).toContain('index.html')
  })

  it('toggles to source mode (no WebView)', () => {
    open('/test/index.html', '<p>Hi</p>')
    act(() => { useFileStore.getState().toggleHtmlPreviewSource() })
    const tree = render()
    expect(tree.root.findAll((n: any) => n.props?.testID === 'webview').length).toBe(0)
    expect(textOf(tree)).toContain('<p>Hi</p>')
  })

  it('close button clears the preview', () => {
    open('/test/index.html', '<p>Hi</p>')
    const tree = render()
    const closeBtn = findExactButton(tree, '✕')
    expect(closeBtn).toBeTruthy()
    act(() => { closeBtn!.props.onPress() })
    expect(useFileStore.getState().htmlPreviewFile).toBeNull()
  })

  it('external open writes cache file and fires ACTION_VIEW', async () => {
    open('/test/dir/page.html', '<h1>Ext</h1>')
    const tree = render()
    const btn = findExactButton(tree, '↗ 外部打开')
    expect(btn).toBeTruthy()
    await act(async () => { await btn!.props.onPress() })

    const RNBlob = require('react-native-blob-util').default
    expect(RNBlob.fs.writeFile).toHaveBeenCalledWith('/mock/cache/page.html', '<h1>Ext</h1>', 'utf8')
    expect(RNBlob.android.actionViewIntent).toHaveBeenCalledWith('/mock/cache/page.html', 'text/html')
  })

  it('external open failure shows an alert', async () => {
    open('/test/page.html', '<h1>Ext</h1>')
    const RNBlob = require('react-native-blob-util').default
    RNBlob.fs.writeFile.mockRejectedValueOnce(new Error('disk full'))
    const tree = render()
    const btn = findExactButton(tree, '↗ 外部打开')
    expect(btn).toBeTruthy()
    await act(async () => { await btn!.props.onPress() })
    expect(Alert.alert).toHaveBeenCalledWith('无法外部打开', 'disk full')
  })
})
