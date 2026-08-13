# start-cf-tunnel.ps1 - Start Cloudflare quick tunnel to expose Bridge :8080
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/start-cf-tunnel.ps1
# Prereq: Bridge running on 8080 (scripts/start-bridge-lan.ps1), cloudflared.exe in scripts/tools/

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cfd = Join-Path $PSScriptRoot "tools\cloudflared.exe"
$logDir = Join-Path $root "logs\build"
$logFile = Join-Path $logDir "cf-tunnel.log"
$pidFile = Join-Path $logDir "cf-tunnel.pid"

if (-not (Test-Path $cfd)) {
  Write-Host "[CF] cloudflared.exe not found: $cfd" -ForegroundColor Red
  Write-Host "[CF] Install via 'npm i cloudflared' and copy node_modules\cloudflared\bin\cloudflared.exe to scripts\tools\"
  exit 1
}

# Check Bridge on 8080
$bridge = netstat -ano | findstr ":8080" | findstr "LISTENING"
if (-not $bridge) {
  Write-Host "[CF] WARN: Bridge not listening on 8080. Start it first (scripts/start-bridge-lan.ps1)" -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Remove-Item -Force $logFile -ErrorAction SilentlyContinue
Remove-Item -Force $pidFile -ErrorAction SilentlyContinue

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $cfd
$psi.Arguments = "tunnel --url http://localhost:8080 --no-autoupdate --logfile `"$logFile`" --loglevel info"
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = [System.Diagnostics.Process]::Start($psi)

$p.Id | Out-File -FilePath $pidFile

Write-Host "[CF] cloudflared started PID $($p.Id). Tunnel URL generating..."
Write-Host "[CF] Log: $logFile"
Write-Host "[CF] Run scripts/get-cf-tunnel-url.ps1 after a few seconds to get the mobile URL."
