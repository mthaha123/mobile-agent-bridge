$null = Start-Job -Name "mockbridge" -ScriptBlock {
  Set-Location D:\code\mobile-agent-bridge
  node scripts/e2e/mock-bridge.mjs 2>&1 | Out-File logs\build\mock-bridge.log
}
Write-Host "started"
