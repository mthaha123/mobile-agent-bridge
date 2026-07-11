#!/usr/bin/env node
// Minimal WS connectivity test

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { WebSocket } from "ws"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const serverDir = resolve(__dirname, "..")
const PORT = 19999

// Start bridge
const server = spawn(process.execPath, [resolve(serverDir, "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"], {
  cwd: serverDir,
  env: { ...process.env, BRIDGE_PORT: String(PORT), BRIDGE_PASSWORD: "test123" },
  stdio: ["ignore", "pipe", "pipe"],
})
server.stdout.on("data", c => { process.stdout.write("[OUT] " + c) })
server.stderr.on("data", c => { process.stderr.write("[ERR] " + c) })

// Wait for server
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("timeout")), 10000)
  const check = c => { if (c.toString().includes("启动于端口")) { clearTimeout(t); setTimeout(resolve, 1000) } }
  server.stdout.on("data", check)
  server.stderr.on("data", check)
})

console.log("Server started")

// Connect and test
const ws = new WebSocket(`ws://localhost:${PORT}`)
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("WS timeout")), 5000)
  ws.on("open", () => { clearTimeout(t); resolve() })
  ws.on("error", e => reject(e))
})
console.log("WS connected")

// Test 1: health.ping without auth should fail
ws.send(JSON.stringify({ type: "req", id: "1", method: "health.ping", params: {} }))
const r1 = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("No response")), 5000)
  ws.on("message", d => { clearTimeout(t); resolve(JSON.parse(d.toString())) })
})
console.log("Test1 (unauth health):", r1.ok === false ? "PASS" : "FAIL", JSON.stringify(r1))

// Test 2: auth.login
ws.send(JSON.stringify({ type: "req", id: "2", method: "auth.login", params: { password: "test123" } }))
const r2 = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("No response")), 5000)
  ws.on("message", d => { clearTimeout(t); resolve(JSON.parse(d.toString())) })
})
console.log("Test2 (login):", r2.ok === true && r2.payload?.token ? "PASS" : "FAIL", JSON.stringify(r2).slice(0, 100))

// Test 3: session.create before project.switch
const token = r2.payload.token
const ws2 = new WebSocket(`ws://localhost:${PORT}?token=${encodeURIComponent(token)}`)
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("WS timeout")), 5000)
  ws2.on("open", () => { clearTimeout(t); resolve() })
  ws2.on("error", e => reject(e))
})
console.log("WS2 connected with token")

ws2.send(JSON.stringify({ type: "req", id: "3", method: "session.create", params: {} }))
const r3 = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("No response - TIMEOUT")), 5000)
  ws2.on("message", d => { clearTimeout(t); resolve(JSON.parse(d.toString())) })
})
console.log("Test3 (session.create before setup):", r3.ok === false ? "PASS" : "FAIL", JSON.stringify(r3))

// Test 4: project.switch
ws2.send(JSON.stringify({ type: "req", id: "4", method: "project.switch", params: { directory: serverDir } }))
const r4 = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("No response")), 10000)
  ws2.on("message", d => { clearTimeout(t); resolve(JSON.parse(d.toString())) })
})
console.log("Test4 (project.switch):", r4.ok === true ? "PASS" : "FAIL", JSON.stringify(r4).slice(0, 150))

// Test 5: session.create after switch
ws2.send(JSON.stringify({ type: "req", id: "5", method: "session.create", params: { title: "ws-test" } }))
const r5 = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("No response - TIMEOUT")), 10000)
  ws2.on("message", d => { clearTimeout(t); resolve(JSON.parse(d.toString())) })
})
console.log("Test5 (session.create after setup):", r5.ok === true ? "PASS" : "FAIL", JSON.stringify(r5).slice(0, 150))

ws2.close()
ws.close()
server.kill()
console.log("\nDone")
process.exit(0)
