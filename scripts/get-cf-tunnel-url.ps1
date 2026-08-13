# get-cf-tunnel-url.ps1 - Print current Cloudflare quick tunnel URL
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/get-cf-tunnel-url.ps1

$root = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $root "logs\build\cf-tunnel.log"

if (-not (Test-Path $logFile)) {
  Write-Host "[CF] Log not found. Tunnel not started? Run scripts/start-cf-tunnel.ps1 first" -ForegroundColor Red
  exit 1
}

$content = Get-Content $logFile -Raw
$m = [regex]::Match($content, 'https://([a-z0-9\-]+\.trycloudflare\.com)')
if ($m.Success) {
  $hostname = $m.Groups[1].Value
  Write-Host "Tunnel URL : https://$hostname" -ForegroundColor Green
  Write-Host "Mobile WS  : wss://$hostname/ws" -ForegroundColor Cyan
  Write-Host "Password   : test123 (see BRIDGE_PASSWORD in start-bridge-lan.ps1)" -ForegroundColor DarkGray
} else {
  Write-Host "[CF] No tunnel URL in log yet. Tunnel may still be starting or failed." -ForegroundColor Yellow
  Write-Host "Log tail:" -ForegroundColor Yellow
  Get-Content $logFile -Tail 5
}
