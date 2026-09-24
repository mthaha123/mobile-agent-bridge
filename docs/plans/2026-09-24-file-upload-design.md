# FILES 目录上传小文件 — 设计

日期：2026-09-24
状态：已评审通过（Approach C — 分块 WS 上传）

## 背景与目标

Files 页（`FileBrowserScreen`）当前只支持浏览/查看/下载 PC 侧文件（`file.list` / `file.read` / `file.search` / `file.info`），无上传能力。本设计为 Files 页增加"把手机上的小文件上传到当前浏览目录"的功能。

### 已确认的需求决策

| 决策点 | 结论 |
|---|---|
| 文件来源 | 系统文件选择器（任意类型文件）→ 新增原生依赖 `@react-native-documents/picker@10.1.7`（兼容 RN 0.76.9；v11+ 要求 RN ≥ 0.79，不可用） |
| 传输方式 | **C 方案：分块 WS 上传**（多帧），解除单帧天花板，chunk ack 提供真实进度 |
| 大小限制 | **仅服务端校验**，`config.ts` 读 `BRIDGE_MAX_UPLOAD_BYTES`，默认 `5 * 1024 * 1024`，报错信息携带真实 limit；客户端不做预检 |
| 上传目标 | 当前浏览目录（发起时的 `currentPath`） |
| 重名处理 | 询问覆盖或改名（Alert 三选：覆盖 / 改名 / 取消），改名按 `foo (1).ext` 递增查重 |
| 上传按钮 | header 右侧 `⬆ Upload` |

### 否决的方案

- **A. 单帧 base64 上传**：客户端预检与服务端校验重复、5MB 单帧限制卡死扩展空间 → 否决。
- **B. HTTP multipart 端点**：绕开 WS JWT 通道需另建 HTTP 鉴权，改动面大，对"小文件"过重 → 否决。

## 协议（4 个新 RPC，复用现有 WS token 通道）

| RPC | 参数 | 返回 |
|---|---|---|
| `file.upload.begin` | `dir, name, size, encoding:'base64', overwrite` | `{ uploadId, chunkSize }`（服务端指定分块大小，256KB 二进制） |
| `file.upload.chunk` | `uploadId, index, data`（顺序单发，`index` 必须等于期望序号） | `{ received, total }` |
| `file.upload.finish` | `uploadId` | `{ path, size }` |
| `file.upload.abort` | `uploadId` | `{ ok }` |

- 分块大小由服务端在 `begin` 返回值中指定，客户端按其切片。
- chunk 顺序单发（一次只发一块、等 ack），避免乱序/并发复杂度。
- 大小校验只在服务端：`begin` 验总 `size`，`chunk` 累加兜底。

## 服务端实现（`servers/bridge/`）

### `config.ts`

新增 `maxUploadBytes`：读环境变量 `BRIDGE_MAX_UPLOAD_BYTES`，默认 `5 * 1024 * 1024`。

### `fileHandler.ts`

- 上传会话表：`Map<uploadId, { tempPath, targetPath, expectedSize, received, nextIndex, overwrite, lastActive }>`。
- 临时文件写入目标目录内 `.<name>.<id>.part`（同目录保证 `finish` 时 `fs.rename` 原子落盘）。
- `fileList` 过滤 `.part` 临时文件（浏览不外露）。
- `uploadBegin({ dir, name, size, overwrite })`：
  - 校验目录存在、`size ≤ maxUploadBytes`（超限错误含真实 limit）、重名（已存在且 `overwrite !== true` → `EEXIST`）。
  - 创建临时文件，返回 `{ uploadId, chunkSize }`。
- `uploadChunk({ uploadId, index, data })`：
  - 校验会话存在、`index === nextIndex`（乱序/重复拒绝）、base64 解码追加写入，`received += bytes`。
- `uploadFinish({ uploadId })`：校验 `received === expectedSize` → `fs.rename` 落盘 → 清理会话。
- `uploadAbort({ uploadId })`：删临时文件 → 清理会话。
- TTL 回收：60s 无 chunk 的会话自动删临时文件（断连/崩溃不残留）。

### `router.ts`

注册 `file.upload.begin` / `file.upload.chunk` / `file.upload.finish` / `file.upload.abort` 四个 handler，参数校验与 `file.write` 同风格（缺参抛错）。

## 手机端实现（`apps/mobile/`）

### 依赖

- `@react-native-documents/picker@10.1.7`（安装 + APK 重编）。
- jest `moduleNameMapper` 增加该包 mock。

### `services/BridgeClient.ts`

新增四个纯传输层方法：`uploadBegin` / `uploadChunk` / `uploadFinish` / `uploadAbort`（不引 blob-util）。

### 新增 `services/uploadFile.ts`（编排层）

读文件 → 按服务端 `chunkSize` 切片 → 逐块 `uploadChunk`（单发等 ack，汇报进度）→ `uploadFinish`。读取优先用 `ReactNativeBlobUtil.fs.read(path, offset, length)` 分段读（避免整文件进内存），实现时验证该 API；不可用则降级整读 base64 切片。

### `stores/fileStore.ts`

新增 `uploadProgress: { name, sent, total } | null`。

### `screens/FileBrowserScreen.tsx`

- header 右侧 `⬆ Upload` 按钮。
- 流程：picker（`type:[allFiles]`, 单选, `copyTo:'cachesDirectory'`）→ `file.info` 撞名检测 → Alert 覆盖/改名/取消 → 起传。
- 进度 UI：header 下方进度条 + `✕ 取消`（发 `upload.abort`）。
- 成功后 `loadDirectory(currentPath)` 刷新（以发起时路径为准）。
- picker 取消静默。

## 错误处理

| 场景 | 行为 |
|---|---|
| picker 取消 | 静默 |
| 超限 / 目录不存在 / EEXIST（begin） | Alert 服务端错误（含真实 limit）；EEXIST → 三选弹窗 |
| index 不连续 / 重复 chunk | 服务端拒绝该帧，客户端中止 + abort 清理 + Alert |
| WS 断连 / 超时 | 本次上传失败 Alert；服务端靠 TTL 回收临时文件 |
| finish 时 `received !== size` | 服务端 abort 清理 + 报错 |
| 上传中用户取消 | `file.upload.abort` → 删临时文件 → 关进度条 |
| 上传中切换目录 | 以发起时 `currentPath` 为准，完成后刷新该路径 |

## 测试

- `servers/bridge/__tests__/fileHandler.test.ts`：
  - begin/chunk/finish 组装正确内容（文本 + 二进制 base64）
  - EEXIST（不覆盖抛错 / overwrite 放行）
  - 超 `BRIDGE_MAX_UPLOAD_BYTES` 抛错（含 env 配置生效用例）
  - 乱序 / 重复 index 拒绝
  - finish 长度不符拒绝
  - abort / TTL 清理临时文件
  - `fileList` 不显示 `.part`
- `servers/bridge/__tests__/router.test.ts`：4 个 RPC 注册 / 缺参 / unauthorized。
- `apps/mobile/__tests__/BridgeClient.test.ts`：分块序列、进度回调、abort。
- `apps/mobile/__tests__/FileBrowserScreen.test.tsx`：上传流程 begin→chunk→finish、进度展示、取消、撞名三选。
- E2E：`scripts/e2e/test-new-rpcs.mjs` 补 `file.upload.*`。

## 非目标（YAGNI）

- 断点续传（重连后从断点续）
- 多文件并行 / 多选批量上传
- HTTP 上传端点
- 服务端进度主动推送（chunk ack 即可）
- 传输压缩、自动建目录、目录整包上传
