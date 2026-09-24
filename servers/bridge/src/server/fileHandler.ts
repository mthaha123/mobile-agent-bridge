import * as fs from "fs/promises"
import * as path from "path"
import { randomUUID } from "node:crypto"
import { resolveMaxUploadBytes } from "../config.js"

export interface FileInfo {
  name: string
  type: "file" | "directory" | "symlink"
  size: number
  modified: string
  permissions: string
}

export interface FileContent {
  content: string
  encoding: string
  size: number
  path: string
  /** 是否为二进制/base64（图片等） */
  base64?: boolean
  /** 文件 MIME 类型（图片预览用） */
  mimeType?: string
}

/** 常见图片 MIME 映射 */
const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".heic": "image/heic",
  ".avif": "image/avif",
}

/** 根据扩展名判断是否图片文件 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext in IMAGE_MIME
}

/** 获取文件 MIME 类型 */
export function mimeForPath(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  return IMAGE_MIME[ext]
}

export interface SearchResult {
  file: string
  line: number
  content: string
  match?: string
}

export async function fileList(dirPath: string): Promise<FileInfo[]> {
  const resolved = path.resolve(dirPath)
  const entries = await fs.readdir(resolved, { withFileTypes: true })
  const results: FileInfo[] = []

  for (const entry of entries) {
    try {
      const fullPath = path.join(resolved, entry.name)
      const stat = await fs.stat(fullPath)
      results.push({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
        size: stat.size,
        modified: stat.mtime.toISOString(),
        permissions: (stat.mode & 0o777).toString(8),
      })
    } catch {
      results.push({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        size: 0,
        modified: "",
        permissions: "",
      })
    }
  }

  results.sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1
    if (a.type !== "directory" && b.type === "directory") return 1
    return a.name.localeCompare(b.name)
  })

  return results
}

export async function fileRead(filePath: string, encoding?: string): Promise<FileContent> {
  const resolved = path.resolve(filePath)
  const stat = await fs.stat(resolved)

  if (stat.isDirectory()) {
    throw new Error("Cannot read directory as file")
  }

  const enc = encoding || "utf-8"

  // 二进制/图片读取：返回 base64，供前端预览/下载
  if (enc === "base64" || (enc === "binary" && isImageFile(resolved))) {
    const buf = await fs.readFile(resolved)
    return {
      content: buf.toString("base64"),
      encoding: "base64",
      size: stat.size,
      path: resolved,
      base64: true,
      mimeType: mimeForPath(resolved),
    }
  }

  const content = await fs.readFile(resolved, { encoding: enc as BufferEncoding })

  return {
    content,
    encoding: enc,
    size: stat.size,
    path: resolved,
    base64: false,
    mimeType: isImageFile(resolved) ? mimeForPath(resolved) : undefined,
  }
}

export async function fileSearch(
  query: string,
  options: { pattern?: string; dirs?: string[]; limit?: number } = {}
): Promise<SearchResult[]> {
  const { pattern, dirs = ["."], limit = 100 } = options
  const results: SearchResult[] = []

  const searchPattern = pattern || query
  const regex = new RegExp(searchPattern, "gi")

  for (const dir of dirs) {
    if (results.length >= limit) break
    await searchDirectory(dir, regex, results, limit)
  }

  return results.slice(0, limit)
}

async function searchDirectory(
  dir: string,
  regex: RegExp,
  results: SearchResult[],
  limit: number
): Promise<void> {
  if (results.length >= limit) return

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (results.length >= limit) return

      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue
      }

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await searchDirectory(fullPath, regex, results, limit)
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, "utf-8")
          const lines = content.split("\n")

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= limit) return
            const line = lines[i]
            if (regex.test(line)) {
              results.push({
                file: fullPath,
                line: i + 1,
                content: line.trim(),
                match: line.match(regex)?.[0],
              })
            }
            regex.lastIndex = 0
          }
        } catch {
          // Skip binary files or files that can't be read
        }
      }
    }
  } catch {
    // Skip directories that can't be read
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function getFileInfo(filePath: string): Promise<FileInfo> {
  const resolved = path.resolve(filePath)
  const stat = await fs.stat(resolved)
  const name = path.basename(resolved)

  return {
    name,
    type: stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "symlink" : "file",
    size: stat.size,
    modified: stat.mtime.toISOString(),
    permissions: (stat.mode & 0o777).toString(8),
  }
}

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
