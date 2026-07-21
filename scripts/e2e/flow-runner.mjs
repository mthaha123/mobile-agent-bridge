#!/usr/bin/env node
/**
 * YAML Test Flow Runner — Maestro-like
 *
 * 用法:
 *   node flow-runner.mjs <flow.yaml>
 *
 * Example flow.yaml:
 *   ---
 *   - launchApp
 *   - assertVisible: "Sessions"
 *   - tapOn: "Files"
 *   - screenshot: "files-screen"
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Maestro } from "./adb-test.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))

function green(t) { return `\x1b[32m${t}\x1b[0m` }
function red(t) { return `\x1b[31m${t}\x1b[0m` }
function yellow(t) { return `\x1b[33m${t}\x1b[0m` }
function gray(t) { return `\x1b[90m${t}\x1b[0m` }

let passed = 0
let failed = 0
let stepNum = 0

async function runStep(m, step) {
  stepNum++
  const key = Object.keys(step)[0]
  const val = step[key]
  const label = `${String(key)}${val !== undefined && val !== null ? `: ${String(val).substring(0, 60)}` : ""}`

  try {
    switch (key) {
      case "launchApp":
        await m.launchApp()
        break
      case "stopApp":
        await m.stopApp()
        break
      case "tapOn":
      case "tapText":
        await m.tapText(String(val))
        break
      case "tap":
        await m.tap(Number(val.x || val[0]), Number(val.y || val[1]))
        break
      case "assertVisible":
        await m.assertVisible(String(val))
        break
      case "waitForVisible":
        await m.waitForVisible(String(val))
        break
      case "inputText":
        await m.typeText(String(val))
        break
      case "screenshot":
        await m.screenshot(String(val || `step-${stepNum}`))
        break
      case "sleep":
        await new Promise(r => setTimeout(r, Number(val) || 1000))
        break
      case "swipe":
        await m.swipe(Number(val.x1), Number(val.y1), Number(val.x2), Number(val.y2), Number(val.duration || 300))
        break
      default:
        console.log(`  ${yellow("?")} Unknown command: ${label}`)
    }
    console.log(`  ${green("✓")} ${label}`)
    passed++
  } catch (e) {
    console.log(`  ${red("✗")} ${label}`)
    console.log(`    ${gray(e.message)}`)
    failed++
  }
}

async function main() {
  const flowFile = process.argv[2]
  if (!flowFile || !existsSync(flowFile)) {
    console.error(`Usage: node flow-runner.mjs <flow.yaml>`)
    console.error(`Flow file not found: ${flowFile}`)
    process.exit(1)
  }

  const content = readFileSync(flowFile, "utf-8")
  const lines = content.split("\n")

  // Simple YAML parser for Maestro-like flows
  const steps = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue
    if (trimmed.startsWith("- ")) {
      const cmd = trimmed.substring(2).trim()
      const colonIdx = cmd.indexOf(":")
      if (colonIdx > 0) {
        const k = cmd.substring(0, colonIdx).trim().replace(/\s/g, "")
        let v = cmd.substring(colonIdx + 1).trim()
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
        if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1)
        const step = {}
        step[k] = v
        steps.push(step)
      } else {
        const step = {}
        step[cmd] = null
        steps.push(step)
      }
    }
  }

  console.log(`\n${yellow("═══════════════════════════════════════════")}`)
  console.log(`  Flow: ${flowFile}`)
  console.log(`  Steps: ${steps.length}`)
  console.log(`${yellow("═══════════════════════════════════════════")}\n`)

  const m = new Maestro()

  for (const step of steps) {
    await runStep(m, step)
  }

  console.log(`\n${yellow("═══════════════════════════════════════════")}`)
  if (failed === 0) console.log(`  ${green("全部通过!")} ${passed}/${passed + failed} 个步骤通过`)
  else console.log(`  ${red(`${failed} 个步骤失败!`)} ${passed}/${passed + failed} 个步骤通过`)
  console.log(`${yellow("═══════════════════════════════════════════")}\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1) })
