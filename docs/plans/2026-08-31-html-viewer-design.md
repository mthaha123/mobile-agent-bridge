# HTML 文件渲染支持 — 设计文档

## 背景

当前客户端文件查看器不支持 HTML 渲染。`.html` 文件被当作纯文本以源码形式显示（等宽字体 + 行号）。用户需要查看 HTML 文件的渲染效果，类似于浏览器中的呈现。

## 技术选型

**`react-native-webview` (v13.x)**

| 方案 | Stars | 维护状态 | CSS/JS 支持 | 适用性 |
|------|-------|---------|------------|--------|
| `react-native-webview` | 6,971 | 活跃（月更新） | 完整浏览器级 | ✅ 唯一选择 |
| `react-native-render-html` | 3,658 | 停更（4年） | 受限（无 JS、无 inline CSS） | ❌ |
| `react-native-htmlview` | 2,728 | 停更（2年） | 非常有限 | ❌ |

选择理由：需要完整 CSS 渲染保真度 + 渲染/源码切换 + 活跃维护。

## 数据流

```
FileBrowserScreen.handleFilePress()
  ├── IMAGE_EXTS → openImageViewer()
  ├── .html/.htm → openHtmlViewer()       ← 新增
  └── 其他       → openTextViewer()

fileStore:
  viewerMode: 'text' | 'image' | 'html' | null   ← 扩展
  viewerHtmlRendered: boolean                      ← 新增（控制渲染/源码切换）
  openHtmlViewer(file)                             ← 新增 action

FileViewerScreen:
  ├── viewerMode === 'image' → renderImage()
  ├── viewerMode === 'html'  → renderHtml()        ← 新增
  └── viewerMode === 'text'  → renderText()
```

## 组件改动

### fileStore.ts

- `ViewerMode` 类型：`'text' | 'image' | 'html' | null`
- 新增 `viewerHtmlRendered: boolean` — HTML 默认渲染模式（`true`）
- 新增 `openHtmlViewer(file: FileContent)` — 设置 `viewerMode: 'html'`，`viewerHtmlRendered: true`
- 复用 `toggleViewerSource` 控制 `viewerHtmlRendered`

### FileBrowserScreen.tsx

- `handleFilePress` 检测 `.html`/`.htm` 扩展名 → `openHtmlViewer(content)` + `pushViewer()`

### FileViewerScreen.tsx

- 新增 `renderHtml()` 分支：
  - **渲染模式**（`viewerHtmlRendered === true`）：`<WebView source={{ html }} />`
  - **源码模式**（`viewerHtmlRendered === false`）：复用 `renderText()` 逻辑
- 顶栏：HTML 文件显示"渲染/源码"切换按钮（复用 Markdown 的 `canToggleSource` 逻辑）
- 底栏：渲染模式下隐藏行号/换行按钮

## 安全策略

- `javaScriptEnabled={false}` — 禁止 JS 执行
- `originWhitelist={['*']}` — 允许静态 HTML
- 不启用文件访问、cookies 等敏感能力

## 测试策略

- `jest.config.js` 新增 `react-native-webview` moduleNameMapper
- `__mocks__/react-native-webview.js` — WebView mock（渲染为 View）
- `fileStore.test.ts` — `openHtmlViewer()`、`viewerHtmlRendered` 切换
- `FileViewerScreen.test.tsx` — HTML 模式渲染/源码切换

## 文件清单

| 文件 | 改动 |
|------|------|
| `apps/mobile/package.json` | 新增 `react-native-webview` 依赖 |
| `apps/mobile/src/stores/fileStore.ts` | 扩展 ViewerMode，新增 openHtmlViewer + viewerHtmlRendered |
| `apps/mobile/src/screens/FileBrowserScreen.tsx` | HTML 文件路由到 openHtmlViewer |
| `apps/mobile/src/screens/FileViewerScreen.tsx` | 新增 renderHtml() 分支 |
| `apps/mobile/__mocks__/react-native-webview.js` | 新增 mock |
| `apps/mobile/jest.config.js` | 新增 moduleNameMapper |
| `apps/mobile/__tests__/fileStore.test.ts` | 新增 HTML 相关测试 |
| `apps/mobile/__tests__/FileViewerScreen.test.tsx` | 新增 HTML 渲染测试 |
