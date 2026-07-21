@echo off
setlocal
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot"
set "PATH=%~dp0bin;%PATH%"
set "MAESTRO_CLI_NO_ANALYTICS=1"
set "MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=1"
maestro.bat %*
