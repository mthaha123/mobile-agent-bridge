import * as fs from "fs/promises"
import * as path from "path"
import { fileURLToPath } from "url"
import { fileList, fileRead, fileSearch, getFileInfo, fileExists } from "../src/server/fileHandler"

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
})
