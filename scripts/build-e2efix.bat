@echo off
cd /d D:\code\mobile-agent-bridge\apps\mobile\android
taskkill /f /im java.exe >nul 2>&1
set GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false
call .\gradlew assembleRelease --no-daemon --offline > D:\code\mobile-agent-bridge\logs\build\build-e2efix.log 2>&1

