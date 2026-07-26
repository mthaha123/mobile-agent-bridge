taskkill /f /im java.exe 2>$null
$env:GRADLE_OPTS = "-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false"
Set-Location D:\code\mobile-agent-bridge\apps\mobile\android
.\gradlew assembleRelease --no-daemon --offline 2>&1 | Out-File D:\code\mobile-agent-bridge\build-rel.log
