$env:BRIDGE_PORT='19985'
$env:BRIDGE_PASSWORD='test123'
$env:OPENCODE_URL='http://localhost:4096'
Set-Location D:\code\mobile-agent-bridge\servers\bridge
& "C:\Program Files\nodejs\node.exe" node_modules/tsx/dist/cli.mjs src/index.ts
