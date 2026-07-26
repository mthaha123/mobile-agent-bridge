param([string]$log="D:\code\mobile-agent-bridge\logs\build\build-bg.log")
$env:GRADLE_OPTS = "-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false"
$p = Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c","D:\code\mobile-agent-bridge\apps\mobile\android\gradlew.bat","assembleRelease","--no-daemon","--offline" -WorkingDirectory "D:\code\mobile-agent-bridge\apps\mobile\android" -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError ($log -replace '\.log$','-err.log') -PassThru
$p.Id | Out-File ($log -replace '\.log$','.pid')
