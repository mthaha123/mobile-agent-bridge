import { spawn, execSync } from "child_process"
import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cfd = path.join(rootDir, "scripts", "tools", "cloudflared.exe")
const logDir = path.join(rootDir, "logs", "build")
const logFile = path.join(logDir, "cf-tunnel.log")
const pidFile = path.join(logDir, "cf-tunnel.pid")
const resultFile = path.join(logDir, "cf-launch-result.txt")

const report = (m) => { writeFileSync(resultFile, "[" + new Date().toISOString() + "] " + m + "\n") }

if (!existsSync(cfd)) {
  report("ERROR cloudflared.exe not found: " + cfd)
  process.exit(1)
}

try {
  execSync("taskkill /f /im cloudflared.exe", { stdio: "ignore" })
  report("killed existing cloudflared")
} catch {
  report("no existing cloudflared to kill")
}
await new Promise((r) => setTimeout(r, 800))

mkdirSync(logDir, { recursive: true })
for (const f of [logFile, pidFile]) { try { rmSync(f, { force: true }) } catch {} }

const child = spawn(cfd, ["tunnel", "--url", "http://localhost:8080", "--no-autoupdate", "--logfile", logFile, "--loglevel", "info"], {
  detached: true,
  stdio: "ignore",
})
child.unref()
writeFileSync(pidFile, String(child.pid))
report("started PID " + child.pid)