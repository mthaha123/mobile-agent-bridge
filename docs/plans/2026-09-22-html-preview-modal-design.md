# HTML 弹窗预览 + 外部打开 — 设计文档（v2）

> 承接 `2026-08-31-html-viewer-design.md`（v1：全屏 WebView 渲染）。
> 本文档记录将 HTML 浏览从「全屏页」改为「弹窗预览」，并新增「交给外部应用打开」能力的决策。

## 背景

v1 已实现 HTML 的渲染查看，但形态是**全屏页面**：`FileBrowserScreen` 点击 `.html` →
`fileStore.openHtmlViewer()` → `uiStore.pushViewer()` 切到 `FileViewerScreen` 全屏渲染。
`FileViewerScreen` 是带 header/footer 的沉浸阅读页，查看 HTML 时会整页替换文件 Tab，
与「快速瞄一眼 HTML 渲染效果」的使用场景不匹配。

同时用户希望**不局限于本应用**：能用系统浏览器/其它 App 打开该 HTML。

## 需求（已确认）

1. HTML 文件（`.html` / `.htm`）以**弹窗（Modal 浮层）**方式预览，不再整页跳转。
2. 弹窗内额外提供**「外部打开」**：把 HTML 交给系统 `ACTION_VIEW`（浏览器/HTML 查看器选择器）。
3. **仅 HTML 改弹窗**；文本 / 图片 / Markdown 继续走现有全屏 `FileViewerScreen`。
4. 弹窗 WebView **禁用 JavaScript**（沿用 v1 安全策略）。
5. 退役 v1 的 HTML 全屏通道，避免渲染双路径。

## 方案对比

| 方案 | 说明 | 结论 |
|------|------|------|
| A. 独立 `HtmlPreviewModal` + store 状态 + MainLayout 全局挂载 | 职责清晰、任意页可触发、状态可测、与全屏查看器解耦 | ✅ 采用 |
| B. Modal 内联在 `FileBrowserScreen` + 局部 `useState` | 改动小，但状态随页面卸载丢失、难复用/难测 | ❌ |
| C. 把 `FileViewerScreen` 包进 Modal | 复用渲染逻辑，但全屏布局嵌 Modal 别扭、耦合重 | ❌ |

## 架构与数据流

```
FileBrowserScreen.handleFilePress()
  ├── IMAGE_EXTS          → openImageViewer() + pushViewer()      （不变）
  ├── .html/.htm          → openHtmlPreview(content)              （改：弹窗，不 pushViewer）
  └── 其他                → openTextViewer()  + pushViewer()      （不变）

fileStore:
  htmlPreviewFile: FileContent | null    // 非空 = 显示弹窗
  htmlPreviewSource: boolean             // false=渲染(WebView)，true=源码
  openHtmlPreview(file) / closeHtmlPreview() / toggleHtmlPreviewSource()

MainLayout:
  <QuestionSheet />      // 现有全局弹窗
  <HtmlPreviewModal />   // 新增全局弹窗（与 QuestionSheet 并列，覆盖整个 Main）
```

外部打开流程（组件内 `handleOpenExternal()`）：

```
htmlPreviewFile.content
  → 计算文件名（path basename，回退 preview.html）
  → ReactNativeBlobUtil.fs.writeFile(CacheDir + '/' + name, content, 'utf8')
  → ReactNativeBlobUtil.android.actionViewIntent(cachePath, 'text/html')
  → 系统弹出「打开方式」选择器（浏览器 / HTML 查看器 …）
```

## 组件改动

### `src/stores/fileStore.ts`

新增：

- `htmlPreviewFile: FileContent | null`（初始 `null`）
- `htmlPreviewSource: boolean`（初始 `false`）
- `openHtmlPreview(file)` — 设 `htmlPreviewFile=file`、`htmlPreviewSource=false`
- `closeHtmlPreview()` — 设 `htmlPreviewFile=null`
- `toggleHtmlPreviewSource()`

退役（v1 遗留，删除以避免双路径）：

- `ViewerMode` 去掉 `'html'`
- `openHtmlViewer`、`viewerHtmlRendered`、`toggleHtmlRendered`

### 新增 `src/screens/HtmlPreviewModal.tsx`

- `<Modal transparent animationType="slide" visible={!!htmlPreviewFile} onRequestClose={closeHtmlPreview}>`
- 底部升起的面板，约占屏高 90%，圆角顶边；背景 `TouchableOpacity` 点击关闭。
- 顶栏：文件名（左）+ `[源码/渲染]` 切换 + `[↗ 外部打开]` + `[✕]`。
- 主体：
  - 渲染模式：`<WebView source={{ html: content }} originWhitelist={['*']} javaScriptEnabled={false} />`
  - 源码模式：等宽字体 `ScrollView`（行号可选，复用简单文本渲染）。
- `handleOpenExternal()`：`writeFile` → `actionViewIntent`；调用中置 loading 防重复点击；
  失败 `Alert.alert('无法外部打开', err.message)`。
- 缓存文件不主动删除（外部 App 可能仍持有），交给系统缓存清理。

### `src/screens/FileBrowserScreen.tsx`

- HTML 分支：`const content = await client?.readFile(filePath); if (content) openHtmlPreview(content)`
  （移除 `openHtmlViewer()` + `pushViewer()`）。
- 移除 `openHtmlViewer` 引用；`HTML_EXTS` 保留。

### `src/components/MainLayout.tsx`

- 挂载 `<HtmlPreviewModal />`（与 `<QuestionSheet />` 并列，位于 `SafeAreaView` 内末尾）。

### `src/screens/FileViewerScreen.tsx`（清理）

移除 HTML 相关代码：

- `isHtml()`、`renderHtml()`、`isHtmlMode`
- `WebView` import、`webview` style
- `canToggleSource` 中的 HTML 条件
- `viewerHtmlRendered` / `toggleHtmlRendered` 绑定
- `showTextFooter` 中的 `isHtmlMode` 条件

保留文本 / 图片 / Markdown 全部逻辑不变。

## Android 原生配置（外部打开必需）

`targetSdk 34`。`react-native-blob-util` 的 `actionViewIntent` 使用
authority = `${applicationId}.provider` 的 FileProvider。

### `android/app/src/main/AndroidManifest.xml`

```xml
<provider
  android:name="androidx.core.content.FileProvider"
  android:authorities="${applicationId}.provider"
  android:exported="false"
  android:grantUriPermissions="true">
  <meta-data
    android:name="android.support.FILE_PROVIDER_PATHS"
    android:resource="@xml/filepaths" />
</provider>

<!-- 防 Android 11+ 包可见性导致无法解析 text/html 查看器 -->
<queries>
  <intent>
    <action android:name="android.intent.action.VIEW" />
    <data android:mimeType="text/html" />
  </intent>
</queries>
```

### 新增 `android/app/src/main/res/xml/filepaths.xml`

```xml
<paths>
  <cache-path name="cache" path="." />
</paths>
```

最小权限：只暴露应用 cache 目录（写入目标即 `CacheDir`）。

## 安全策略

- `javaScriptEnabled={false}` — agent 产出的 HTML 不执行 JS。
- `originWhitelist={['*']}` — 允许静态 HTML。
- 不注入任何原生 bridge，外部打开仅经 FileProvider 暴露单一缓存文件。

## 已知限制

- HTML 来自远端 bridge 的项目目录，客户端只拿到**单文件内容**；引用**相对路径**的
  CSS/JS/图片在弹窗渲染与外部打开时均**无法解析**。仅自带内联样式/脚本或引用远程 URL /
  data URI 的 HTML 可完整显示。
- 弹窗渲染不提供 v1 全屏查看器里的字号调节/下载等控件（保持弹窗轻量）。如需下载/字号，
  仍可从文件浏览器长按「Download」。

## 测试策略

| 文件 | 内容 |
|------|------|
| `__mocks__/react-native-blob-util.js` | 补 `android.actionViewIntent`（jest.fn） |
| `__tests__/HtmlPreviewModal.test.tsx`（新增） | 无 HTML 时不渲染 WebView；`source.html` 正确；切换到源码隐藏 WebView；✕ 关闭；外部打开调用 `fs.writeFile` + `android.actionViewIntent`；失败时 Alert |
| `__tests__/fileStore.test.ts` | 新 action 覆盖（open/close/toggle） |
| `__tests__/FileViewerScreen.test.tsx` | 删除 `describe('FileViewerScreen — html')`（HTML 已不在该屏） |
| `__tests__/FileBrowserScreen.test.tsx` | HTML 点击 → `openHtmlPreview`，不再 `pushViewer` |

验证命令：`cd apps/mobile && npx jest`。

## 文件清单

| 文件 | 改动 |
|------|------|
| `apps/mobile/src/stores/fileStore.ts` | 新增 htmlPreview* 状态与 action；退役 html 全屏通道 |
| `apps/mobile/src/screens/HtmlPreviewModal.tsx` | 新增弹窗组件 |
| `apps/mobile/src/screens/FileBrowserScreen.tsx` | HTML 路由改 `openHtmlPreview` |
| `apps/mobile/src/screens/FileViewerScreen.tsx` | 移除 HTML 分支 |
| `apps/mobile/src/components/MainLayout.tsx` | 挂载 `HtmlPreviewModal` |
| `apps/mobile/android/app/src/main/AndroidManifest.xml` | FileProvider + queries |
| `apps/mobile/android/app/src/main/res/xml/filepaths.xml` | 新增 cache-path |
| `apps/mobile/__mocks__/react-native-blob-util.js` | 补 actionViewIntent mock |
| `apps/mobile/__tests__/HtmlPreviewModal.test.tsx` | 新增测试 |
| `apps/mobile/__tests__/fileStore.test.ts` | 新 action 测试 |
| `apps/mobile/__tests__/FileViewerScreen.test.tsx` | 移除 html 测试 |
| `apps/mobile/__tests__/FileBrowserScreen.test.tsx` | HTML 路由测试更新 |

## 交付后手动验证

1. `npx jest` 全绿。
2. 重新打包 JS bundle 并 `gradlew assembleDebug`（见 AGENTS.md）。
3. 模拟器内打开含内联样式/远程 URL 的 `.html` → 弹出预览浮层 → 切「源码」→「外部打开」
   选择浏览器成功显示 → 关闭弹窗回到文件浏览器。
