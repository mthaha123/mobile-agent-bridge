# FILES 目录分块上传（file.upload.*）实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Files 页支持从系统文件选择器挑选小文件，分块上传到当前浏览目录（重名询问覆盖/改名）。

**Architecture:** 新增 4 个 bridge WS RPC（`file.upload.begin/chunk/finish/abort`），服务端在目标目录写 `.part` 临时文件、finish 时原子 rename 落盘；大小限制只在服务端（`BRIDGE_MAX_UPLOAD_BYTES`，默认 5MB）。手机端 `BridgeClient` 提供 4 个传输方法，`services/uploadFile.ts` 负责整读 base64 → 按服务端 chunkSize 切片 → 顺序单发，`FileBrowserScreen` 负责 picker、撞名三选、进度条。

**Tech Stack:** TypeScript (bridge: ts-jest ESM / mobile: ts-jest)、`ws`、`zustand`、`react-native-blob-util`、`@react-native-documents/picker@10.1.7`（RN 0.76.9 兼容上限；v11+ 要求 RN ≥0.79）。

**设计文档:** `docs/plans/2026-09-24-file-upload-design.md`（已提交 2d3765d）

**执行环境注意:**
- shell 是 **cmd.exe**（用 `cd /d`、`dir /b`、`findstr`，不是 bash/PowerShell 语法）。
- 所有测试命令单次 < 30s，直接跑；超 30s 的打包任务必须 fire-and-forget + 短轮询（见 Task 15）。
- 仓库根目录有一个未跟踪杂散文件 `.maestro/flows/tmp-rollback-smoke.yaml`，**任何 commit 都不要 add 它**。
- 每个 Task 结束都 commit；commit 前 `git status` 确认只 add 本任务文件。

---

### Task 1: Bridge 配置 `BRIDGE_MAX_UPLOAD_BYTES`

**Files:**
- Modify: `servers/bridge/src/config.ts`（文件末尾追加）
- Test: `servers/bridge/__tests__/config.test.ts`（import 行 + 文件末尾追加 describe）

**Step 1: 写失败测试**

`config.test.ts` 顶部 import 改为：

```ts
import {
  DEFAULT_SERVE_PORT_POOL,
  parseServePortPool,
  resolveDataDir,
  resolveBridgePort,
  resolveOpenCodeUrl,
  DEFAULT_MAX_UPLOAD_BYTES,
  resolveMaxUploadBytes,
} from "../src/config.js"
```

文件末尾追加：

```ts
describe("config.resolveMaxUploadBytes", () => {
  it("默认 5MB", () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024)
    expect(resolveMaxUploadBytes({})).toBe(5 * 1024 * 1024)
  })

  it("读取 BRIDGE_MAX_UPLOAD_BYTES", () => {
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "1048576" })).toBe(1048576)
  })

  it("非法/非正数回退默认", () => {
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "abc" })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "0" })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "-5" })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "   " })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
  })
})
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && node --experimental-vm-modules node_modules\jest\bin\jest.js --forceExit config.test.ts
```

预期：FAIL — `DEFAULT_MAX_UPLOAD_BYTES` 未导出（TS2305 / has no exported member）。

**Step 3: 最小实现**

`src/config.ts` 末尾追加：

```ts
/** 上传大小上限默认值：5MB（字节）。可用 BRIDGE_MAX_UPLOAD_BYTES 覆盖 */
export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/**
 * 解析上传大小上限（字节）：BRIDGE_MAX_UPLOAD_BYTES，非法/未设回退 DEFAULT_MAX_UPLOAD_BYTES。
 * 只读传入 env（默认 process.env），纯函数便于单测。
 */
export function resolveMaxUploadBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.BRIDGE_MAX_UPLOAD_BYTES || "", 10)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD_BYTES
}
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS `config.test.ts`，`Tests: 全部通过`。

**Step 5: Commit**

```
git add servers/bridge/src/config.ts servers/bridge/__tests__/config.test.ts
git commit -m "feat(bridge): BRIDGE_MAX_UPLOAD_BYTES configurable upload size limit"
```

---

### Task 2: `fileHandler` 上传会话基础 + `uploadBegin` + `uploadAbort` + TTL 回收

**Files:**
- Modify: `servers/bridge/src/server/fileHandler.ts`（顶部 import + 文件末尾追加）
- Test: `servers/bridge/__tests__/fileHandler.test.ts`（import 行 + 追加 describe）

**Step 1: 写失败测试**

`fileHandler.test.ts` 顶部 import 改为：

```ts
import {
  fileList, fileRead, fileSearch, getFileInfo, fileExists,
  uploadBegin, uploadAbort,
  _testGetUploads, sweepStaleUploads,
  UPLOAD_CHUNK_SIZE_CHARS, UPLOAD_TTL_MS,
} from "../src/server/fileHandler"
```

文件末尾（最后一个 `})` 之前，或直接追加新顶层 describe）追加：

```ts
describe("upload — begin/abort/sweep", () => {
  afterEach(async () => {
    delete process.env.BRIDGE_MAX_UPLOAD_BYTES
    for (const id of [..._testGetUploads().keys()]) {
      await uploadAbort(id)
    }
  })

  it("begin 返回 uploadId 与 4 的倍数 chunkSize，并创建临时文件", async () => {
    const r = await uploadBegin({ dir: testDir, name: "new-upload.txt", size: 10 })
    expect(typeof r.uploadId).toBe("string")
    expect(r.uploadId.length).toBeGreaterThan(8)
    expect(r.chunkSize).toBe(UPLOAD_CHUNK_SIZE_CHARS)
    expect(r.chunkSize % 4).toBe(0)
    const s = _testGetUploads().get(r.uploadId)
    expect(s).toBeDefined()
    expect(s!.tempPath.endsWith(".part")).toBe(true)
    expect(await fileExists(s!.tempPath)).toBe(true)
    // 落盘前不产生目标文件
    expect(await fileExists(path.join(testDir, "new-upload.txt"))).toBe(false)
  })

  it("begin 拒绝不存在的目录", async () => {
    await expect(uploadBegin({ dir: path.join(testDir, "nope-dir"), name: "a.txt", size: 1 }))
      .rejects.toThrow("directory not found")
  })

  it("begin 按 BRIDGE_MAX_UPLOAD_BYTES 拒绝超限文件", async () => {
    process.env.BRIDGE_MAX_UPLOAD_BYTES = "1024"
    await expect(uploadBegin({ dir: testDir, name: "big.bin", size: 2048 }))
      .rejects.toThrow("file too large: 2048 bytes > limit 1024 bytes")
    delete process.env.BRIDGE_MAX_UPLOAD_BYTES
    // 恢复默认（5MB）后同 size 放行
    const r = await uploadBegin({ dir: testDir, name: "big.bin", size: 2048 })
    expect(r.uploadId).toBeTruthy()
    await uploadAbort(r.uploadId)
  })

  it("begin 同名文件未 overwrite 抛 EEXIST，overwrite 放行", async () => {
    await expect(uploadBegin({ dir: testDir, name: "test.txt", size: 5 }))
      .rejects.toThrow("EEXIST")
    const r = await uploadBegin({ dir: testDir, name: "test.txt", size: 5, overwrite: true })
    expect(r.uploadId).toBeTruthy()
    await uploadAbort(r.uploadId)
  })

  it("begin 拒绝路径穿越/空文件名", async () => {
    await expect(uploadBegin({ dir: testDir, name: "../evil.txt", size: 1 })).rejects.toThrow("invalid file name")
    await expect(uploadBegin({ dir: testDir, name: "..\\evil.txt", size: 1 })).rejects.toThrow("invalid file name")
    await expect(uploadBegin({ dir: testDir, name: "", size: 1 })).rejects.toThrow("invalid file name")
    await expect(uploadBegin({ dir: testDir, name: "..", size: 1 })).rejects.toThrow("invalid file name")
  })

  it("begin 拒绝非法 size", async () => {
    await expect(uploadBegin({ dir: testDir, name: "x.txt", size: -1 })).rejects.toThrow("invalid size")
    await expect(uploadBegin({ dir: testDir, name: "x.txt", size: 1.5 })).rejects.toThrow("invalid size")
  })

  it("abort 删除临时文件，重复 abort 幂等返回 ok", async () => {
    const r = await uploadBegin({ dir: testDir, name: "canceled.txt", size: 3 })
    const temp = _testGetUploads().get(r.uploadId)!.tempPath
    expect(await uploadAbort(r.uploadId)).toEqual({ ok: true })
    expect(await fileExists(temp)).toBe(false)
    expect(_testGetUploads().has(r.uploadId)).toBe(false)
    expect(await uploadAbort(r.uploadId)).toEqual({ ok: true })
  })

  it("sweepStaleUploads 回收超过 TTL 的残留会话与临时文件", async () => {
    const r = await uploadBegin({ dir: testDir, name: "stale.txt", size: 3 })
    const s = _testGetUploads().get(r.uploadId)!
    const temp = s.tempPath
    s.lastActive = Date.now() - UPLOAD_TTL_MS - 1000
    sweepStaleUploads()
    await new Promise((res) => setTimeout(res, 50)) // unlink 异步，等一个 tick
    expect(_testGetUploads().has(r.uploadId)).toBe(false)
    expect(await fileExists(temp)).toBe(false)
  })
})
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && node --experimental-vm-modules node_modules\jest\bin\jest.js --forceExit fileHandler.test.ts
```

预期：FAIL — `uploadBegin` 等未导出（TS2305）。

**Step 3: 最小实现**

`src/server/fileHandler.ts`：

顶部 import 区追加：

```ts
import { randomUUID } from "node:crypto"
import { resolveMaxUploadBytes } from "../config.js"
```

文件末尾追加：

```ts
// ===== 分块上传（file.upload.*） =====

/** 分块大小：base64 字符数（4 的倍数保证每块可独立解码；262144 字符 ≈ 192KB 二进制） */
export const UPLOAD_CHUNK_SIZE_CHARS = 262144
/** 上传会话 TTL：60s 无 chunk 视为残留，回收临时文件（begin/chunk 时惰性触发，不引入定时器） */
export const UPLOAD_TTL_MS = 60_000
/** 上传临时文件后缀（fileList 过滤，浏览不外露） */
export const UPLOAD_PART_SUFFIX = ".part"

export interface UploadSession {
  tempPath: string
  targetPath: string
  expectedSize: number
  received: number
  nextIndex: number
  lastActive: number
}

const uploads = new Map<string, UploadSession>()

/** @internal 测试用：暴露会话表 */
export function _testGetUploads(): Map<string, UploadSession> { return uploads }

async function cleanupUpload(uploadId: string): Promise<void> {
  const s = uploads.get(uploadId)
  if (!s) return
  uploads.delete(uploadId)
  await fs.unlink(s.tempPath).catch(() => {})
}

/** 回收超过 TTL 的残留会话（惰性触发，无定时器） */
export function sweepStaleUploads(now: number = Date.now()): void {
  for (const [id, s] of uploads) {
    if (now - s.lastActive > UPLOAD_TTL_MS) {
      void cleanupUpload(id)
    }
  }
}

/** 开始上传：校验目录/大小/重名，创建 .part 临时文件 */
export async function uploadBegin(params: {
  dir: string
  name: string
  size: number
  overwrite?: boolean
}): Promise<{ uploadId: string; chunkSize: number }> {
  sweepStaleUploads()
  const { dir, name, size, overwrite } = params

  // 文件名必须是纯 basename（含显式反斜杠检查，Windows/POSIX 双防）
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw new Error(`invalid file name: ${name}`)
  }
  const resolvedDir = path.resolve(dir)
  const dirStat = await fs.stat(resolvedDir).catch(() => null)
  if (!dirStat || !dirStat.isDirectory()) throw new Error(`directory not found: ${dir}`)

  if (!Number.isInteger(size) || size < 0) throw new Error(`invalid size: ${size}`)
  const limit = resolveMaxUploadBytes(process.env)
  if (size > limit) throw new Error(`file too large: ${size} bytes > limit ${limit} bytes`)

  const targetPath = path.join(resolvedDir, name)
  if (!overwrite && await fileExists(targetPath)) {
    throw new Error(`EEXIST: ${targetPath} already exists`)
  }

  const uploadId = randomUUID()
  const tempPath = path.join(resolvedDir, `.${name}.${uploadId.slice(0, 8)}${UPLOAD_PART_SUFFIX}`)
  await fs.writeFile(tempPath, "")
  uploads.set(uploadId, {
    tempPath,
    targetPath,
    expectedSize: size,
    received: 0,
    nextIndex: 0,
    lastActive: Date.now(),
  })
  return { uploadId, chunkSize: UPLOAD_CHUNK_SIZE_CHARS }
}

/** 中止上传：删临时文件；未知 uploadId 幂等返回 ok（客户端重复取消安全） */
export async function uploadAbort(uploadId: string): Promise<{ ok: boolean }> {
  await cleanupUpload(uploadId)
  return { ok: true }
}
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS `fileHandler.test.ts`（既有测试 + 新增 upload describe 全过）。

**Step 5: Commit**

```
git add servers/bridge/src/server/fileHandler.ts servers/bridge/__tests__/fileHandler.test.ts
git commit -m "feat(bridge): file.upload.begin/abort with session table, size limit, TTL sweep"
```

---

### Task 3: `fileHandler.uploadChunk`

**Files:**
- Modify: `servers/bridge/src/server/fileHandler.ts`（uploadAbort 之后追加）
- Test: `servers/bridge/__tests__/fileHandler.test.ts`（upload describe 内追加）

**Step 1: 写失败测试**

在 `describe("upload — begin/abort/sweep")` 的 afterEach 之前插入新 describe：

```ts
describe("upload — chunk", () => {
  afterEach(async () => {
    for (const id of [..._testGetUploads().keys()]) {
      await uploadAbort(id)
    }
  })

  it("chunk 按序追加并返回累计 received/total", async () => {
    const r = await uploadBegin({ dir: testDir, name: "chunked.txt", size: 6 })
    const c1 = await uploadChunk(r.uploadId, 0, Buffer.from("abc").toString("base64"))
    expect(c1).toEqual({ received: 3, total: 6 })
    const c2 = await uploadChunk(r.uploadId, 1, Buffer.from("def").toString("base64"))
    expect(c2).toEqual({ received: 6, total: 6 })
    const temp = _testGetUploads().get(r.uploadId)!.tempPath
    expect(await fs.readFile(temp, "utf8")).toBe("abcdef")
  })

  it("chunk 拒绝乱序/重复 index（期望序号不前移）", async () => {
    const r = await uploadBegin({ dir: testDir, name: "ooo.txt", size: 6 })
    await uploadChunk(r.uploadId, 0, Buffer.from("ab").toString("base64"))
    await expect(uploadChunk(r.uploadId, 2, Buffer.from("cd").toString("base64")))
      .rejects.toThrow("out-of-order chunk")
    await expect(uploadChunk(r.uploadId, 0, Buffer.from("ab").toString("base64")))
      .rejects.toThrow("out-of-order chunk")
    // 乱序被拒后正确序号仍可继续
    const c = await uploadChunk(r.uploadId, 1, Buffer.from("cd").toString("base64"))
    expect(c.received).toBe(4)
    await uploadAbort(r.uploadId)
  })

  it("chunk 拒绝未知 uploadId", async () => {
    await expect(uploadChunk("no-such-upload-id", 0, "AA==")).rejects.toThrow("unknown uploadId")
  })

  it("chunk 超出声明 size 时清理会话并报错", async () => {
    const r = await uploadBegin({ dir: testDir, name: "overflow.txt", size: 2 })
    await expect(uploadChunk(r.uploadId, 0, Buffer.from("abcd").toString("base64")))
      .rejects.toThrow("overflow")
    expect(_testGetUploads().has(r.uploadId)).toBe(false)
    expect(await fileExists(path.join(testDir, "overflow.txt"))).toBe(false)
  })

  it("chunk 拒绝超大单帧（> UPLOAD_CHUNK_SIZE_CHARS）", async () => {
    const r = await uploadBegin({ dir: testDir, name: "huge.txt", size: UPLOAD_CHUNK_SIZE_CHARS * 3 })
    await expect(uploadChunk(r.uploadId, 0, "A".repeat(UPLOAD_CHUNK_SIZE_CHARS + 4)))
      .rejects.toThrow("chunk too large")
    await uploadAbort(r.uploadId)
  })
})
```

同时把外层 import 行补上 `uploadChunk`：

```ts
import {
  fileList, fileRead, fileSearch, getFileInfo, fileExists,
  uploadBegin, uploadChunk, uploadAbort,
  _testGetUploads, sweepStaleUploads,
  UPLOAD_CHUNK_SIZE_CHARS, UPLOAD_TTL_MS,
} from "../src/server/fileHandler"
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && node --experimental-vm-modules node_modules\jest\bin\jest.js --forceExit fileHandler.test.ts
```

预期：FAIL — `uploadChunk` 未导出（TS2305）。

**Step 3: 最小实现**

`fileHandler.ts` 中 `uploadAbort` 之后追加：

```ts
/** 追加一个分块：严格顺序单发（index 必须等于期望序号），返回累计进度 */
export async function uploadChunk(
  uploadId: string,
  index: number,
  data: string,
): Promise<{ received: number; total: number }> {
  sweepStaleUploads()
  const s = uploads.get(uploadId)
  if (!s) throw new Error(`unknown uploadId: ${uploadId}`)
  s.lastActive = Date.now()

  if (index !== s.nextIndex) {
    throw new Error(`out-of-order chunk: expected index ${s.nextIndex}, got ${index}`)
  }
  if (data.length > UPLOAD_CHUNK_SIZE_CHARS) {
    throw new Error(`chunk too large: ${data.length} chars > ${UPLOAD_CHUNK_SIZE_CHARS}`)
  }

  const buf = Buffer.from(data, "base64")
  // 兜底防超声明大小（begin 已按 BRIDGE_MAX_UPLOAD_BYTES 拦总大小）
  if (s.received + buf.length > s.expectedSize) {
    await cleanupUpload(uploadId)
    throw new Error(`upload overflow: would exceed declared size ${s.expectedSize} bytes`)
  }

  await fs.appendFile(s.tempPath, buf)
  s.received += buf.length
  s.nextIndex += 1
  return { received: s.received, total: s.expectedSize }
}
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS。

**Step 5: Commit**

```
git add servers/bridge/src/server/fileHandler.ts servers/bridge/__tests__/fileHandler.test.ts
git commit -m "feat(bridge): file.upload.chunk with strict in-order append and overflow guard"
```

---

### Task 4: `fileHandler.uploadFinish`（原子落盘）

**Files:**
- Modify: `servers/bridge/src/server/fileHandler.ts`（uploadChunk 之后追加）
- Test: `servers/bridge/__tests__/fileHandler.test.ts`（追加 describe）

**Step 1: 写失败测试**

import 行补 `uploadFinish`（`uploadBegin, uploadChunk, uploadFinish, uploadAbort, ...`）。

文件追加：

```ts
describe("upload — finish", () => {
  afterEach(async () => {
    for (const id of [..._testGetUploads().keys()]) {
      await uploadAbort(id)
    }
  })

  it("组装文本内容并原子落盘", async () => {
    const text = "Hello, World!\n上传测试"
    const bytes = Buffer.byteLength(text, "utf8")
    const r = await uploadBegin({ dir: testDir, name: "up-text.txt", size: bytes })
    await uploadChunk(r.uploadId, 0, Buffer.from(text, "utf8").toString("base64"))
    const f = await uploadFinish(r.uploadId)
    expect(f.path).toBe(path.join(path.resolve(testDir), "up-text.txt"))
    expect(f.size).toBe(bytes)
    expect(await fs.readFile(f.path, "utf8")).toBe(text)
    expect(_testGetUploads().has(r.uploadId)).toBe(false)
    // 临时文件已消失
    expect((await fs.readdir(testDir)).some((n) => n.startsWith(".up-text.txt") && n.endsWith(".part"))).toBe(false)
  })

  it("组装二进制内容逐字节一致", async () => {
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])
    const r = await uploadBegin({ dir: testDir, name: "up-bin.png", size: bin.length })
    await uploadChunk(r.uploadId, 0, bin.toString("base64"))
    await uploadFinish(r.uploadId)
    const written = await fs.readFile(path.join(path.resolve(testDir), "up-bin.png"))
    expect(Buffer.compare(written, bin)).toBe(0)
  })

  it("多块顺序上传后 finish 内容完整", async () => {
    const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")
    const bytes = Buffer.byteLength(content, "utf8")
    const b64 = Buffer.from(content, "utf8").toString("base64")
    const r = await uploadBegin({ dir: testDir, name: "multi.txt", size: bytes })
    // 手工按 4 字符对齐切片模拟客户端
    const step = 16
    for (let i = 0, idx = 0; i < b64.length; i += step, idx++) {
      await uploadChunk(r.uploadId, idx, b64.slice(i, i + step))
    }
    await uploadFinish(r.uploadId)
    expect(await fs.readFile(path.join(testDir, "multi.txt"), "utf8")).toBe(content)
  })

  it("overwrite=true 覆盖同名既有文件", async () => {
    const r = await uploadBegin({ dir: testDir, name: "test.txt", size: 5, overwrite: true })
    await uploadChunk(r.uploadId, 0, Buffer.from("new!!").toString("base64"))
    await uploadFinish(r.uploadId)
    expect(await fs.readFile(path.join(testDir, "test.txt"), "utf8")).toBe("new!!")
  })

  it("长度不符时清理会话且不产生目标文件", async () => {
    const r = await uploadBegin({ dir: testDir, name: "short.txt", size: 10 })
    await uploadChunk(r.uploadId, 0, Buffer.from("abc").toString("base64"))
    await expect(uploadFinish(r.uploadId)).rejects.toThrow("incomplete")
    expect(_testGetUploads().has(r.uploadId)).toBe(false)
    expect(await fileExists(path.join(testDir, "short.txt"))).toBe(false)
    expect((await fs.readdir(testDir)).some((n) => n.startsWith(".short.txt"))).toBe(false)
  })

  it("finish 未知 uploadId 报错", async () => {
    await expect(uploadFinish("no-such-id")).rejects.toThrow("unknown uploadId")
  })
})
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && node --experimental-vm-modules node_modules\jest\bin\jest.js --forceExit fileHandler.test.ts
```

预期：FAIL — `uploadFinish` 未导出。

**Step 3: 最小实现**

`fileHandler.ts` 中 `uploadChunk` 之后追加：

```ts
/** 完成上传：校验字节数 → rename 原子落盘 → 清理会话；不符则清理并报错 */
export async function uploadFinish(uploadId: string): Promise<{ path: string; size: number }> {
  const s = uploads.get(uploadId)
  if (!s) throw new Error(`unknown uploadId: ${uploadId}`)

  if (s.received !== s.expectedSize) {
    await cleanupUpload(uploadId)
    throw new Error(`incomplete upload: received ${s.received} of ${s.expectedSize} bytes`)
  }

  // 同目录 rename（同一文件系统）→ 原子替换（Windows 由 libuv 映射 MOVEFILE_REPLACE_EXISTING）
  await fs.rename(s.tempPath, s.targetPath)
  uploads.delete(uploadId)
  return { path: s.targetPath, size: s.received }
}
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS（fileHandler.test.ts 全量）。

**Step 5: Commit**

```
git add servers/bridge/src/server/fileHandler.ts servers/bridge/__tests__/fileHandler.test.ts
git commit -m "feat(bridge): file.upload.finish atomic rename with size verification"
```

---

### Task 5: `fileList` 过滤 `.part` 临时文件

**Files:**
- Modify: `servers/bridge/src/server/fileHandler.ts`（`fileList` 函数内）
- Test: `servers/bridge/__tests__/fileHandler.test.ts`（fileList describe 内追加）

**Step 1: 写失败测试**

在 `describe("fileList")` 内追加：

```ts
it("过滤上传临时文件（.part），正常文件仍可见", async () => {
  const partFile = path.join(testDir, ".up.txt.abcdef12.part")
  await fs.writeFile(partFile, "partial-data")
  try {
    const files = await fileList(testDir)
    const names = files.map((f) => f.name)
    expect(names).not.toContain(".up.txt.abcdef12.part")
    expect(names).toContain("test.txt")
  } finally {
    await fs.rm(partFile, { force: true })
  }
})
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && node --experimental-vm-modules node_modules\jest\bin\jest.js --forceExit fileHandler.test.ts
```

预期：FAIL — `expect(received).not.toContain(".up.txt.abcdef12.part")`（当前不过滤）。

**Step 3: 最小实现**

`fileList` 的 for 循环体开头加一行（`UPLOAD_PART_SUFFIX` 常量已在 Task 2 定义，注意本文件中该常量声明在文件末尾——ES module `const` 有 TDZ，若报 `Cannot access 'UPLOAD_PART_SUFFIX' before initialization`，把三个上传常量与 `UploadSession`/`uploads` 声明移到 `fileList` **之前**，即 `export interface SearchResult` 之后）：

```ts
for (const entry of entries) {
  // 隐藏上传中的 .part 临时文件（浏览器不外露半成品）
  if (entry.name.endsWith(UPLOAD_PART_SUFFIX)) continue
  try {
    ...
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS。

**Step 5: Commit**

```
git add servers/bridge/src/server/fileHandler.ts servers/bridge/__tests__/fileHandler.test.ts
git commit -m "feat(bridge): fileList hides in-flight .part upload temp files"
```

---

### Task 6: `router.ts` 注册 4 个 RPC + `router.test.ts` 接口保障

**Files:**
- Modify: `servers/bridge/src/server/router.ts`（fileHandler import 行 + `file.info` handler 之后）
- Test: `servers/bridge/__tests__/router.test.ts`（`// ===== File handlers =====` 区域末尾追加）

**Step 1: 写失败测试**

`router.test.ts` 文件中 `// ===== File handlers =====` 注释所在 describe 区域的末尾（整个外层 `describe("RPC Router")` 的最后一个 `it` 之前）追加：

```ts
  // ===== File upload handlers（file.upload.* 接口对齐保障） =====

  it("should reject file.upload.begin without dir", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.upload.begin",
      params: { name: "a.txt", size: 1 },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("dir")
  })

  it("should reject file.upload.begin without name", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.upload.begin",
      params: { dir: ".", size: 1 },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("name")
  })

  it("should reject file.upload.begin without size", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.upload.begin",
      params: { dir: ".", name: "a.txt" },
    }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("size")
  })

  it("should reject file.upload.chunk without uploadId/index/data", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "file.upload.chunk", params: { index: 0, data: "AA==" } }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("uploadId")
    await handleFrame("conn1", ws, { type: "req", id: "2", method: "file.upload.chunk", params: { uploadId: "u", data: "AA==" } }, testPayload)
    expect(messages[1].ok).toBe(false)
    expect(messages[1].error).toContain("index")
    await handleFrame("conn1", ws, { type: "req", id: "3", method: "file.upload.chunk", params: { uploadId: "u", index: 0 } }, testPayload)
    expect(messages[2].ok).toBe(false)
    expect(messages[2].error).toContain("data")
  })

  it("should reject file.upload.finish without uploadId", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "file.upload.finish", params: {} }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("uploadId")
  })

  it("should reject file.upload.abort without uploadId", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, { type: "req", id: "1", method: "file.upload.abort", params: {} }, testPayload)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("uploadId")
  })

  it("should reject file.upload.begin without auth payload (unauthorized)", async () => {
    const { ws, messages } = createMockWs()
    await handleFrame("conn1", ws, {
      type: "req", id: "1", method: "file.upload.begin",
      params: { dir: ".", name: "a.txt", size: 1 },
    }, null)
    expect(messages[0].ok).toBe(false)
    expect(messages[0].error).toContain("unauthorized")
  })

  it("should roundtrip file.upload.begin → chunk → finish via handleFrame", async () => {
    const fsMod = await import("node:fs/promises")
    const pathMod = await import("node:path")
    const osMod = await import("node:os")
    const dir = await fsMod.mkdtemp(pathMod.join(osMod.tmpdir(), "mab-upload-"))
    try {
      const content = "hello upload"
      const bytes = Buffer.byteLength(content, "utf8")

      const w1 = createMockWs()
      await handleFrame("conn1", w1.ws, {
        type: "req", id: "1", method: "file.upload.begin",
        params: { dir, name: "up.txt", size: bytes },
      }, testPayload)
      expect(w1.messages[0].ok).toBe(true)
      const { uploadId, chunkSize } = w1.messages[0].payload
      expect(typeof uploadId).toBe("string")
      expect(chunkSize % 4).toBe(0)

      const w2 = createMockWs()
      await handleFrame("conn1", w2.ws, {
        type: "req", id: "2", method: "file.upload.chunk",
        params: { uploadId, index: 0, data: Buffer.from(content, "utf8").toString("base64") },
      }, testPayload)
      expect(w2.messages[0].ok).toBe(true)
      expect(w2.messages[0].payload).toEqual({ received: bytes, total: bytes })

      const w3 = createMockWs()
      await handleFrame("conn1", w3.ws, {
        type: "req", id: "3", method: "file.upload.finish", params: { uploadId },
      }, testPayload)
      expect(w3.messages[0].ok).toBe(true)
      expect(w3.messages[0].payload.size).toBe(bytes)

      const written = await fsMod.readFile(pathMod.join(dir, "up.txt"), "utf8")
      expect(written).toBe(content)
    } finally {
      await fsMod.rm(dir, { recursive: true, force: true })
    }
  })
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && node --experimental-vm-modules node_modules\jest\bin\jest.js --forceExit router.test.ts
```

预期：FAIL — 多个 `unknown method: file.upload.*`。

**Step 3: 最小实现**

`router.ts` 顶部 import 改为：

```ts
import {
  fileList, fileRead, fileSearch, getFileInfo,
  uploadBegin, uploadChunk, uploadFinish, uploadAbort,
} from "./fileHandler.js"
```

`file.info` handler 注册之后追加：

```ts
// ===== 分块上传（file.upload.*，协议见 docs/plans/2026-09-24-file-upload-design.md）=====

registerHandler("file.upload.begin", async (p) => {
  const dir = p.dir || p.path || p.directory
  if (!dir) throw new Error("file.upload.begin requires dir parameter")
  if (typeof p.name !== "string" || !p.name) throw new Error("file.upload.begin requires name parameter")
  if (typeof p.size !== "number") throw new Error("file.upload.begin requires size number")
  return uploadBegin({ dir, name: p.name, size: p.size, overwrite: !!p.overwrite })
})

registerHandler("file.upload.chunk", async (p) => {
  if (typeof p.uploadId !== "string" || !p.uploadId) throw new Error("file.upload.chunk requires uploadId parameter")
  if (typeof p.index !== "number" || !Number.isInteger(p.index) || p.index < 0) throw new Error("file.upload.chunk requires index number")
  if (typeof p.data !== "string") throw new Error("file.upload.chunk requires data string")
  return uploadChunk(p.uploadId, p.index, p.data)
})

registerHandler("file.upload.finish", async (p) => {
  if (typeof p.uploadId !== "string" || !p.uploadId) throw new Error("file.upload.finish requires uploadId parameter")
  return uploadFinish(p.uploadId)
})

registerHandler("file.upload.abort", async (p) => {
  if (typeof p.uploadId !== "string" || !p.uploadId) throw new Error("file.upload.abort requires uploadId parameter")
  return uploadAbort(p.uploadId)
})
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS `router.test.ts` 全量。

**Step 5: Commit**

```
git add servers/bridge/src/server/router.ts servers/bridge/__tests__/router.test.ts
git commit -m "feat(bridge): register file.upload.begin/chunk/finish/abort RPCs"
```

---

### Task 7: Bridge 全量回归 + 类型检查

**Files:** 无新文件（验证任务）

**Step 1: 全量测试**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && npm test
```

预期：`Tests: 全部通过`（--forceExit 兜底）。若有失败，先修复再继续（修复也 commit）。

**Step 2: tsc 类型检查**

```
cd /d D:\code\mobile-agent-bridge\servers\bridge && npm run build
```

预期：无 TS 错误、生成 `dist/`（已被 .gitignore 排除，不 commit dist）。

**Step 3: 确认 git 状态**

```
git status --short
```

预期：无未预期改动（dist 不出现）。若有修复则 commit。

---

### Task 8: 安装 `@react-native-documents/picker` + jest mock

**Files:**
- Modify: `apps/mobile/package.json`（pnpm 自动）
- Modify: `pnpm-lock.yaml`（pnpm 自动，根目录）
- Create: `apps/mobile/__mocks__/@react-native-documents/picker.js`
- Modify: `apps/mobile/jest.config.js`（moduleNameMapper 追加一行）

**Step 1: 安装依赖**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && pnpm add @react-native-documents/picker@10.1.7
```

预期：安装成功；`pnpm-lock.yaml` 更新。（网络可用，npm registry 已验证 v10.1.7 存在且 peer `react-native: '*'`。）

**Step 2: 验证 picker API 面（设计降级决策点）**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && dir /s /b node_modules\@react-native-documents\picker\*.d.ts
```

对生成的主 d.ts 执行：

```
findstr /c:"copyTo" /c:"allowMultiSelection" /c:"declare function pick" node_modules\@react-native-documents\picker\<主 d.ts 路径>
```

预期：能找到 `pick`、`allowMultiSelection`、`copyTo`。若 `copyTo` 不存在，改用包导出的缓存拷贝 helper（`findstr /c:"cache" ...` 查找），并同步修改 Task 12 的 pick 调用——记录实际 API 到 commit message。若整个 API 与预期不符（如只有 default export），停止并回报。

**Step 3: 写 jest mock（无测试先行——这是测试基础设施）**

Create `apps/mobile/__mocks__/@react-native-documents/picker.js`：

```js
/**
 * Mock for @react-native-documents/picker — jest moduleNameMapper 映射到此。
 * 默认模拟"选中一个 11 字节的 hello.txt"；测试内可 mockResolvedValueOnce 覆盖。
 */
module.exports = {
  __esModule: true,
  pick: jest.fn().mockResolvedValue([
    { uri: "file:///mock/cache/hello.txt", name: "hello.txt", size: 11, mimeType: "text/plain" },
  ]),
  types: {
    allFiles: "public.all-content",
    images: "public.image",
  },
  copyToCacheDir: jest.fn((uri) => uri),
}
```

**Step 4: jest.config.js 注册映射**

`apps/mobile/jest.config.js` 的 `moduleNameMapper` 中，`'^react-native-webview$'` 行之后追加：

```js
    '^react-native-webview$': '<rootDir>/__mocks__/react-native-webview.js',
    '^@react-native-documents/picker$': '<rootDir>/__mocks__/@react-native-documents/picker.js',
```

（注意该文件首行有 BOM，用 edit 精确替换行，不要重写整个文件。）

**Step 5: 验证现有 mobile 测试不被破坏**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest fileStore.test.ts FileBrowserScreen.test.tsx
```

预期：全过（映射只影响 import 该包的模块，目前还没有）。

**Step 6: Commit**

```
git add apps/mobile/package.json apps/mobile/__mocks__ apps/mobile/jest.config.js pnpm-lock.yaml
git commit -m "feat(mobile): add @react-native-documents/picker@10.1.7 + jest mock"
```

（若根 `package-lock.json` 也被改动——不要 add，它属于遗留 npm 文件。）

---

### Task 9: `BridgeClient` 4 个上传传输方法

**Files:**
- Modify: `apps/mobile/src/services/BridgeClient.ts`（`getFileInfo` 方法之后、类结束 `}` 之前）
- Test: `apps/mobile/__tests__/BridgeClient.test.ts`（`describe('file operations')` 内追加）

**Step 1: 写失败测试**

`BridgeClient.test.ts` 的 `describe('file operations')` 内（searchFiles 测试之后）追加：

```ts
  it('uploadBegin calls file.upload.begin RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.uploadBegin({ dir: '/home', name: 'a.txt', size: 11 })
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.upload.begin')
    expect(sentFrame.params).toEqual({
      dir: '/home', name: 'a.txt', size: 11, encoding: 'base64', overwrite: false,
    })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: { uploadId: 'u1', chunkSize: 262144 } })
    await expect(callPromise).resolves.toEqual({ uploadId: 'u1', chunkSize: 262144 })
  })

  it('uploadBegin passes overwrite=true', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.uploadBegin({ dir: '/home', name: 'a.txt', size: 11, overwrite: true })
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.params.overwrite).toBe(true)

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: { uploadId: 'u1', chunkSize: 262144 } })
    await callPromise
  })

  it('uploadChunk calls file.upload.chunk RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.uploadChunk('u1', 0, 'aGVsbG8=')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.upload.chunk')
    expect(sentFrame.params).toEqual({ uploadId: 'u1', index: 0, data: 'aGVsbG8=' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: { received: 5, total: 11 } })
    await expect(callPromise).resolves.toEqual({ received: 5, total: 11 })
  })

  it('uploadFinish calls file.upload.finish RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.uploadFinish('u1')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.upload.finish')
    expect(sentFrame.params).toEqual({ uploadId: 'u1' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: { path: '/home/a.txt', size: 11 } })
    await expect(callPromise).resolves.toEqual({ path: '/home/a.txt', size: 11 })
  })

  it('uploadAbort calls file.upload.abort RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.uploadAbort('u1')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.upload.abort')
    expect(sentFrame.params).toEqual({ uploadId: 'u1' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: { ok: true } })
    await expect(callPromise).resolves.toEqual({ ok: true })
  })
```

（`makeClient`/`getWs` 是该测试文件既有 helper，与 listFiles 测试同模式；若 send.mock.calls 下标因连接帧偏移，对照 listFiles 测试的下标修正。）

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest BridgeClient.test.ts
```

预期：FAIL — `c.uploadBegin is not a function`（或 TS 错误）。

**Step 3: 最小实现**

`BridgeClient.ts` 的 `getFileInfo` 方法之后、类结束 `}` 之前追加：

```ts
  // ─── 分块上传（file.upload.*，服务端 4 步协议） ────────

  async uploadBegin(params: {
    dir: string
    name: string
    size: number
    overwrite?: boolean
  }): Promise<{ uploadId: string; chunkSize: number }> {
    return this.call('file.upload.begin', {
      dir: params.dir,
      name: params.name,
      size: params.size,
      encoding: 'base64',
      overwrite: params.overwrite ?? false,
    })
  }

  async uploadChunk(
    uploadId: string,
    index: number,
    data: string,
  ): Promise<{ received: number; total: number }> {
    return this.call('file.upload.chunk', { uploadId, index, data })
  }

  async uploadFinish(uploadId: string): Promise<{ path: string; size: number }> {
    return this.call('file.upload.finish', { uploadId })
  }

  async uploadAbort(uploadId: string): Promise<{ ok: boolean }> {
    return this.call('file.upload.abort', { uploadId })
  }
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS。

**Step 5: Commit**

```
git add apps/mobile/src/services/BridgeClient.ts apps/mobile/__tests__/BridgeClient.test.ts
git commit -m "feat(mobile): BridgeClient uploadBegin/uploadChunk/uploadFinish/uploadAbort RPCs"
```

---

### Task 10: `services/uploadFile.ts` 编排层

**Files:**
- Create: `apps/mobile/src/services/uploadFile.ts`
- Test: `apps/mobile/__tests__/uploadFile.test.ts`（新建）

**Step 1: 写失败测试**

Create `apps/mobile/__tests__/uploadFile.test.ts`：

```ts
/**
 * uploadFile — 分块上传编排层单元测试
 * 覆盖：chunk 切片、进度回调、onUploadId 回传、失败 abort、overwrite 透传。
 * 客户端以注入 fake（UploadClient）测试，读文件走 blob-util mock（readFile → base64）。
 */
import ReactNativeBlobUtil from 'react-native-blob-util'
import { uploadFile, base64ByteLength, UploadClient } from '../src/services/uploadFile'

function makeUploadClient(
  overrides: Partial<Record<keyof UploadClient, jest.Mock>> = {},
) {
  return {
    uploadBegin: jest.fn().mockResolvedValue({ uploadId: 'up1', chunkSize: 8 }),
    uploadChunk: jest.fn().mockResolvedValue({ received: 0, total: 0 }),
    uploadFinish: jest.fn().mockResolvedValue({ path: '/dir/hello.txt', size: 11 }),
    uploadAbort: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as UploadClient & Record<string, jest.Mock>
}

describe('base64ByteLength', () => {
  it('无 padding', () => {
    expect(base64ByteLength('YWJj')).toBe(3) // 'abc'
  })
  it('1 字节 padding', () => {
    expect(base64ByteLength('aGVsbG8=')).toBe(5) // 'hello'
  })
  it('2 字节 padding', () => {
    expect(base64ByteLength('YQ==')).toBe(1) // 'a'
  })
})

describe('uploadFile', () => {
  const B64 = Buffer.from('hello world').toString('base64') // 16 chars

  beforeEach(() => {
    ;(ReactNativeBlobUtil.fs.readFile as jest.Mock).mockResolvedValue(B64)
  })

  it('按服务端 chunkSize 切片并顺序上传（chunkSize=8 → 2 块）', async () => {
    const client = makeUploadClient()
    await uploadFile(client, 'file:///mock/cache/hello.txt', { dir: '/dir', name: 'hello.txt' })

    expect(client.uploadBegin).toHaveBeenCalledWith({
      dir: '/dir', name: 'hello.txt', size: 11, overwrite: false,
    })
    expect(client.uploadChunk).toHaveBeenCalledTimes(2)
    expect(client.uploadChunk).toHaveBeenNthCalledWith(1, 'up1', 0, B64.slice(0, 8))
    expect(client.uploadChunk).toHaveBeenNthCalledWith(2, 'up1', 1, B64.slice(8))
    expect(client.uploadFinish).toHaveBeenCalledWith('up1')
    expect(client.uploadAbort).not.toHaveBeenCalled()
  })

  it('onProgress 汇报 sent/total，onUploadId 回传 uploadId', async () => {
    const client = makeUploadClient()
    const progress: Array<{ name: string; sent: number; total: number }> = []
    let seenId: string | undefined

    const result = await uploadFile(client, 'file:///mock/cache/hello.txt', { dir: '/dir', name: 'hello.txt' }, {
      onProgress: (p) => progress.push(p),
      onUploadId: (id) => { seenId = id },
    })

    expect(seenId).toBe('up1')
    expect(progress).toHaveLength(2)
    expect(progress[0].sent).toBe(8)
    expect(progress[1]).toEqual({ name: 'hello.txt', sent: 16, total: 16 })
    expect(result).toEqual({ path: '/dir/hello.txt', size: 11 })
  })

  it('chunk 失败时 abort 后重抛原错误', async () => {
    const client = makeUploadClient({
      uploadChunk: jest.fn().mockRejectedValue(new Error('boom')),
    })
    await expect(
      uploadFile(client, 'file:///x', { dir: '/d', name: 'x' }),
    ).rejects.toThrow('boom')
    expect(client.uploadAbort).toHaveBeenCalledWith('up1')
    expect(client.uploadFinish).not.toHaveBeenCalled()
  })

  it('begin 失败时不调用 abort（会话未建立）', async () => {
    const client = makeUploadClient({
      uploadBegin: jest.fn().mockRejectedValue(new Error('EEXIST: already exists')),
    })
    await expect(
      uploadFile(client, 'file:///x', { dir: '/d', name: 'x' }, { overwrite: true }),
    ).rejects.toThrow('EEXIST')
    expect(client.uploadAbort).not.toHaveBeenCalled()
  })

  it('overwrite 透传给 uploadBegin', async () => {
    const client = makeUploadClient()
    await uploadFile(client, 'file:///x', { dir: '/d', name: 'x' }, { overwrite: true })
    expect(client.uploadBegin).toHaveBeenCalledWith({
      dir: '/d', name: 'x', size: 11, overwrite: true,
    })
  })

  it('空文件（base64 为空串）直接 begin→finish，无 chunk', async () => {
    ;(ReactNativeBlobUtil.fs.readFile as jest.Mock).mockResolvedValue('')
    const client = makeUploadClient()
    await uploadFile(client, 'file:///empty', { dir: '/d', name: 'empty.txt' })
    expect(client.uploadBegin).toHaveBeenCalledWith(expect.objectContaining({ size: 0 }))
    expect(client.uploadChunk).not.toHaveBeenCalled()
    expect(client.uploadFinish).toHaveBeenCalledWith('up1')
  })
})
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest uploadFile.test.ts
```

预期：FAIL — 找不到模块 `../src/services/uploadFile`（2307 被 ignore，实际报 runtime "Cannot find module" 或 TS 错误）。

**Step 3: 最小实现**

Create `apps/mobile/src/services/uploadFile.ts`：

```ts
/**
 * uploadFile — 分块上传编排层
 *
 * 流程：整读本地文件为 base64 → file.upload.begin（服务端返回 chunkSize）
 *       → 按 chunkSize 切片顺序单发 → finish。
 * 传输层（BridgeClient）通过参数注入，便于单测。
 *
 * 内存说明：react-native-blob-util 无范围读 API（已验证 index.d.ts 只有
 * readFile/readStream 且 readStream 不支持 offset/length），故整读切片；
 * 默认 5MB 上限（BRIDGE_MAX_UPLOAD_BYTES）下 base64 ≈ 6.7MB，内存可控。
 * chunkSize 必须是 4 的倍数（服务端 UPLOAD_CHUNK_SIZE_CHARS 保证），
 * 切片边界才落在 base64 组边界上，每块可独立解码。
 */
import ReactNativeBlobUtil from 'react-native-blob-util'

export interface UploadTarget {
  dir: string
  name: string
}

export interface UploadProgress {
  name: string
  sent: number
  total: number
}

export interface UploadClient {
  uploadBegin(params: {
    dir: string
    name: string
    size: number
    overwrite?: boolean
  }): Promise<{ uploadId: string; chunkSize: number }>
  uploadChunk(uploadId: string, index: number, data: string): Promise<{ received: number; total: number }>
  uploadFinish(uploadId: string): Promise<{ path: string; size: number }>
  uploadAbort(uploadId: string): Promise<{ ok: boolean }>
}

export interface UploadOptions {
  overwrite?: boolean
  onProgress?: (p: UploadProgress) => void
  /** 回传 uploadId，供 UI 取消按钮调用 uploadAbort */
  onUploadId?: (uploadId: string) => void
}

/** base64 字符串 → 解码后字节数（处理 '==' / '=' padding） */
export function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

export async function uploadFile(
  client: UploadClient,
  localUri: string,
  target: UploadTarget,
  opts: UploadOptions = {},
): Promise<{ path: string; size: number }> {
  const b64: string = await ReactNativeBlobUtil.fs.readFile(localUri, 'base64')
  const size = base64ByteLength(b64)

  const { uploadId, chunkSize } = await client.uploadBegin({
    dir: target.dir,
    name: target.name,
    size,
    overwrite: opts.overwrite ?? false,
  })
  opts.onUploadId?.(uploadId)

  try {
    let index = 0
    for (let i = 0; i < b64.length; i += chunkSize) {
      const chunk = b64.slice(i, i + chunkSize)
      await client.uploadChunk(uploadId, index, chunk) // 顺序单发：等 ack 再发下一块
      index += 1
      opts.onProgress?.({
        name: target.name,
        sent: Math.min(i + chunkSize, b64.length),
        total: b64.length,
      })
    }
    return await client.uploadFinish(uploadId)
  } catch (err) {
    // 任何中途失败：尽力清理服务端会话（abort 幂等），再重抛原错误
    await client.uploadAbort(uploadId).catch(() => {})
    throw err
  }
}
```

**Step 4: 跑测试确认通过**

同上命令。预期：PASS（含 2 个 describe、10 个用例）。

**Step 5: Commit**

```
git add apps/mobile/src/services/uploadFile.ts apps/mobile/__tests__/uploadFile.test.ts
git commit -m "feat(mobile): uploadFile orchestration — base64 slice, ordered chunks, abort on failure"
```

---

### Task 11: `fileStore.uploadProgress` + `test-utils` MockClient 扩展

**Files:**
- Modify: `apps/mobile/src/stores/fileStore.ts`（import + interface + initialState + store 实现）
- Test: `apps/mobile/__tests__/fileStore.test.ts`（追加用例）
- Modify: `apps/mobile/__tests__/test-utils.tsx`（MockClient interface + factory）

**Step 1: 写失败测试**

`fileStore.test.ts` 文件末尾（外层 describe 内）追加：

```ts
  it('should have null uploadProgress initially', () => {
    expect(useFileStore.getState().uploadProgress).toBeNull()
  })

  it('should set and clear uploadProgress', () => {
    useFileStore.getState().setUploadProgress({ name: 'a.txt', sent: 10, total: 100 })
    expect(useFileStore.getState().uploadProgress).toEqual({ name: 'a.txt', sent: 10, total: 100 })
    useFileStore.getState().setUploadProgress(null)
    expect(useFileStore.getState().uploadProgress).toBeNull()
  })

  it('reset clears uploadProgress', () => {
    useFileStore.getState().setUploadProgress({ name: 'a.txt', sent: 1, total: 2 })
    useFileStore.getState().reset()
    expect(useFileStore.getState().uploadProgress).toBeNull()
  })
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest fileStore.test.ts
```

预期：FAIL — `state.uploadProgress` 为 undefined / `setUploadProgress is not a function`。

**Step 3: 最小实现**

`fileStore.ts`：

1) 顶部 import 之后追加：

```ts
import type { UploadProgress } from '../services/uploadFile'
```

2) `FileState` interface 中 `htmlPreviewSource: boolean` 之后、`setCurrentPath` 之前追加：

```ts
  /** 上传进度（非 null 即显示进度条） */
  uploadProgress: UploadProgress | null
```

方法区（`toggleHtmlPreviewSource` 之后）追加：

```ts
  /** 更新上传进度（null = 清除） */
  setUploadProgress: (p: UploadProgress | null) => void
```

3) `initialState` 对象中 `htmlPreviewSource: false,` 之后追加：

```ts
  uploadProgress: null,
```

4) store 实现 `toggleHtmlPreviewSource: ...` 之后追加：

```ts
  setUploadProgress: (p) => set({ uploadProgress: p }),
```

（`reset: () => set(initialState)` 已自动覆盖 uploadProgress 清空。）

**Step 4: 跑测试确认通过**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest fileStore.test.ts
```

预期：PASS。

**Step 5: 扩展 test-utils MockClient（Task 12 的前置）**

`test-utils.tsx`：

MockClient interface 中 `searchFiles: jest.Mock` 之后追加：

```ts
  uploadBegin: jest.Mock
  uploadChunk: jest.Mock
  uploadFinish: jest.Mock
  uploadAbort: jest.Mock
  getFileInfo: jest.Mock
```

factory 返回对象中 `searchFiles: ...` 之后追加：

```ts
    uploadBegin: jest.fn().mockResolvedValue({ uploadId: 'mock_up1', chunkSize: 262144 }),
    uploadChunk: jest.fn().mockResolvedValue({ received: 11, total: 11 }),
    uploadFinish: jest.fn().mockResolvedValue({ path: '/mock/hello.txt', size: 11 }),
    uploadAbort: jest.fn().mockResolvedValue({ ok: true }),
    // 默认"目标不存在"（撞名检测走 catch 分支），撞名测试内覆写
    getFileInfo: jest.fn().mockRejectedValue(new Error('ENOENT: not found')),
```

**Step 6: 跑相关测试确认不破坏**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest fileStore.test.ts FileBrowserScreen.test.tsx
```

预期：全过。

**Step 7: Commit**

```
git add apps/mobile/src/stores/fileStore.ts apps/mobile/__tests__/fileStore.test.ts apps/mobile/__tests__/test-utils.tsx
git commit -m "feat(mobile): fileStore.uploadProgress state + MockClient upload/getFileInfo mocks"
```

---

### Task 12: `FileBrowserScreen` 上传 UI 与流程

**Files:**
- Modify: `apps/mobile/src/screens/FileBrowserScreen.tsx`（import、store 解构、handlers、header JSX、progress JSX、styles）
- Test: `apps/mobile/__tests__/FileBrowserScreen.test.tsx`（文件末尾追加 describe）

**Step 1: 写失败测试**

`FileBrowserScreen.test.tsx` 文件末尾追加：

```tsx
// ─── 上传（file.upload.*） ──────────────────────────────

describe('FileBrowserScreen — upload', () => {
  const { pick } = require('@react-native-documents/picker')

  beforeEach(() => {
    ;(Alert.alert as jest.Mock).mockClear()
    ;(pick as jest.Mock).mockClear()
    ;(pick as jest.Mock).mockResolvedValue([
      { uri: 'file:///mock/cache/hello.txt', name: 'hello.txt', size: 11 },
    ])
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

  it('upload button opens system picker', async () => {
    const client = mockClient({ 'file.list': () => [] })
    const tree = renderWith(client as any)
    await act(async () => {})
    const btn = findBtn(tree, '⬆ Upload')
    expect(btn).toBeTruthy()
    await act(async () => { await btn!.props.onPress() })
    expect(pick).toHaveBeenCalled()
  })

  it('picker cancel (rejection) is silent — no upload, no alert', async () => {
    ;(pick as jest.Mock).mockRejectedValueOnce(new Error('canceled'))
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
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })

    const alert = lastAlert()
    expect(alert?.[0]).toBe('文件已存在')
    expect(alert?.[1]).toContain('hello.txt')
    const overwriteBtn = alert![2].find((b: any) => b.text === '覆盖')
    expect(overwriteBtn).toBeTruthy()
    await act(async () => { overwriteBtn.onPress() })

    expect(client.uploadBegin).toHaveBeenCalledWith(expect.objectContaining({ overwrite: true }))
  })

  it('collision → rename choice picks next free name "hello (1).txt"', async () => {
    const client = mockClient({ 'file.list': () => [] })
    client.getFileInfo = jest.fn()
      .mockResolvedValueOnce({ name: 'hello.txt', type: 'file', size: 11, modified: '', permissions: '' })
      .mockRejectedValueOnce(new Error('ENOENT')) // hello (1).txt 空闲
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })

    const alert = lastAlert()
    const renameBtn = alert![2].find((b: any) => b.text === '改名')
    expect(renameBtn).toBeTruthy()
    await act(async () => { renameBtn.onPress() })

    expect(client.uploadBegin).toHaveBeenCalledWith(expect.objectContaining({ name: 'hello (1).txt' }))
  })

  it('collision → cancel aborts upload entirely', async () => {
    const client = mockClient({ 'file.list': () => [] })
    client.getFileInfo = jest.fn().mockResolvedValue({
      name: 'hello.txt', type: 'file', size: 11, modified: '', permissions: '',
    })
    const tree = renderWith(client as any, '/test/dir')
    await act(async () => {})
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })

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
    await act(async () => { await findBtn(tree, '⬆ Upload')!.props.onPress() })

    expect(useFileStore.getState().uploadProgress).not.toBeNull()
    const cancelBtn = findBtn(tree, '✕')
    expect(cancelBtn).toBeTruthy()
    await act(async () => { await cancelBtn!.props.onPress() })
    expect(client.uploadAbort).toHaveBeenCalledWith('mock_up1')
  })
})
```

**Step 2: 跑测试确认失败**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest FileBrowserScreen.test.tsx
```

预期：FAIL — 找不到 '⬆ Upload' 按钮等。

**Step 3: 实现**

`FileBrowserScreen.tsx`：

1) import 区追加：

```ts
import { pick, types } from '@react-native-documents/picker'
import { uploadFile } from '../services/uploadFile'
```

2) `useFileStore` 解构中追加 `uploadProgress`、`setUploadProgress`：

```ts
  const {
    currentPath,
    files,
    searchResults,
    searchQuery,
    loading,
    error,
    uploadProgress,
    setCurrentPath,
    setFiles,
    setSearchResults,
    setSearchQuery,
    setLoading,
    setError,
    setUploadProgress,
    goUp,
    enterDirectory,
  } = useFileStore()
```

3) 组件内 `const [fileInfoTarget, setFileInfoTarget] = useState<FileInfo | null>(null)` 之后追加：

```tsx
  const uploadIdRef = useRef<string | null>(null)
  const cancelRef = useRef(false)
```

4) `handleSearch` 之后追加三个 handler：

```tsx
  /** 算出下一个空闲重名：foo.txt → foo (1).txt → foo (2).txt ... */
  const pickUniqueName = async (dir: string, name: string): Promise<string> => {
    if (!client) return name
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    const base = dir.replace(/\/+$/, '')
    for (let i = 1; i < 100; i++) {
      const candidate = `${stem} (${i})${ext}`
      const exists = await client
        .getFileInfo(`${base}/${candidate}`)
        .then(() => true, () => false)
      if (!exists) return candidate
    }
    return `${stem} (${Date.now()})${ext}`
  }

  /** 执行上传：进度走 fileStore，失败 Alert（错误消息含服务端真实 limit） */
  const startUpload = async (uri: string, name: string, overwrite: boolean, uploadDir: string) => {
    if (!client) return
    cancelRef.current = false
    setUploadProgress({ name, sent: 0, total: 0 })
    try {
      const result = await uploadFile(client, uri, { dir: uploadDir, name }, {
        overwrite,
        onUploadId: (id) => { uploadIdRef.current = id },
        onProgress: setUploadProgress,
      })
      if (!cancelRef.current) {
        Alert.alert('上传成功', `${result.path}（${formatSize(result.size)}）`)
        loadDirectory(uploadDir) // 刷新发起时目录（非 currentPath，防中途导航）
      }
    } catch (err: unknown) {
      if (!cancelRef.current) {
        const msg = err instanceof Error ? err.message : String(err)
        Alert.alert('上传失败', msg)
      }
    } finally {
      uploadIdRef.current = null
      setUploadProgress(null)
    }
  }

  /** 上传入口：系统选择器 → 撞名三选 → startUpload */
  const handleUpload = async () => {
    if (!client) return
    const uploadDir = currentPath // 发起时路径为准

    let picked: { uri?: string; name?: string } | undefined
    try {
      const res = await pick({
        type: [types.allFiles],
        allowMultiSelection: false,
        copyTo: 'cachesDirectory',
      })
      picked = Array.isArray(res) ? res[0] : undefined
    } catch {
      return // 用户取消选择器
    }
    if (!picked?.uri || !picked.name) return

    let name = picked.name
    let overwrite = false
    const base = uploadDir.replace(/\/+$/, '')
    const targetPath = `${base}/${name}`
    const exists = await client.getFileInfo(targetPath).then(() => true, () => false)
    if (exists) {
      const choice = await new Promise<'overwrite' | 'rename' | 'cancel'>((resolve) => {
        Alert.alert('文件已存在', `${name} 已存在，如何处理？`, [
          { text: '覆盖', onPress: () => resolve('overwrite') },
          { text: '改名', onPress: () => resolve('rename') },
          { text: '取消', style: 'cancel', onPress: () => resolve('cancel') },
        ])
      })
      if (choice === 'cancel') return
      if (choice === 'overwrite') overwrite = true
      else name = await pickUniqueName(uploadDir, name)
    }

    await startUpload(picked.uri, name, overwrite, uploadDir)
  }

  /** 取消上传：通知服务端删临时文件；在途 chunk 会因会话消失而失败（cancelRef 静默） */
  const handleCancelUpload = async () => {
    cancelRef.current = true
    const id = uploadIdRef.current
    if (id && client) {
      try { await client.uploadAbort(id) } catch { /* 幂等，忽略 */ }
    }
  }
```

5) header JSX：`<Text style={styles.title} ...>{currentPath}</Text>` 之后（`</View>` 之前）追加按钮，header 下方插入进度条：

```tsx
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {currentPath}
        </Text>
        <TouchableOpacity
          style={styles.uploadButton}
          onPress={handleUpload}
          disabled={!!uploadProgress}
        >
          <Text style={styles.uploadButtonText}>⬆ Upload</Text>
        </TouchableOpacity>
      </View>

      {uploadProgress && (
        <View style={styles.progressRow}>
          <Text style={styles.progressText} numberOfLines={1}>
            {uploadProgress.name}{' '}
            {uploadProgress.total > 0
              ? Math.min(100, Math.round((uploadProgress.sent / uploadProgress.total) * 100))
              : 0}%
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${
                    uploadProgress.total > 0
                      ? Math.min(100, (uploadProgress.sent / uploadProgress.total) * 100)
                      : 0
                  }%`,
                },
              ]}
            />
          </View>
          <TouchableOpacity style={styles.progressCancel} onPress={handleCancelUpload}>
            <Text style={styles.progressCancelText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
```

6) `makeStyles` 中追加样式：

```ts
  uploadButton: {
    marginLeft: 8,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  uploadButtonText: {
    color: colors.textOnPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  progressText: {
    color: colors.text,
    fontSize: 12,
    minWidth: 90,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceVariant,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  progressCancel: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  progressCancelText: {
    color: colors.textTertiary,
    fontSize: 16,
  },
```

**Step 4: 跑测试确认通过**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest FileBrowserScreen.test.tsx
```

预期：PASS（既有 + 新增 upload describe 全过）。

若 `copyTo: 'cachesDirectory'` 的 TS 类型报错（Task 8 Step 2 的 API 面差异），按实际 d.ts 类型修正 pick 调用参数并保持行为（选中文件必须可被 blob-util 读到本地路径）。

**Step 5: Commit**

```
git add apps/mobile/src/screens/FileBrowserScreen.tsx apps/mobile/__tests__/FileBrowserScreen.test.tsx
git commit -m "feat(mobile): Files tab upload — picker, collision 3-way choice, progress bar, cancel"
```

---

### Task 13: E2E — mock-bridge 响应 + `test-new-rpcs.mjs` 覆盖 `file.upload.*`

**Files:**
- Modify: `scripts/e2e/mock-bridge.mjs`（MOCK_PAYLOADS 的 `"file.info"` 条目之后）
- Modify: `scripts/e2e/test-new-rpcs.mjs`（session.children 测试段之后、清理段之前）

**Step 1: 写"失败"测试（E2E 脚本断言）**

`test-new-rpcs.mjs` 中 `// 9. 清理` 之前插入：

```js
    // 9. 测试 file.upload.*（分块上传 4 步协议）
    console.log("\n── file.upload.* ──")
    const up = await call("file.upload.begin", { dir: "/mock-project", name: "hello.txt", size: 11 })
    assert(typeof up?.uploadId === "string" && up.uploadId.length > 0, "begin 返回 uploadId")
    assert(Number.isInteger(up?.chunkSize) && up.chunkSize % 4 === 0, "begin 返回 4 的倍数 chunkSize")

    const upChunk = await call("file.upload.chunk", { uploadId: up.uploadId, index: 0, data: "aGVsbG8gd29ybGQ=" })
    assert(upChunk?.total === 11, "chunk 返回 total 进度")

    const upDone = await call("file.upload.finish", { uploadId: up.uploadId })
    assert(typeof upDone?.path === "string" && upDone?.size === 11, "finish 返回 path/size")

    const upAbort = await call("file.upload.abort", { uploadId: "whatever" })
    assert(upAbort?.ok === true, "abort 返回 ok 幂等")
```

把原 `// 9. 清理` 注释改为 `// 10. 清理`（仅注释，可选）。

**Step 2: 跑 E2E 确认失败**

```
cd /d D:\code\mobile-agent-bridge && node scripts\e2e\test-new-rpcs.mjs
```

预期：exit 1 — `begin 返回 uploadId` 失败（mock 走 getDefaultPayload → `{files:[],path:'/mock'}`，无 uploadId）。

**Step 3: mock-bridge 补响应**

`mock-bridge.mjs` 的 `"file.info"` 条目之后（MOCK_PAYLOADS 对象内）追加：

```js
  "file.upload.begin": { uploadId: "mock_up1", chunkSize: 262144 },
  "file.upload.chunk": { received: 11, total: 11 },
  "file.upload.finish": { path: "/mock-project/hello.txt", size: 11 },
  "file.upload.abort": { ok: true },
```

**Step 4: 跑 E2E 确认通过**

```
cd /d D:\code\mobile-agent-bridge && node scripts\e2e\test-new-rpcs.mjs
```

预期：`结果: N 通过, 0 失败`、exit 0（N ≥ 旧用例数 + 5）。

**Step 5: Commit**

```
git add scripts/e2e/mock-bridge.mjs scripts/e2e/test-new-rpcs.mjs
git commit -m "test(e2e): cover file.upload.* RPCs in mock-bridge + test-new-rpcs"
```

---

### Task 14: Mobile 全量回归

**Files:** 无新文件（验证任务）

**Step 1: 全量单测**

```
cd /d D:\code\mobile-agent-bridge\apps\mobile && npx jest
```

预期：所有测试文件 PASS。若 MainLayout/AppProvider 等引用 fileStore 的测试因新字段失败，修复（通常 initialState 变化不影响）并 commit。

**Step 2: git 状态检查（无杂散文件）**

```
git status --short
```

预期：只剩既有的 `.maestro/flows/tmp-rollback-smoke.yaml`（untracked，不处理）；无根目录 .log/.xml/.png 散落。

---

### Task 15: JS Bundle 重新生成 + APK 构建（新原生依赖落地）

**Files:**
- Update: `apps/mobile/android/app/src/main/assets/index.android.bundle`（构建产物，是否入库按 .gitignore 现状——先查 `git check-ignore`，被忽略则不 add）
- Create: `logs/build/bundle.done`、`logs/build/apk.done`（轮询哨兵，logs/ 已忽略）

> ⚠️ 本 Task 全部 fire-and-forget + 短轮询，单条命令 ≤15s，禁止同步长跑（AGENTS.md 核心原则）。

**Step 1: 后台重新打包 JS bundle（哨兵文件判完成，规避日志文件锁）**

```cmd
cd /d D:\code\mobile-agent-bridge\apps\mobile && del /q D:\code\mobile-agent-bridge\logs\build\bundle.done 2>nul & start "" /b cmd /c "npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output android\app\src\main\assets\index.android.bundle --reset-cache > D:\code\mobile-agent-bridge\logs\build\bundle.log 2>&1 & echo done > D:\code\mobile-agent-bridge\logs\build\bundle.done"
```

（若 `start /b` 在本机不脱离进程树导致工具不返回，改用 AGENTS 认可的 `Start-Process -WindowStyle Hidden -FilePath cmd -ArgumentList '/c ...'` 形式，命令链不变，只是外层包 PowerShell。）

**Step 2: 短轮询哨兵（≤15s/条，可重复数次，禁止 sleep）**

```cmd
dir /b D:\code\mobile-agent-bridge\logs\build\bundle.done 2>nul
```

预期：出现 `bundle.done`。若打包失败（`bundle.log` 尾部为 Metro 错误），修复后重跑 Step 1。

**Step 3: 后台构建 debug APK（AGENTS 构建配方 + 哨兵）**

```cmd
cd /d D:\code\mobile-agent-bridge\apps\mobile\android && del /q D:\code\mobile-agent-bridge\logs\build\apk.done 2>nul & start "" /b cmd /c "taskkill /f /im java.exe >nul 2>&1 & set GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false& .\gradlew assembleDebug --no-daemon --offline > D:\code\mobile-agent-bridge\logs\build\apk-debug.log 2>&1 & echo done > D:\code\mobile-agent-bridge\logs\build\apk.done"
```

注意：
- `--offline` 若因新依赖 `@react-native-documents/picker` 缺少本地缓存而失败，去掉 `--offline` 重跑（联网拉取一次后恢复）。
- 哨兵轮询同 Step 2（`logs\build\apk.done`），每轮 ≤15s，重复直到出现。
- 构建完成后验证 APK 存在：

```cmd
dir /b D:\code\mobile-agent-bridge\apps\mobile\android\app\build\outputs\apk\debug\*.apk
```

预期：`app-debug.apk`。失败则读 `logs\build\apk-debug.log` 尾部排障（用 `copy` 出副本再 `type`，避免读被占用的日志）。

**Step 4: 验证新原生模块进包**

```cmd
findstr /c:"react-native-documents" D:\code\mobile-agent-bridge\apps\mobile\android\app\build\outputs\apk\debug\output-metadata.json 2>nul & dir /s /b D:\code\mobile-agent-bridge\apps\mobile\android\app\build\intermediates\merged_native_libs 2>nul | findstr /i "documents"
```

（辅助验证；核心判据是 gradle 构建成功且 autolink 打印中包含 `@react-native-documents/picker`——从 apk-debug.log `findstr /i "documents" D:\code\mobile-agent-bridge\logs\build\apk-debug.log`。）

**Step 5: 收尾 commit / 状态检查**

```cmd
git status --short
```

- 若 `index.android.bundle` 未被 .gitignore 忽略且仓库惯例是入库的（`git log --oneline -3 -- apps/mobile/android/app/src/main/assets/index.android.bundle` 查历史），则：

```
git add apps/mobile/android/app/src/main/assets/index.android.bundle
git commit -m "chore(mobile): regenerate android JS bundle with upload feature"
```

- `logs/build/*` 不 add（logs/ 在 .gitignore）。
- 确认根目录无 `.log`/`.xml`/`.png` 散落。

---

## 完成判据（全部满足才算完成）

1. `cd servers/bridge && npm test` 全过；`npm run build` 无类型错误。
2. `cd apps/mobile && npx jest` 全过。
3. `node scripts/e2e/test-new-rpcs.mjs` exit 0、`file.upload.*` 5 项断言通过。
4. APK 构建成功且包含 `@react-native-documents/picker`。
5. 协议两侧对齐保障齐备：服务端 `router.test.ts`（方法名/参数名/roundtrip）+ 客户端 `BridgeClient.test.ts` / `FileBrowserScreen.test.tsx`。
6. `git status` 无杂散文件，杂散的 `.maestro/flows/tmp-rollback-smoke.yaml` 未被误提交。
