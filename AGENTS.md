# Agent 约束

## 核心原则：每个 bash 命令必须 < 3s 完成，或是纯粹的 fire-and-forget

**禁止在 bash 命令里管理另一个进程的生命周期**（start/wait/sleep/kill）。测试脚本用 Node.js `child_process` 自己管理子进程，bash 只负责"跑这个脚本"。

## Bash 超时安全网

项目 `.opencode/plugin/bash-timeout-guard.ts` 是一个 opencode plugin，自动拦截所有 bash 调用，强制限制 `timeout ≤ 180s`：

- **`tool.execute.before`**：把 bash 的 `timeout` 统一 cap 到 180s（3 分钟上限）。opencode bash 工具原生消费该参数，**超过 180s 会自动强制 kill 进程树**，任何 bash 命令最长跑 3 分钟。
- **危险 spawn 阻断**：同一 hook 还会检测命令中是否出现 `spawn(detached:true + stdio:pipe)`（长驻进程持有管道句柄 → 工具层等待管道 EOF 永不收敛 → 静默挂起）。命中即**强制改写命令为 `Write-Output '[强制阻断]...'; exit 99`**，命令不会执行，agent 会收到阻断提示。
- **长时间阻塞轮询阻断**：同一 hook 还检测 `Start-Sleep`/`sleep`（≥10s）的固定长等待。命中即**强制改写为阻断提示**，命令不会执行——长后台任务应 fire-and-forget 启动，查询用 ≤15s 短命令间歇重试。
- **`tool.execute.after`**：若 bash 结果标记超时（`Command exceeded timeout`），**向 agent 注入明确警告**（输出追加 `[超时]...已被强制终止`），提醒不要超过 180s。

⚠️ 危险 spawn 模式（`spawn` + `detached:true` + `stdio:pipe`）和长时间 `Start-Sleep`/`sleep` 轮询会被插件**强制阻断**，即使 agent 想这么写也执行不了。正确做法是 `Start-Process -WindowStyle Hidden`（长驻进程）或 `Start-Job`（开发服务器）；等待就绪用 ≤15s 短命令间歇重试。

这意味着：
- 长后台任务（E2E 测试/APK 构建）**绝不传 timeout 或传很小的 timeout**（仅够启动进程本身），任务本身用 `Start-Process -WindowStyle Hidden` 或 `Start-Job` 启动
- 日志查询/结果检查命令的 timeout 设 ≤ 15s，用短查询轮询取代长 sleep
- **当 agent 看到 bash 被强制终止（超时）或插件 cap 提示时，立即切换到 fire-and-forget + 短查询轮询模式**，而不是试图增加 timeout 重试。插件的 cap 是强制性的，bash 最长 3 分钟，调大 timeout 不会放过。

## opencode 工具结算缺陷（重要认知）

opencode 的工具执行有超时强制 kill（`timeout` 参数 + 180s cap 均生效），但**"工具调用的结算（settle）"存在已知缺陷**，GitHub 已确认为官方 bug（截至 2026-08 仍在修复中）：

- **Issue #40066**：bash 工具调用后 session 无响应（无输出/无 heartbeat/无 timeout，实测持续 12h+）；工具 part 在 session DB 中一直 `state.status="running"` 永不结算；重启后**从未执行过的调用被错误标记为 `interrupted`**。
- **Issue #41932**（V2 AI 包 P0 审计）："Settle or fail pending streamed tool calls at message_stop"、"Every announced local tool call must settle exactly once"——pending 工具调用在终止时应被结算或失败，但现在可能**永不结算**。

**行为结论**：
- `exceeded timeout` 与 `Tool execution was interrupted` 是两条不同路径：前者是超时后强制 kill 并正常返回（agent 可继续）；后者是工具层主动放弃等待，**结果可能未送达 agent → agent 停在等待态，无后续动作（静默）**。
- **"没有输出" ≠ "命令结束"**：bash 判定结束依赖进程退出 + 管道 EOF；detached 孙进程持有管道写端/仍在进程树 → 管道永不 EOF → 工具调用不返回。
- **这不是 agent 偷懒**，而是工具调用从未 settle，agent 在等一个不会来的返回。

**应对**：长驻后台进程必须用 `Start-Process -WindowStyle Hidden`（完全脱离进程树/控制台，不继承管道写端），使命令本体正常退出、无句柄残留 → 工具调用正常结算返回，既不超时也不 interrupted。禁止任何形式的 `spawn` + `detached` 在 bash 命令行里派生长驻进程（已被插件强制阻断）。

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

## 一键启动三件套（start-all.mjs）

`scripts/start-all.mjs` 统一启动 **opencode serve (4096) → bridge (8080) → cloudflared 隧道**：

- **启动（fire-and-forget，立即返回）**：
  ```powershell
  Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'D:\code\mobile-agent-bridge\scripts\start-all.mjs' -WorkingDirectory 'D:\code\mobile-agent-bridge'
  ```
- **短查询状态（≤15s）**：`node scripts/start-all.mjs --status`（PID/端口/隧道 URL）
- **精确停止**：`node scripts/start-all.mjs --stop`（读 `*.pid` 按 PID kill，禁止 `-im opencode.exe`）
- **显式等待就绪（勿在 bash 工具同步跑）**：`node scripts/start-all.mjs --wait`（每轮打印进度）

⚠️ **不要把 `start-all.mjs` 直接在 bash 里同步运行**——它 spawn 出三个长驻进程，即使 `detached + stdio:"ignore"`，bash 工具仍判进程树未收敛 → 永不返回（实测 >3min 无响应）。必须用 `Start-Process` 让脚本本身脱离进程树，再配合 `--status` 短查询轮询。这符合"工具结算缺陷"一节：长驻进程从根上不进入命令进程树。

关键参数（脚本内硬编码，与部署一致）：
- serve：spawn `opencode.exe` 绝对路径，`cwd=D:\code`，注入 `OPENCODE_SERVER_PASSWORD=""` + `OPENCODE_API_KEY`（注册表→auth.json→env 三级解析）
- bridge：`BRIDGE_PORT=8080 BRIDGE_PASSWORD=test123 OPENCODE_URL=http://localhost:4096`
- 隧道：`cloudflared tunnel --url http://localhost:8080`

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

## 生产/测试端口隔离（重要）

本机同时跑生产与开发/测试时，**测试绝不能使用或清理生产端口**。生产端口：

| 端口 | 用途 |
|---|---|
| 8080 | 生产 bridge（隧道入口） |
| 4097 | 生产默认 opencode serve |
| 4100-4104 | 生产项目 serve 端口池 |

开发/测试段（离生产 >1.5 万端口，杜绝"顺位使用"串段）：

| 端口 | 用途 |
|---|---|
| 19985 | 开发 bridge（= 真实链路测试桥 `TEST_BRIDGE_PORT`） |
| 19986 | 开发默认 opencode serve |
| 19990-19999 | 开发项目 serve 端口池 |
| 8081 / 18081 | Mock Bridge / Mock push |
| 44xx / 2000x / 19876 | E2E 脚本的 opencode / bridge |

端口段定义与守卫的唯一事实来源：`scripts/ports.mjs`（`PROD_PORTS` / `DEV_PORTS` / `checkPortGroup` / `assertTestPort`）；`scripts/e2e/ports.mjs` 仅再导出以兼容旧导入路径。

规则与护栏：

- **强制分段**：一个进程配置的所有端口必须全部落在同一段；混用生产段与开发段时 `start-all.mjs` 的 `validatePortSegments()` 直接 `exit 1` 拒绝启动（防顺位串段）。
- `serveManager`：端口池不得包含 bridge 端口（启动即报错）；`cleanOrphans()` **只清理本端口池内的注册项**，池外端口一律不杀（防数据目录被跨环境共用时误杀）。
- `assertTestPort()`：`run-layer.mjs`、`mock-bridge.mjs` 命中生产端口即 `exit 2` 拒绝执行。
- `run-layer.mjs` 只清理**测试端口**（绝不清理 8080）；真实链路 flow 仅当测试桥 19985 就绪时运行，**绝不回退到生产 8080**（未就绪则 SKIP）。
- `l2-md-table-*`、`l2-bridge-history-*` 等真实链路 flow 已指向 `ws://10.0.2.2:19985/ws`。
- 开发联调：`node scripts/start-all.mjs --env-file scripts/dev.env`（模板 `scripts/dev.env.example`）。
- 生产部署：先 `cd servers/bridge && npm run build`，再 `node scripts/start-all.mjs --env-file scripts/prod.env`（生产跑 `dist/index.js`，不跑 tsx；模板 `scripts/prod.env.example`）。
- 健康检查：`GET http://localhost:<BRIDGE_PORT>/health`；隔离冒烟：`node scripts/verify-prod-env.mjs`。
- 新增测试脚本/flow 时，**禁止硬编码 8080/4097/4100-4104**；一律走 `scripts/ports.mjs`。

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

## JS Bundle 重新生成（修改 React Native 代码后）

`gradlew assembleDebug` **不会**自动重新生成 JS bundle。Gradle 从 `app/src/main/assets/index.android.bundle`（预打包文件）复制到 APK。

**修改 JS/TSX 后必须手动重新打包并更新源 bundle：**

```bash
cd apps/mobile
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle --reset-cache
```

⚠️ **关键：`--bundle-output` 必须指向 `android/app/src/main/assets/index.android.bundle`**，不能是 `build/intermediates/assets/debug/`。Gradle 从 `src/main/assets/` 复制到 `intermediates/assets/`，再打入 APK。写到 intermediates 会被 Gradle 覆盖。

重新打包后，再执行 `gradlew assembleDebug` 构建 APK。

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

## opencode-go 模型 key 注入（serve 模式）【key 问题速查】

> 遇到"模型调用 429/401、serve 没反应、测试跑不通"时，**先跑一键诊断**：
> ```powershell
> node scripts/diag-api-key.mjs
> ```
> 它会把三个来源的值逐个实测并给出修复建议。多数情况直接照提示重启服务即可。

### 1. 核心事实（不对称）

| 运行方式 | 读哪个 key |
|---------|-----------|
| `opencode serve`（本项目 serve/bridge 用） | **只认环境变量** `OPENCODE_API_KEY`（不读 auth.json） |
| `opencode run`（CLI，agent 本体用它） | 读 `auth.json`（`opencode auth login` 写） |

`opencode-go`/`opencode` provider 在 models.dev 定义 `env: ["OPENCODE_API_KEY"]`。
不注入该 env 时，serve 建 session 会 `Model unavailable` 或 `HTTP 401 Missing API key`，
表现为"卡住"（消息已受理但无任何响应事件）。

### 2. 症状 → 根因对照

| 症状 | 根因 |
|------|------|
| 模型调用 `429 GoUsageLimitError`（月份额度用尽） | serve 拿到了**错误的 key**（见下方 env 污染） |
| `401 Missing API key` / `Model unavailable` | serve 完全没拿到 key |
| agent（`opencode run`）正常，但 serve 报错 | 两者读 key 通道不同（agent 读 auth.json，serve 读 env） |

### 3. 根因：长驻父进程的 env 污染（最常见）

长驻进程（agent harness / 旧终端）会在启动瞬间把 `OPENCODE_API_KEY` **快照**进自己的运行时 env。
若该值过期或**已超额**，它会被**所有子进程继承**（`Start-Process` 起的 start-all → serve/bridge）。
`setx` 只改注册表、改不了已运行进程的 env，所以"注册表已改好"但服务仍报错。

### 4. 统一解析顺序（所有脚本一致）

```
注册表 HKCU\Environment (setx 持久化)  →  auth.json (opencode 权威凭据库)  →  process.env
     ↑ 显式配置意图                          ↑ 与 CLI 同源、最可靠              ↑ 放最后，避免坏 env 抢占
```

三级读取均在 `try/catch` 内：**任一级缺失/不可读都自动降级，不会崩**。
env 与注册表不一致时打警告（便于发现污染）。

**代码落点（改动 key 逻辑时四处要同步）：**
- `scripts/start-all.mjs` — `resolveProviderKey()` / `resolveOpenCodeAPIKey()`
- `servers/bridge/src/state/serveManager.ts` — `resolveProviderKey()`（**新增 serve 时也走这里**，`startServe()` 用它取 key）
- `scripts/e2e/*.mjs`（`test-project-analysis` / `test-interface-coverage` / `run-layer4` / `diag-history-roundtrip`）各自的 `resolveOpenCodeAPIKey()`
- `scripts/diag-api-key.mjs` — 诊断工具（不改 key，只读+实测）

### 5. 修复步骤（标准流程）

```powershell
# ① 诊断：看三个来源哪个可用
node scripts/diag-api-key.mjs

# ② 若注册表缺失/坏 → 用可用 key 持久化（一次性）
$key = (Get-Content "$env:USERPROFILE\.local\share\opencode\auth.json" -Raw | ConvertFrom-Json).'opencode-go'.key
setx OPENCODE_API_KEY $key

# ③ 重启服务让新 key 生效（关键！运行中的服务不会自动换 key）
node scripts/start-all.mjs --stop
Start-Process -WindowStyle Hidden -FilePath node -ArgumentList 'D:\code\mobile-agent-bridge\scripts\start-all.mjs' -WorkingDirectory 'D:\code\mobile-agent-bridge'
node scripts/start-all.mjs --status
```

⚠️ **`setx` 只对之后新启动的进程生效**——当前 agent/终端进程的 env 改不了；
这正是解析顺序把 env 放最后的原因（坏 env 不再影响 serve）。若想让 agent 自身也干净，从**新终端**重启 agent。

### 6. 验证 key 是否真的生效（端到端）

改完 key 必须重启服务，然后用 mimo2.5 跑一次（`diag-api-key.mjs` 只验证 key 本身，不验证 serve 是否已加载新 key）：
```powershell
# 通过 bridge WS：auth.login → project.switch → session.create(model=opencode-go/mimo-v2.5) → message.send
# 断言 assistant 回复包含 "test ok"。注意 message.send 现在【立即返回】（异步准入），
# 需轮询 session.messages 直到 assistant 文本出现（约 1-3s）。
```

### 7. 常见坑

- **必须直接 spawn `opencode.exe`（绝对路径）**，不要用 `opencode.cmd` + `shell:true`——.cmd 包装层会丢失传入的 env。
- **新增 serve 的 key 由 `serveManager.startServe()` 解析**（`resolveProviderKey`）；只改 start-all 不改 serveManager，会导致"已有的 serve 正常、新加的 serve 报 429"。
- **孤儿 serve 状态错乱**：`node scripts/start-all.mjs --stop` 只杀 pid 文件里的进程（bridge + 默认 serve 4097 + cf），**不杀项目 serve（4100+）**。项目 serve 的父进程死后会成孤儿，`cleanOrphans` 偶尔没清掉 → `serve.list` 报 `stopped` 但端口仍在监听。彻底干净：停服务后按端口杀 4100-4104。
- **重启后项目 serve 是 `stopped`**（`cleanOrphans` 杀掉不自动重启）：切到已注册项目会 `ECONNREFUSED`，需在 Settings 里点 Start（或调用 `serve.start`）。

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
