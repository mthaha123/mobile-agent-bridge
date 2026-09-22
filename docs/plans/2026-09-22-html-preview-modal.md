# HTML 弹窗预览 + 外部打开 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让移动端以弹窗（Modal 浮层）预览 HTML 文件，并可交给系统浏览器/其它 App 打开。

**Architecture:** 新增独立 `HtmlPreviewModal` 组件，状态收敛到 `fileStore`（`htmlPreviewFile`/`htmlPreviewSource`），在 `MainLayout` 全局挂载。`FileBrowserScreen` 点击 `.html/.htm` 改为 `openHtmlPreview()`（不再整页跳转）。外部打开用 `react-native-blob-util` 的 `android.actionViewIntent()`（FileProvider + `ACTION_VIEW`）。同时退役 `FileViewerScreen` 的 HTML 全屏通道，避免双路径。

**Tech Stack:** React Native 0.76.9 / TypeScript / Zustand / react-native-webview 14 / react-native-blob-util 0.24 / Jest + ts-jest + react-test-renderer。（设计文档：`docs/plans/2026-09-22-html-preview-modal-design.md`）

**约束（来自 AGENTS.md）**
- 所有命令 < 3s 或 fire-and-forget；jest 为短测试可直接跑。
- 新增文件放合理目录；日志写 `logs/build/`。
- 每个接口/行为变更必须有对应测试。

---

## Task 1: fileStore 新增 HTML 弹窗预览状态与 action

**Files:**
- Modify: `apps/mobile/src/stores/fileStore.ts`
- Test: `apps/mobile/__tests__/fileStore.test.ts`

> 说明：本任务只**新增**（保留旧的 `openHtmlViewer` 等，避免中途编译失败）。旧字段在 Task 6 统一删除。

**Step 1: 写失败测试**

在 `apps/mobile/__tests__/fileStore.test.ts` 末尾追加：

```ts
describe('fileStore — HTML preview modal', () => {
  beforeEach(() => {
    useFileStore.getState().reset()
  })

  it('openHtmlPreview sets file and defaults to rendered (source=false)', () => {
    const file = { content: '<h1>Hi</h1>', encoding: 'utf-8', size: 12, path: '/a/index.html' }
    useFileStore.getState().openHtmlPreview(file)
    const state = useFileStore.getState()
    expect(state.htmlPreviewFile).toEqual(file)
    expect(state.htmlPreviewSource).toBe(false)
  })

  it('toggleHtmlPreviewSource flips source flag', () => {
    const file = { content: '<p>x</p>', encoding: 'utf-8', size: 8, path: '/a/x.html' }
    useFileStore.getState().openHtmlPreview(file)
    useFileStore.getState().toggleHtmlPreviewSource()
    expect(useFileStore.getState().htmlPreviewSource).toBe(true)
    useFileStore.getState().toggleHtmlPreviewSource()
    expect(useFileStore.getState().htmlPreviewSource).toBe(false)
  })

  it('closeHtmlPreview clears the file', () => {
    const file = { content: '<p>x</p>', encoding: 'utf-8', size: 8, path: '/a/x.html' }
    useFileStore.getState().openHtmlPreview(file)
    useFileStore.getState().closeHtmlPreview()
    expect(useFileStore.getState().htmlPreviewFile).toBeNull()
  })

  it('reset clears html preview state', () => {
    const file = { content: '<p>x</p>', encoding: 'utf-8', size: 8, path: '/a/x.html' }
    useFileStore.getState().openHtmlPreview(file)
    useFileStore.getState().toggleHtmlPreviewSource()
    useFileStore.getState().reset()
    expect(useFileStore.getState().htmlPreviewFile).toBeNull()
    expect(useFileStore.getState().htmlPreviewSource).toBe(false)
  })
})
```

**Step 2: 运行测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/fileStore.test.ts`
Expected: FAIL — `useFileStore.getState().openHtmlPreview is not a function`

**Step 3: 最小实现**

编辑 `apps/mobile/src/stores/fileStore.ts`：

3a. 在 `FileState` 接口中，紧跟 `viewerWrap: boolean` 之后新增字段：

```ts
  /** HTML 弹窗预览：非空即显示弹窗 */
  htmlPreviewFile: FileContent | null
  /** HTML 弹窗：true=显示源码，false=WebView 渲染 */
  htmlPreviewSource: boolean
```

3b. 在 `FileState` 接口中，紧跟 `toggleViewerWrap: () => void` 之后新增 action 声明：

```ts
  /** 打开 HTML 弹窗预览 */
  openHtmlPreview: (file: FileContent) => void
  /** 关闭 HTML 弹窗预览 */
  closeHtmlPreview: () => void
  /** 切换 HTML 弹窗 渲染/源码 */
  toggleHtmlPreviewSource: () => void
```

3c. 在 `initialState` 对象中，紧跟 `viewerWrap: true,` 之后新增：

```ts
  htmlPreviewFile: null,
  htmlPreviewSource: false,
```

3d. 在 `create<FileState>((set, get) => ({ ... }))` 实现中，紧跟 `toggleViewerWrap: ...` 之后新增：

```ts
  openHtmlPreview: (file) => set({
    htmlPreviewFile: file,
    htmlPreviewSource: false,
  }),

  closeHtmlPreview: () => set({ htmlPreviewFile: null }),

  toggleHtmlPreviewSource: () => set((s) => ({ htmlPreviewSource: !s.htmlPreviewSource })),
```

**Step 4: 运行测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/fileStore.test.ts`
Expected: PASS（含原有测试）

**Step 5: 提交**

```bash
git add apps/mobile/src/stores/fileStore.ts apps/mobile/__tests__/fileStore.test.ts
git commit -m "feat(fileStore): add html preview modal state and actions"
```

---

## Task 2: 扩展 react-native-blob-util mock，支持 actionViewIntent

**Files:**
- Modify: `apps/mobile/__mocks__/react-native-blob-util.js`

**Step 1: 确认缺失**

`apps/mobile/__mocks__/react-native-blob-util.js` 目前只有 `fs`，没有 `android.actionViewIntent`。若组件直接调用会在测试中报 `Cannot read properties of undefined`。

**Step 2: 扩展 mock**

在 `default: {` 对象内、`fs: { ... },` 之后新增：

```js
    android: {
      actionViewIntent: jest.fn().mockResolvedValue(true),
    },
```

**Step 3: 验证 mock 可加载**

Run: `cd apps/mobile && node -e "const m=require('./__mocks__/react-native-blob-util.js'); console.log(typeof m.default.android.actionViewIntent)"`
Expected: 输出 `function`

**Step 4: 提交**

```bash
git add apps/mobile/__mocks__/react-native-blob-util.js
git commit -m "test(mock): add blob-util android.actionViewIntent"
```

---

## Task 3: 新增 HtmlPreviewModal 组件 + 测试

**Files:**
- Create: `apps/mobile/src/screens/HtmlPreviewModal.tsx`
- Test: `apps/mobile/__tests__/HtmlPreviewModal.test.tsx`

**Step 1: 写失败测试**

创建 `apps/mobile/__tests__/HtmlPreviewModal.test.tsx`：

```tsx
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

function open(path: string, content: string) {
  act(() => {
    useFileStore.getState().openHtmlPreview({ path, content, encoding: 'utf-8', size: content.length })
  })
}

function findByText(tree: TestRenderer.ReactTestRenderer, needle: string) {
  return tree.root.findAll((n: any) => typeof n.props?.onPress === 'function').find((n: any) => {
    let t = ''
    function walk(node: any) { if (!node) return; if (typeof node === 'string') t += node; if (node.children) node.children.forEach(walk) }
    walk(n)
    return t.includes(needle)
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

describe('HtmlPreviewModal', () => {
  it('renders nothing when no html file is open', () => {
    const tree = TestRenderer.create(<HtmlPreviewModal />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders WebView with html source by default', () => {
    open('/test/index.html', '<h1>Hello</h1>')
    const tree = TestRenderer.create(<HtmlPreviewModal />)
    const webviews = tree.root.findAll((n: any) => n.props?.testID === 'webview')
    expect(webviews.length).toBe(1)
    expect(webviews[0].props.source.html).toBe('<h1>Hello</h1>')
    expect(webviews[0].props.javaScriptEnabled).toBe(false)
    expect(textOf(tree)).toContain('index.html')
  })

  it('toggles to source mode (no WebView)', () => {
    open('/test/index.html', '<p>Hi</p>')
    act(() => { useFileStore.getState().toggleHtmlPreviewSource() })
    const tree = TestRenderer.create(<HtmlPreviewModal />)
    expect(tree.root.findAll((n: any) => n.props?.testID === 'webview').length).toBe(0)
    expect(textOf(tree)).toContain('<p>Hi</p>')
  })

  it('close button clears the preview', () => {
    open('/test/index.html', '<p>Hi</p>')
    const tree = TestRenderer.create(<HtmlPreviewModal />)
    const closeBtn = findByText(tree, '✕')
    expect(closeBtn).toBeTruthy()
    act(() => { closeBtn!.props.onPress() })
    expect(useFileStore.getState().htmlPreviewFile).toBeNull()
  })

  it('external open writes cache file and fires ACTION_VIEW', async () => {
    open('/test/dir/page.html', '<h1>Ext</h1>')
    const tree = TestRenderer.create(<HtmlPreviewModal />)
    const btn = findByText(tree, '外部打开')
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
    const tree = TestRenderer.create(<HtmlPreviewModal />)
    const btn = findByText(tree, '外部打开')
    await act(async () => { await btn!.props.onPress() })
    expect(Alert.alert).toHaveBeenCalledWith('无法外部打开', 'disk full')
  })
})
```

**Step 2: 运行测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/HtmlPreviewModal.test.tsx`
Expected: FAIL — 无法解析 `../src/screens/HtmlPreviewModal`

**Step 3: 实现组件**

创建 `apps/mobile/src/screens/HtmlPreviewModal.tsx`：

```tsx
/**
 * HtmlPreviewModal — HTML 文件弹窗预览
 *
 * - Modal 浮层（底部升起），不整页跳转
 * - 渲染/源码切换，WebView 禁用 JS
 * - 外部打开：写入缓存 + ACTION_VIEW 交给系统浏览器/查看器
 */
import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native'
import WebView from 'react-native-webview'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { useFileStore } from '../stores/fileStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

export const HtmlPreviewModal: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const file = useFileStore((s) => s.htmlPreviewFile)
  const showSource = useFileStore((s) => s.htmlPreviewSource)
  const close = useFileStore((s) => s.closeHtmlPreview)
  const toggleSource = useFileStore((s) => s.toggleHtmlPreviewSource)

  const [opening, setOpening] = useState(false)

  if (!file) return null

  const fileName = file.path.split(/[/\\]/).pop() || 'preview.html'

  const handleOpenExternal = async () => {
    if (opening) return
    setOpening(true)
    try {
      const cachePath = ReactNativeBlobUtil.fs.dirs.CacheDir + '/' + fileName
      await ReactNativeBlobUtil.fs.writeFile(cachePath, file.content, 'utf8')
      await ReactNativeBlobUtil.android.actionViewIntent(cachePath, 'text/html')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('无法外部打开', msg)
    } finally {
      setOpening(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.btn} onPress={toggleSource}>
                <Text style={styles.btnText}>{showSource ? '渲染' : '源码'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={handleOpenExternal} disabled={opening}>
                <Text style={styles.btnText}>{opening ? '打开中…' : '↗ 外部打开'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={close} accessibilityLabel="Close preview">
                <Text style={styles.btnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.body}>
            {showSource ? (
              <ScrollView style={styles.sourceScroll} contentContainerStyle={styles.sourceContent}>
                <Text style={styles.sourceText}>{file.content}</Text>
              </ScrollView>
            ) : (
              <WebView
                source={{ html: file.content }}
                originWhitelist={['*']}
                javaScriptEnabled={false}
                style={styles.webview}
              />
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    sheet: {
      height: '90%',
      backgroundColor: colors.background,
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surfaceVariant,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      marginRight: 8,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    btn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginLeft: 4,
    },
    btnText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    body: {
      flex: 1,
    },
    webview: {
      flex: 1,
      backgroundColor: colors.background,
    },
    sourceScroll: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    sourceContent: {
      padding: 12,
    },
    sourceText: {
      color: colors.text,
      fontFamily: 'monospace',
      fontSize: 13,
    },
  })
```

**Step 4: 运行测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/HtmlPreviewModal.test.tsx`
Expected: PASS（6 个用例）

**Step 5: 提交**

```bash
git add apps/mobile/src/screens/HtmlPreviewModal.tsx apps/mobile/__tests__/HtmlPreviewModal.test.tsx
git commit -m "feat(mobile): add HtmlPreviewModal with external open"
```

---

## Task 4: FileBrowserScreen 点击 HTML 改为弹窗预览

**Files:**
- Modify: `apps/mobile/src/screens/FileBrowserScreen.tsx`
- Test: `apps/mobile/__tests__/FileBrowserScreen.test.tsx`

**Step 1: 写失败测试**

在 `apps/mobile/__tests__/FileBrowserScreen.test.tsx` 末尾追加：

```tsx
describe('FileBrowserScreen — html preview routing', () => {
  it('clicking an html file opens the preview modal (not full-screen viewer)', async () => {
    const client = mockClient({
      'file.read': () => ({ path: '/test/page.html', content: '<h1>Hi</h1>', encoding: 'utf-8', size: 11 }),
    })
    act(() => {
      useAuthStore.setState({ client: client as any })
      useProjectStore.setState({ directory: '/test' })
    })
    act(() => {
      useFileStore.setState({
        currentPath: '/test',
        files: [{ name: 'page.html', type: 'file', size: 11, modified: '', permissions: '' }],
        searchResults: [],
      })
    })
    const tree = TestRenderer.create(<FileBrowserScreen />)
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
  })
})
```

> 注意：该文件顶部需确保已导入 `useUiStore`。若未导入，在 import 区追加 `import { useUiStore } from '../src/stores/uiStore'`。

**Step 2: 运行测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/FileBrowserScreen.test.tsx -t "html preview routing"`
Expected: FAIL — `htmlPreviewFile` 仍为 null（当前走 `openHtmlViewer`）

**Step 3: 实现**

编辑 `apps/mobile/src/screens/FileBrowserScreen.tsx`：

3a. 把 `const openHtmlViewer = useFileStore((s) => s.openHtmlViewer)` 改为：

```ts
  const openHtmlPreview = useFileStore((s) => s.openHtmlPreview)
```

3b. 把 HTML 分支：

```ts
      // HTML 文件 → WebView 查看器
      if (HTML_EXTS.includes(ext)) {
        setLoading(true)
        try {
          const filePath = currentPath + '/' + file.name
          const content = await client?.readFile(filePath)
          if (content) {
            openHtmlViewer(content)
            pushViewer()
          }
        } catch (err: unknown) {
          Alert.alert('Error', err instanceof Error ? err.message : 'Failed to read HTML file')
        } finally {
          setLoading(false)
        }
        return
      }
```

改为：

```ts
      // HTML 文件 → 弹窗预览（不整页跳转）
      if (HTML_EXTS.includes(ext)) {
        setLoading(true)
        try {
          const filePath = currentPath + '/' + file.name
          const content = await client?.readFile(filePath)
          if (content) {
            openHtmlPreview(content)
          }
        } catch (err: unknown) {
          Alert.alert('Error', err instanceof Error ? err.message : 'Failed to read HTML file')
        } finally {
          setLoading(false)
        }
        return
      }
```

**Step 4: 运行测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/FileBrowserScreen.test.tsx`
Expected: PASS

**Step 5: 提交**

```bash
git add apps/mobile/src/screens/FileBrowserScreen.tsx apps/mobile/__tests__/FileBrowserScreen.test.tsx
git commit -m "feat(mobile): route html files to preview modal"
```

---

## Task 5: MainLayout 挂载 HtmlPreviewModal

**Files:**
- Modify: `apps/mobile/src/components/MainLayout.tsx`
- Test: `apps/mobile/__tests__/MainLayout.test.tsx`（回归，无需新增用例）

**Step 1: 实现挂载**

编辑 `apps/mobile/src/components/MainLayout.tsx`：

1a. import 区新增：

```ts
import { HtmlPreviewModal } from '../screens/HtmlPreviewModal'
```

1b. 在 `<QuestionSheet />` 之后、`</SafeAreaView>` 之前新增：

```tsx
      <HtmlPreviewModal />
```

**Step 2: 回归测试**

Run: `cd apps/mobile && npx jest __tests__/MainLayout.test.tsx`
Expected: PASS（未打开 HTML 时组件返回 null，不影响既有断言）

**Step 3: 提交**

```bash
git add apps/mobile/src/components/MainLayout.tsx
git commit -m "feat(mobile): mount HtmlPreviewModal globally"
```

---

## Task 6: 退役 FileViewerScreen 的 HTML 全屏通道

**Files:**
- Modify: `apps/mobile/src/screens/FileViewerScreen.tsx`
- Modify: `apps/mobile/src/stores/fileStore.ts`
- Test: `apps/mobile/__tests__/FileViewerScreen.test.tsx`
- Test: `apps/mobile/__tests__/fileStore.test.ts`

> 本任务必须原子完成：删 store 字段与删组件引用放同一提交，否则 ts-jest 类型检查会失败。

**Step 1: 更新测试（先写会失败的退役断言）**

1a. 删除 `apps/mobile/__tests__/FileViewerScreen.test.tsx` 中整个 `describe('FileViewerScreen — html', () => { ... })` 块（从 `describe('FileViewerScreen — html'` 到其闭合 `})`）。

1b. 删除 `apps/mobile/__tests__/fileStore.test.ts` 中整个 `describe('fileStore — HTML viewer', () => { ... })` 块。

1c. 在 `fileStore.test.ts` 的 `describe('fileStore — HTML preview modal')` 内追加退役断言：

```ts
  it('retires the full-screen html channel', () => {
    const state = useFileStore.getState() as any
    expect(state.openHtmlViewer).toBeUndefined()
    expect(state.viewerHtmlRendered).toBeUndefined()
    expect(state.toggleHtmlRendered).toBeUndefined()
  })
```

**Step 2: 运行测试确认失败**

Run: `cd apps/mobile && npx jest __tests__/fileStore.test.ts -t "retires the full-screen html channel"`
Expected: FAIL — `openHtmlViewer` 仍然存在（未退役）

**Step 3: 删除实现**

3a. `apps/mobile/src/stores/fileStore.ts`：

- `ViewerMode` 改为：`export type ViewerMode = 'text' | 'image' | null`
- 删除字段 `viewerHtmlRendered`（接口 + initialState 中的 `viewerHtmlRendered: true,`）
- 删除接口声明 `openHtmlViewer: (file: FileContent) => void` 与 `toggleHtmlRendered: () => void`
- 删除实现 `openHtmlViewer: (file) => set({...}),` 与 `toggleHtmlRendered: () => set(...),`
- 保留 `openTextViewer` / `openImageViewer` / `closeViewer` / `toggleViewerSource` 等

3b. `apps/mobile/src/screens/FileViewerScreen.tsx`：

- 删除 `import WebView from 'react-native-webview'`
- 删除 selector：`const viewerHtmlRendered = ...`、`const toggleHtmlRendered = ...`
- 删除函数：`const isHtml = (path: string) => {...}`、`const isHtmlMode = viewerMode === 'html'`、`const renderHtml = () => {...}`
- `canToggleSource` 改为：
  ```ts
  const canToggleSource = isMarkdown(currentFile?.path || '')
  ```
- 顶栏切换按钮改为：
  ```tsx
          {canToggleSource && (
            <TouchableOpacity
              onPress={toggleViewerSource}
              style={styles.headerBtn}
            >
              <Text style={styles.headerActionText}>
                {viewerShowSource ? '渲染' : '源码'}
              </Text>
            </TouchableOpacity>
          )}
  ```
- 内容区删除 `{viewerMode === 'html' && renderHtml()}`
- `showTextFooter` 改为：
  ```ts
  const showTextFooter = viewerMode === 'text'
  ```
- 删除 `webview` 样式项
- `MIME_TYPES` 中的 `html: 'text/html'` **保留**（下载时用）
- 若 `WebView`/`renderHtml` 删除后 `ScrollView` 等仍被其他分支使用，保留对应 import

**Step 4: 运行测试确认通过**

Run: `cd apps/mobile && npx jest __tests__/FileViewerScreen.test.tsx __tests__/fileStore.test.ts`
Expected: PASS

**Step 5: 全量回归（提前发现漏删引用）**

Run: `cd apps/mobile && npx jest`
Expected: 全部 PASS。若报 `openHtmlViewer`/`viewerHtmlRendered` 未定义，说明仍有引用未清理，用 grep 定位：

Run: `git grep -n "openHtmlViewer\|viewerHtmlRendered\|toggleHtmlRendered" -- apps/mobile/src`
Expected: 无输出

**Step 6: 提交**

```bash
git add apps/mobile/src/screens/FileViewerScreen.tsx apps/mobile/src/stores/fileStore.ts apps/mobile/__tests__/FileViewerScreen.test.tsx apps/mobile/__tests__/fileStore.test.ts
git commit -m "refactor(mobile): retire full-screen html viewer path"
```

---

## Task 7: Android 原生配置 — ✅ 核实为「无需改动」

> 实施时核对 `react-native-blob-util@0.24` 源码后确认：库自带 FileProvider
> （authority `${applicationId}.provider`，paths `@xml/provider_paths` 已含 `<cache-path>`）；
> `actionViewIntent` 用 try/catch 直接 `startActivity`（无 resolveActivity 门控）。
> 因此 App manifest **不可**重复声明同 authority provider（会清单合并冲突），也无需 `<queries>`。
> 外部打开仅靠 JS 侧 `actionViewIntent` 即可。

**Files:** 无（AndroidManifest.xml / filepaths.xml 均不改）

**Step 1: 验证无原生脏改动**

Run: `git status --short apps/mobile/android`
Expected: 无输出

**Step 2: 无需提交**

（本任务无文件改动。）

---

## Task 8: 最终验证（自动化）

**Step 1: 全量单测**

Run: `cd apps/mobile && npx jest`
Expected: 全部 PASS，无 open handles 报错。

**Step 2: TypeScript 类型检查（可选但推荐）**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: 无与本次改动相关的错误（仓库既有错误可忽略，若有请记录在 PR 描述）。

**Step 3: 确认无杂散文件**

Run: `git status --short`
Expected: 仅有预期的源码/测试/原生配置改动；无根目录 `.log`/`.xml`/`.png`。

---

## Task 9: 真机/模拟器手动验证（fire-and-forget，勿阻塞）

> 按 AGENTS.md：长任务后台执行，日志写 `logs/build/`，短查询轮询。

**Step 1: 重新打包 JS bundle**

```powershell
cd apps/mobile
npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android/app/src/main/assets/index.android.bundle --reset-cache 2>&1 | Out-File D:\code\mobile-agent-bridge\logs\build\bundle.log
```

**Step 2: 构建 APK（必须后台 Start-Job）**

```powershell
$null = Start-Job -Name "apk-build-html" -ScriptBlock {
  Set-Location D:\code\mobile-agent-bridge\apps\mobile\android
  taskkill /f /im java.exe 2>$null
  $env:GRADLE_OPTS = "-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false"
  .\gradlew assembleDebug --no-daemon --offline 2>&1 | Out-File D:\code\mobile-agent-bridge\logs\build\build-html.log
}
```

之后短查询：`Test-Path apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`。

**Step 3: 模拟器验收清单**

1. 打开文件浏览器，进入含 `.html` 的目录。
2. 点击 `.html` → 底部升起弹窗，WebView 渲染内容（不整页跳转）。
3. 点「源码」→ 显示 HTML 源码；再点「渲染」→ 回到 WebView。
4. 点「↗ 外部打开」→ 系统弹出打开方式，选浏览器成功显示该 HTML。
5. 点「✕」或背景 → 关闭弹窗，回到文件浏览器。
6. 文本/图片/Markdown 点击仍进入全屏查看器（回归）。

---

## 备注：已知限制（实现时不要"修"）

HTML 来自远端 bridge 项目目录，客户端只有单文件内容。引用相对路径的 CSS/JS/图片在弹窗渲染与外部打开时都无法解析——这是设计内的限制（见设计文档「已知限制」）。不要为此引入下载整目录逻辑（YAGNI）。
