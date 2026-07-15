import * as fs from "fs/promises"
import * as path from "path"

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
  const content = await fs.readFile(resolved, { encoding: enc as BufferEncoding })

  return {
    content,
    encoding: enc,
    size: stat.size,
    path: resolved,
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
