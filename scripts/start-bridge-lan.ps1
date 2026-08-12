$env:BRIDGE_PORT = "8080"
$env:BRIDGE_PASSWORD = "test123"
$env:OPENCODE_URL = "http://localhost:4096"
Set-Location "D:\code\mobile-agent-bridge\servers\bridge"
& node node_modules/tsx/dist/cli.mjs src/index.ts
