$env:BRIDGE_PORT = "19995"
$env:BRIDGE_PASSWORD = "test123"
$log = "D:\code\mobile-agent-bridge\logs\build\bridge_pwsh.log"
$err = "D:\code\mobile-agent-bridge\logs\build\bridge_pwsh.err"
$tsx = "D:\code\mobile-agent-bridge\servers\bridge\node_modules\.bin\tsx.cmd"
$src = "D:\code\mobile-agent-bridge\servers\bridge\src\index.ts"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $tsx
$psi.Arguments = "`"$src`""
$psi.WorkingDirectory = "D:\code\mobile-agent-bridge\servers\bridge"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.EnvironmentVariables["BRIDGE_PORT"] = "19995"
$psi.EnvironmentVariables["BRIDGE_PASSWORD"] = "test123"

$p = [System.Diagnostics.Process]::Start($psi)
$p.Id | Out-File -FilePath "D:\code\mobile-agent-bridge\logs\build\bridge.pid"
Start-Sleep -Seconds 3
Write-Host "PID: $($p.Id)"
