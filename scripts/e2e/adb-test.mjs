#!/usr/bin/env node
/**
 * Mobile Agent Bridge — ADB E2E Test Utility
 *
 * Maestro-like API for Android emulator testing.
 * Uses `input motionevent DOWN/UP` for reliable touch injection.
 *
 * 用法:
 *   import { Maestro } from "./adb-test.mjs"
 *   const m = new Maestro()
 *   await m.tap(540, 1200)
 *   await m.assertVisible("Connect")
 */

import { spawn, execSync } from "node:child_process"
import { resolve as pathResolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = pathResolve(__dirname, "..", "..")

function adbPath() {
  const home = process.env.ANDROID_HOME ||
    pathResolve(process.env.LOCALAPPDATA || "C:\\Users\\MT\\AppData\\Local", "Android", "Sdk")
  return pathResolve(home, "platform-tools", "adb.exe")
}

const ADB = adbPath()
const PACKAGE = "com.mobileagentbridge"

function serialFlag() {
  const s = process.env.EMULATOR_SERIAL
  return s ? ["-s", s] : []
}

function run(args, opts = {}) {
  return new Promise((res, rej) => {
    const allArgs = serialFlag().concat(args)
    const child = spawn(ADB, allArgs, { stdio: ["ignore", "pipe", "pipe"], ...opts })
    let out = "", err = ""
    child.stdout.on("data", (c) => { out += c.toString() })
    child.stderr.on("data", (c) => { err += c.toString() })
    child.on("close", (code) => code === 0 ? res(out.trim()) : rej(new Error(err || out.trim())))
    child.on("error", rej)
  })
}

export class Maestro {
  constructor() {
    this._screenshotDir = pathResolve(rootDir, "scripts", "e2e", "screenshots")
    if (!existsSync(this._screenshotDir)) mkdirSync(this._screenshotDir, { recursive: true })
  }

  /** Tap at coordinates using motionevent (works with React Native) */
  async tap(x, y) {
    await run(["shell", "input", "motionevent", "DOWN", String(x), String(y)])
    await sleep(50)
    await run(["shell", "input", "motionevent", "UP", String(x), String(y)])
  }

  /** Type text (only works when a text field is focused) */
  async typeText(text) {
    await run(["shell", "input", "text", text])
  }

  /** Swipe from (x1,y1) to (x2,y2) over duration ms */
  async swipe(x1, y1, x2, y2, duration = 300) {
    await run(["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(duration)])
  }

  /** Take screenshot and return the Buffer */
  async screenshot(name) {
    return new Promise((res, rej) => {
      const child = spawn(ADB, serialFlag().concat(["exec-out", "screencap", "-p"]), { stdio: ["ignore", "pipe", "pipe"] })
      const chunks = []
      child.stdout.on("data", (c) => chunks.push(c))
      child.on("close", () => {
        const buf = Buffer.concat(chunks)
        if (name) {
          const p = pathResolve(this._screenshotDir, `${name}.png`)
          writeFileSync(p, buf)
          console.log(`  Screenshot saved: ${p} (${(buf.length / 1024).toFixed(0)} KB)`)
        }
        res(buf)
      })
      child.on("error", rej)
    })
  }

  /** Dump UI hierarchy XML (uses uiautomator) */
  async dumpHierarchy() {
    const tmpFile = "/data/local/tmp/uidump.xml"
    await run(["shell", "uiautomator", "dump", tmpFile])
    const xml = await run(["shell", "cat", tmpFile])
    return xml
  }

  /** Find element bounds by text content from UI hierarchy */
  async findText(text) {
    const xml = await this.dumpHierarchy()
    const bounds = extractBounds(xml, text)
    return bounds
  }

  /** Tap on text element found in UI hierarchy */
  async tapText(text) {
    const bounds = await this.findText(text)
    if (!bounds) throw new Error(`Element with text "${text}" not found`)
    const x = Math.round(bounds.x + bounds.w / 2)
    const y = Math.round(bounds.y + bounds.h / 2)
    console.log(`  Tap text "${text}" at (${x}, ${y}) [bounds: ${bounds.x},${bounds.y} ${bounds.w}x${bounds.h}]`)
    await this.tap(x, y)
  }

  /** Assert that text is visible on screen */
  async assertVisible(text) {
    const xml = await this.dumpHierarchy()
    const bounds = extractBounds(xml, text)
    if (!bounds) throw new Error(`Assertion failed: "${text}" not visible on screen`)
    console.log(`  Assert PASS: "${text}" visible at (${bounds.x},${bounds.y} ${bounds.w}x${bounds.h})`)
    return true
  }

  /** Wait for text to appear on screen, retrying until timeout */
  async waitForVisible(text, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        await this.assertVisible(text)
        return true
      } catch { }
      await sleep(500)
    }
    throw new Error(`Timeout: "${text}" not visible after ${timeoutMs}ms`)
  }

  /** Launch the app */
  async launchApp() {
    await run(["shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`])
    await sleep(3000)
  }

  /** Stop the app */
  async stopApp() {
    await run(["shell", "am", "force-stop", PACKAGE])
  }

  /** Get device screen size */
  async screenSize() {
    const out = await run(["shell", "wm", "size"])
    const m = out.match(/(\d+)x(\d+)/)
    if (m) return { w: parseInt(m[1]), h: parseInt(m[2]) }
    return { w: 1080, h: 2400 }
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/** Extract element bounds from UI dump XML by text or content-desc */
function extractBounds(xml, text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Match both text="" and content-desc="" attributes, prefer clickable elements
  const re = new RegExp(
    `(?:text="${escaped}"|text="[^"]*${escaped}[^"]*"|content-desc="[^"]*${escaped}[^"]*")` +
    `[^>]*clickable="(true|false)"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`, "gi"
  )

  const matches = []
  let m
  while ((m = re.exec(xml)) !== null) {
    matches.push({
      clickable: m[1] === "true",
      x: parseInt(m[2]), y: parseInt(m[3]),
      x2: parseInt(m[4]), y2: parseInt(m[5])
    })
  }

  if (matches.length === 0) return null

  // Prefer clickable elements; if multiple, pick the one with largest area
  const clickableMatches = matches.filter(m => m.clickable)
  const pool = clickableMatches.length > 0 ? clickableMatches : matches
  pool.sort((a, b) => ((b.x2 - b.x) * (b.y2 - b.y)) - ((a.x2 - a.x) * (a.y2 - a.y)))
  const best = pool[0]
  return { x: best.x, y: best.y, w: best.x2 - best.x, h: best.y2 - best.y }
}

// ─── CLI entry point ─────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const m = new Maestro()
  const cmd = process.argv[2]
  const arg1 = process.argv[3]
  const arg2 = process.argv[4]

  const commands = {
    async tap() { await m.tap(parseFloat(arg1), parseFloat(arg2)) },
    async typeText() { await m.typeText(arg1) },
    async screenshot() { await m.screenshot(arg1 || "screenshot") },
    async assertVisible() { await m.assertVisible(arg1) },
    async waitForVisible() { await m.waitForVisible(arg1, parseInt(arg2) || 10000) },
    async tapText() { await m.tapText(arg1) },
    async dump() { console.log(await m.dumpHierarchy()) },
    async size() { console.log(await m.screenSize()) },
    async launch() { await m.launchApp() },
    async stop() { await m.stopApp() },
  }

  if (commands[cmd]) {
    commands[cmd]().then(() => process.exit(0)).catch(e => { console.error("Error:", e.message); process.exit(1) })
  } else {
    console.log(`Usage: node adb-test.mjs <command> [args]
    
Commands:
  tap <x> <y>           Tap at coordinates
  typeText <text>       Type text
  tapText <text>        Tap element by text
  assertVisible <text>  Assert text is visible
  waitForVisible <text> [timeout]  Wait for text to appear
  screenshot [name]     Take screenshot
  dump                  Dump UI hierarchy
  size                  Get screen size
  launch                Launch app
  stop                  Stop app
`)
  }
}
