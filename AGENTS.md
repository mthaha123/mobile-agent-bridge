# Agent 约束

## 核心原则：每个 bash 命令必须 < 3s 完成，或是纯粹的 fire-and-forget

**禁止在 bash 命令里管理另一个进程的生命周期**（start/wait/sleep/kill）。测试脚本用 Node.js `child_process` 自己管理子进程，bash 只负责"跑这个脚本"。

## Bash 超时安全网

项目 `.opencode/plugin/bash-timeout-guard.ts` 是一个 opencode plugin，自动拦截所有 bash 调用，强制限制 `timeout ≤ 180s`。这意味着：
- 长后台任务（E2E 测试/APK 构建）**绝不传 timeout 或传很小的 timeout**（仅够启动进程本身），任务本身用 `Start-Process -WindowStyle Hidden` 或 `Start-Job` 启动
- 日志查询/结果检查命令的 timeout 设 ≤ 15s，用短查询轮询取代长 sleep

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

## E2E 后台运行（Start-Process 模式）

**`Start-Job` 的 Job 对象跨 session 不可见**，新开 bash 进程后无法 `Get-Job`。E2E 测试等长时间后台任务改用 `Start-Process`：

```powershell
Remove-Item -Force e2e-layer3.log -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -FilePath cmd -ArgumentList '/c node scripts/e2e/run-layer.mjs --layer l3 --mock > e2e-layer3.log 2>&1'
```

查询结果用短 timeout（≤15s）轮询日志文件，**禁止用 `sleep` 等固定长时间**：
```powershell
python -c "..."  2>&1     # timeout ≤ 15s，不加 sleep
```

如果查不到就间歇性重试，单条命令绝不阻塞超过 15s。

⚠️ **Windows 文件锁注意**：`cmd /c "node ... > log 2>&1"` 的 `>` 重定向持有排他写锁，python `open(log, 'r')` 会阻塞等待锁释放。改用 `Start-Job` 的 `Out-File`（缓冲写入）或文件复制副本读取。避免读正在被写入的日志文件。

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

## E2E 模拟器测试（Maestro 原生 Windows）

Maestro **有 Windows 原生版本**（不需要 WSL2），安装在项目目录 `.maestro/`。

- **安装**：`.maestro/` 目录 — `bin/` + `lib/`，免配置
- **启动器**：`.maestro/maestro.cmd`（自动设置 JAVA_HOME = JDK 17）
- **流程文件**：`.maestro/flows/*.yaml` — Maestro YAML 格式
- **调试输出**：`%USERPROFILE%\.maestro\tests\` — 含截图和 UI hierarchy

运行方式：
```
npm run e2e:nav          # 导航测试（Tab 切换）
npm run e2e:buttons      # 按钮测试（Switch/Cancel）
npm run e2e:all          # 全部测试（2 个流程）
.maestro\maestro.cmd list-devices  # 查看设备
.maestro\maestro.cmd hierarchy     # 查看 UI 层级
```

**触摸注入**：Maestro 使用 Android 原生事件注入（非 `adb shell input tap`），含正确 DOWN/UP 时序。

**前置条件**：模拟器已运行、APK 已安装、Bridge 服务器已启动。

## SSE / fetch 阻塞（代码层约束）

- **禁止在 tsx 环境下使用 SDK 的 `fetch` 通道**（`req.timeout = false` 在 tsx 下会导致 hang）。所有 OpenCode API 调用必须走 `opencodeFetch()`（基于 Node.js `http` 模块）。
- 如果引入新的后端 HTTP 调用，必须使用 `http`/`https` 模块，禁止使用 `fetch`。

---

## 文件与目录约束

### 新增文件必须放到合理目录，禁止散落在根目录

| 文件类型 | 目标目录 |
|---------|---------|
| 业务代码/组件/Store | `apps/mobile/src/` 对应子目录 |
| Bridge handler/store | `servers/bridge/src/` 对应子目录 |
| 测试文件 | `apps/mobile/__tests__/` 或 `servers/bridge/__tests__/` |
| E2E Maestro flow | `.maestro/flows/`（按 layer 子目录） |
| E2E 测试脚本 | `scripts/e2e/` |
| 构建/部署脚本 (ps1/bat) | `scripts/` |
| 共享类型 | `packages/shared/src/` |
| 文档 | `docs/` 或 `docs/plans/` |

### 日志输出必须写入 `logs/build/`

所有后台任务（APK 构建、E2E 测试、Mock Bridge）的日志输出文件必须使用 `logs/build/` 下路径：

```powershell
# ✅ 正确
Out-File D:\code\mobile-agent-bridge\logs\build\build-rel.log
Start-Process -ArgumentList '/c ... > D:\code\mobile-agent-bridge\logs\build\e2e.log 2>&1'

# ❌ 错误 — 禁止
Out-File build-rel.log               # 散落在根目录
Start-Process -ArgumentList '... > mock-bridge.log 2>&1'
```

### 临时文件（adb dumps / 截图 / 调试输出）用完即删

adb 获取 UI hierarchy、截图、调试 XML 等文件是**一次性调试产物**，用完后必须删除：

```powershell
# 获取 UI dump 后立即删除
adb shell uiautomator dump /sdcard/ui.xml
adb pull /sdcard/ui.xml
adb shell rm /sdcard/ui.xml     # 清理设备端
rm ui.xml                        # 清理本地
```

禁止将 adb dump、截图等临时文件提交到 git。如确需保留参考，放入 `logs/dumps/` 或 `logs/screenshots/`。

### 提交前检查：无杂散文件

提交前运行 `git status` 确认根目录无新增的 `.log`、`.xml`、`.png` 等杂散文件。新增的构建产物/测试产物应已通过 `.gitignore` 排除。
