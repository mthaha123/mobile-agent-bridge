import fs from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = resolve(__dirname, "..", ".data", "session-titles.json")

// 重新加载模块以隔离文件状态
const mod = await import("../src/state/sessionTitles.js")
const { recordUserMessage, setTitle, getTitle, applyTitle, applyTitles } = mod

beforeEach(() => {
  // 清理持久化文件，保证测试隔离
  try { fs.unlinkSync(DATA_FILE) } catch {}
})

afterEach(() => {
  try { fs.unlinkSync(DATA_FILE) } catch {}
})

describe("sessionTitles", () => {
  it("recordUserMessage derives a title from first message and persists", () => {
    recordUserMessage("ses_aaa", "Analyze the MTOS bootloader source code and explain the build process")
    expect(getTitle("ses_aaa")).toBe("Analyze the MTOS bootloader...")

    // 已持久化
    expect(fs.existsSync(DATA_FILE)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"))
    expect(saved["ses_aaa"]).toBe("Analyze the MTOS bootloader...")
  })

  it("does not overwrite an existing title", () => {
    setTitle("ses_bbb", "Custom title")
    recordUserMessage("ses_bbb", "Another message")
    expect(getTitle("ses_bbb")).toBe("Custom title")
  })

  it("truncates long titles to 30 chars", () => {
    recordUserMessage("ses_ccc", "x".repeat(100))
    expect(getTitle("ses_ccc")!.length).toBe(30)
    expect(getTitle("ses_ccc")).toBe("x".repeat(27) + "...")
  })

  it("setTitle persists custom title", () => {
    setTitle("ses_ddd", "My project analysis")
    expect(getTitle("ses_ddd")).toBe("My project analysis")
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"))
    expect(saved["ses_ddd"]).toBe("My project analysis")
  })

  it("applyTitle overrides default 'New session - timestamp' title", () => {
    recordUserMessage("ses_eee", "Fix the login bug")
    const result = applyTitle({ id: "ses_eee", title: "New session - 2026-08-07T12:00:00.000Z" })
    expect(result.title).toBe("Fix the login bug")
  })

  it("applyTitle keeps explicit (non-default) title unchanged", () => {
    setTitle("ses_fff", "Auto title")
    const result = applyTitle({ id: "ses_fff", title: "Explicit name" })
    expect(result.title).toBe("Explicit name")
  })

  it("applyTitle leaves session without mapping unchanged", () => {
    const result = applyTitle({ id: "ses_none", title: "New session - 2026-08-07T12:00:00.000Z" })
    expect(result.title).toBe("New session - 2026-08-07T12:00:00.000Z")
  })

  it("applyTitles maps an array of sessions", () => {
    recordUserMessage("ses_ggg", "Refactor the API layer")
    const list = applyTitles([
      { id: "ses_ggg", title: "New session - 2026-08-07T12:00:00.000Z" },
      { id: "ses_other", title: "Keep me" },
    ])
    expect(list[0].title).toBe("Refactor the API layer")
    expect(list[1].title).toBe("Keep me")
  })
})
