# Agent 约束

## 核心原则：每个 bash 命令必须 < 3s 完成，或是纯粹的 fire-and-forget

**禁止在 bash 命令里管理另一个进程的生命周期**（start/wait/sleep/kill）。测试脚本用 Node.js `child_process` 自己管理子进程，bash 只负责"跑这个脚本"。

---

## 启动开发服务器

- 用 `Start-Job` 启动，return 立即结束（~100ms），绝不阻塞：
  ```
  $null = Start-Job -Name "bridge" -ScriptBlock {
    $env:BRIDGE_PORT='19985'; $env:BRIDGE_PASSWORD='test123'; $env:OPENCODE_URL='http://localhost:4096'
    node node_modules/tsx/dist/cli.mjs src/index.ts
  }
  ```
  ⚠️ `Start-Job` 在 PowerShell 5.1 **不支持 `-WorkingDirectory`**。如需指定工作目录，在 `-ScriptBlock` 内部用 `Set-Location` 切换。
- **禁止** `Start-Process -NoNewWindow`（共享 console 导致工具误判阻塞）。
- **禁止** `Start-Sleep`（不等、不轮询，由测试脚本自行处理就绪等待）。
- 环境变量在 `Start-Job` 的 `-ScriptBlock` 内部设置（继承自调用进程的 `$env:` 已过期）。

## 清理 Node 进程

- **禁止无差别杀死所有 node 进程**（`taskkill /f /im node.exe`）。
- 必须通过端口匹配定位，并验证 kill 结果。示例：
  ```
  $conn = netstat -ano | findstr :${PORT}
  $procId = ($conn -split '\s+')[-1]
  if ($procId) { taskkill /f /pid $procId }
  netstat -ano | findstr :${PORT}   # 验证已释放
  ```
  ⚠️ **禁止用 `$pid` 做变量名**（PowerShell 内置只读变量）。
- 项目常用端口：Bridge `8080`（可 `BRIDGE_PORT` 覆盖）、opencode server `4096`/`4100`

## 运行测试

- 短测试（Bridge/Mobile unit tests < 30s）可直接执行，bash 只做：
  ```
  node --experimental-vm-modules node_modules/jest/bin/jest.js --forceExit --detectOpenHandles
  ```
- **Android 模拟器测试（> 30s）必须用 `Start-Job` 后台执行**，绝不阻塞 tool call：
  ```powershell
  $null = Start-Job -Name "test-layer" -ScriptBlock {
    Set-Location D:\code\mobile-agent-bridge
    node scripts/android-test.mjs --layer 5 2>&1 | Out-File test-layer5.log
  }
  ```
  之后定期检查 job 状态和日志文件：
  ```powershell
  Get-Job -Name "test-layer" | Select-Object State   # 跨 session 不可见，改查文件
  Get-Content test-layer5.log                          # 取结果
  ```
  ⚠️ `Start-Job` 的 job 对象跨 tool call 不可见（每个 bash 是新 PowerShell 进程），只能通过输出文件检查。
- 测试脚本**必须有全局超时兜底**（`setTimeout(() => process.exit(1), 120000)`），不依赖 bash timeout 做安全网。
- bash 的 timeout 设足够大（约 180s），仅作为极端情况兜底。

## 接口对齐约束

**每次新增或修改 WS 协议接口时，必须同时对齐客户端和服务端两侧：**
- 服务端（`servers/bridge/`）：确保 `router.ts` 中注册的方法名、参数名与 SDK v2 一致
- 客户端（`apps/mobile/`）：确保 `AppProvider.tsx` 中监听的通知事件名与 SDK v2 实际发出的事件名一致
- 通知事件是透传的（SSE `ev.type` → WS `method`），**不能自行发明或猜测事件名**，必须对照 SDK v2 文档或 `e2e-sse.mjs` 的日志确认

**每个接口变更必须有对应的测试用例保障：**
- 服务端侧：在 `router.test.ts` 中验证 RPC 方法名/参数名的处理兼容性
- 客户端侧：在 `AppProvider.test.tsx` 中验证通知事件名 handler 的行为
- 服务端 SSE pass-through：在 `router.test.ts` 中验证 SDK 事件类型名作为 notify method 透传不变

验证方式：
- Bridge unit tests: `cd servers/bridge && npm test`
- Mobile unit tests: `cd apps/mobile && npx jest`
- Full E2E: `node servers/bridge/scripts/e2e.mjs`（需 `OPENCODE_URL`）

## 构建 Android APK

- **必须用 `Start-Job` 后台执行**，绝不阻塞当前进程：
  ```powershell
  # 清理残留 daemon + 并发构建
  $null = Start-Job -Name "apk-build" -ScriptBlock {
    Set-Location D:\code\mobile-agent-bridge\apps\mobile\android
    taskkill /f /im java.exe 2>$null
    $env:GRADLE_OPTS = "-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false"
    .\gradlew assembleRelease --no-daemon --offline 2>&1 | Out-File build.log
  }
  ```
- 构建完成后（`Get-Job -Name "apk-build" | Where-Object State -eq "Completed"`），检查 APK 是否存在：`Test-Path "apps/mobile/android/app/build/outputs/apk/release/app-release.apk"`
- 禁止直接运行 `./gradlew` 或 `npx react-native build-android`（阻塞 > 2s 违反核心原则）。
- 如果构建脚本需要 timeout 兜底，在 `-ScriptBlock` 内部用 `Start-Process -Wait -TimeoutSeconds 180`，而不是外部等待。

## SSE / fetch 阻塞（代码层约束）

- **禁止在 tsx 环境下使用 SDK 的 `fetch` 通道**（`req.timeout = false` 在 tsx 下会导致 hang）。所有 OpenCode API 调用必须走 `opencodeFetch()`（基于 Node.js `http` 模块）。
- 如果引入新的后端 HTTP 调用，必须使用 `http`/`https` 模块，禁止使用 `fetch`。
