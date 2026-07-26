const { exec } = require('child_process')
const { join } = require('path')
const fs = require('fs')
const log = join(__dirname, '..', 'build-bg5.log')
const cwd = join(__dirname, '..', 'apps', 'mobile', 'android')
const cmd = `cd /d "${cwd}" && set GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false && start "gradle" /b /wait gradlew.bat assembleRelease --no-daemon --offline > "${log}" 2>&1`
exec(`start "gradle" /min cmd.exe /c "${cmd.replace(/"/g, '\\"')}"`, { windowsHide: true })
