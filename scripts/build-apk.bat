@echo off
set GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false
cd /d D:\code\mobile-agent-bridge\apps\mobile\android
call .\gradlew assembleRelease --no-daemon --offline > D:\code\mobile-agent-bridge\build-rel2.log 2>&1
