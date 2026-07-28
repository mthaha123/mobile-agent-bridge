$null = Start-Job -Name "maestro-l4" -ScriptBlock {
  Set-Location D:\code\mobile-agent-bridge
  $env:MAESTRO_TEST_OUTPUT_DIR = "D:\code\mobile-agent-bridge\logs\build\maestro-out"
  .maestro\maestro.cmd test .maestro\flows\l4-tool-permission.yaml --format JUNIT --output D:\code\mobile-agent-bridge\logs\build\maestro-report.xml 2>&1 | Out-File D:\code\mobile-agent-bridge\logs\build\maestro-l4-v6.log
}
Write-Output "job launched"
