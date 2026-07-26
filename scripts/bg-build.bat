@echo off
cd /d D:\code\mobile-agent-bridge\apps\mobile\android
set GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false
call gradlew.bat assembleRelease --no-daemon --offline > D:\code\mobile-agent-bridge\logs\build\build-bg.log 2>&1
