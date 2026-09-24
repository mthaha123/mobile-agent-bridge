import * as fs from "fs/promises"
import * as path from "path"
import { fileURLToPath } from "url"
import {
  fileList, fileRead, fileSearch, getFileInfo, fileExists,
  uploadBegin, uploadChunk, uploadFinish, uploadAbort,
  _testGetUploads, sweepStaleUploads,
  UPLOAD_CHUNK_SIZE_CHARS, UPLOAD_TTL_MS,
} from "../src/server/fileHandler"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe("File Handler", () => {
  const testDir = path.join(__dirname, "test-files")
  const testFile = path.join(testDir, "test.txt")
  const testContent = "Hello, World!\nThis is a test file.\nLine 3: search pattern here."

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(testFile, testContent)

    const subDir = path.join(testDir, "subdir")
    await fs.mkdir(subDir, { recursive: true })
    await fs.writeFile(path.join(subDir, "nested.txt"), "Nested content with pattern.")

    // 测试图片文件（假 PNG 二进制）
    const pngFile = path.join(testDir, "test.png")
    await fs.writeFile(pngFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  describe("fileList", () => {
    it("should list files in directory", async () => {
      const files = await fileList(testDir)
      expect(files).toBeInstanceOf(Array)
      expect(files.length).toBeGreaterThanOrEqual(2)

      const names = files.map(f => f.name)
      expect(names).toContain("test.txt")
      expect(names).toContain("subdir")

      const testTxt = files.find(f => f.name === "test.txt")
      expect(testTxt).toBeDefined()
      expect(testTxt!.type).toBe("file")
      expect(testTxt!.size).toBeGreaterThan(0)
    })

    it("should sort directories before files", async () => {
      const files = await fileList(testDir)
      const dirIndex = files.findIndex(f => f.type === "directory")
      const fileIndex = files.findIndex(f => f.type === "file")
      if (dirIndex >= 0 && fileIndex >= 0) {
        expect(dirIndex).toBeLessThan(fileIndex)
      }
    })

    it("should handle non-existent directory", async () => {
      await expect(fileList("/nonexistent/path")).rejects.toThrow()
    })

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
  })

  describe("fileRead", () => {
    it("should read file content", async () => {
      const result = await fileRead(testFile)
      expect(result.content).toBe(testContent)
      expect(result.encoding).toBe("utf-8")
      expect(result.size).toBeGreaterThan(0)
      expect(result.path).toBe(path.resolve(testFile))
    })

    it("should throw for directory", async () => {
      await expect(fileRead(testDir)).rejects.toThrow("Cannot read directory as file")
    })

    it("should throw for non-existent file", async () => {
      await expect(fileRead("/nonexistent/file.txt")).rejects.toThrow()
    })

    it("should read image file as base64 when encoding=base64", async () => {
      const pngFile = path.join(testDir, "test.png")
      const result = await fileRead(pngFile, "base64")
      expect(result.base64).toBe(true)
      expect(result.encoding).toBe("base64")
      expect(result.mimeType).toBe("image/png")
      expect(result.content).toMatch(/^iVBORw0KGgo=/) // PNG 魔数 base64
    })

    it("should detect image mime type for utf-8 read", async () => {
      const pngFile = path.join(testDir, "test.png")
      const result = await fileRead(pngFile, "utf-8")
      expect(result.mimeType).toBe("image/png")
      expect(result.base64).toBe(false)
    })

    it("should return undefined mime for non-image file", async () => {
      const result = await fileRead(testFile)
      expect(result.mimeType).toBeUndefined()
      expect(result.base64).toBe(false)
    })
  })

  describe("fileSearch", () => {
    it("should search for pattern", async () => {
      const results = await fileSearch("pattern", { dirs: [testDir] })
      expect(results).toBeInstanceOf(Array)
      expect(results.length).toBeGreaterThanOrEqual(2)

      const files = results.map(r => r.file)
      expect(files.some(f => f.includes("test.txt"))).toBe(true)
      expect(files.some(f => f.includes("nested.txt"))).toBe(true)
    })

    it("should respect limit", async () => {
      const results = await fileSearch("pattern", { dirs: [testDir], limit: 1 })
      expect(results.length).toBeLessThanOrEqual(1)
    })

    it("should return line numbers", async () => {
      const results = await fileSearch("Line 3", { dirs: [testDir] })
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].line).toBe(3)
    })

    it("should handle no matches", async () => {
      const results = await fileSearch("nonexistent_pattern_xyz", { dirs: [testDir] })
      expect(results.length).toBe(0)
    })
  })

  describe("getFileInfo", () => {
    it("should get file info", async () => {
      const info = await getFileInfo(testFile)
      expect(info.name).toBe("test.txt")
      expect(info.type).toBe("file")
      expect(info.size).toBeGreaterThan(0)
      expect(info.modified).toBeTruthy()
    })

    it("should get directory info", async () => {
      const info = await getFileInfo(testDir)
      expect(info.type).toBe("directory")
    })
  })

  describe("fileExists", () => {
    it("should return true for existing file", async () => {
      const exists = await fileExists(testFile)
      expect(exists).toBe(true)
    })

    it("should return false for non-existent file", async () => {
      const exists = await fileExists("/nonexistent/file.txt")
      expect(exists).toBe(false)
    })
  })

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
})
