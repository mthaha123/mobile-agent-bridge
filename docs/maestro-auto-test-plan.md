# 自动模拟器测试方案

> 日期：2026-07-24

---

## 一、当前问题

| 问题 | 根因 | 影响 |
|------|------|------|
| Maestro heartbeat IOException | Java KeyValueStore 文件锁冲突 | 多 step flow 超时中断 |
| 会话创建依赖 OpenCode 服务端 | `session.create` 走 SDK，无真实 SDK 时返回错误 | ⚙ 按钮 / Model Picker / Agent Switch 无法验证 |
| 无 CI | 无 GitHub Actions / 无定时任务 | 全靠人工触发 |
| `e2e:all` 只跑 smoke.yaml | package.json 配置不全 | 其他 flow 不纳入回归 |

---

## 二、整体架构

```
┌──────────────────────────────────────────────┐
│                  CI (GitHub Actions)          │
│  on: push / schedule(每日) / manual           │
├──────────────────────────────────────────────┤
│                                               │
│  ┌──────────────┐      ┌──────────────────┐  │
│  │  Layer 1     │      │  Layer 2         │  │
│  │  Smoke       │───►  │  Bridge 集成     │  │
│  │  (Maestro)   │      │  (Maestro +      │  │
│  │              │      │   Mock Server)   │  │
│  └──────────────┘      └──────────────────┘  │
│         │                     │               │
│         ▼                     ▼               │
│  ┌──────────────┐      ┌──────────────────┐  │
│  │  Layer 3     │      │  Layer 4         │  │
│  │  UI 组件     │      │  全链路 E2E      │  │
│  │  (Maestro)   │      │  (Maestro + 实   │  │
│  │              │      │    OpenCode)     │  │
│  └──────────────┘      └──────────────────┘  │
└──────────────────────────────────────────────┘
```

---

## 三、Mock Bridge Server

**核心思路**：用 `scripts/e2e/mock-bridge.mjs` 替代真实 Bridge + OpenCode，使 Maestro 可在无 SDK 环境下完成完整流程。

### 工作方式

```
Phone (模拟器) ←WS→ Mock Bridge (localhost:8081)
                          │
                          ├── auth.login → { token: "mock" }
                          ├── session.create → { session: { id: "mock_s1" } }
                          ├── session.list → { sessions: [...] }
                          ├── model.list → { models: [...] }
                          ├── config.agents → { agents: [...] }
                          ├── session.switchAgent → { ok: true }
                          └── session.switchModel → { ok: true }
```

### 实现要点

```mjs
// scripts/e2e/mock-bridge.mjs
// 职责：启动 WS 服务器，注册 mock handler，回复固定数据
// 所有 RPC 方法的 payload 使用 scripts/e2e/mock-payloads.mjs 定义

import { WebSocketServer } from "ws"

const PORT = parseInt(process.env.MOCK_BRIDGE_PORT || "8081", 10)
const wss = new WebSocketServer({ port: PORT })

const MOCK_PAYLOADS = {
  "auth.login":    { token: "mock-jwt-token", user: { sub: "test" } },
  "auth.refresh":  { token: "mock-jwt-token-refreshed" },
  "health.ping":   { ok: true },
  "project.switch":{ directory: "/mock", project: { name: "mock-project" } },
  "project.current":{ directory: "/mock", project: { name: "mock-project" } },
  "session.list":  { sessions: [
    { id: "s1", name: "Session 1", messageCount: 3, updatedAt: new Date().toISOString() }
  ]},
  "session.create":{ session: { id: "mock_s1", name: "New Session" } },
  "session.get":   { session: { id: "mock_s1", name: "Mock Session", messageCount: 0 } },
  "session.messages":{ messages: [] },
  "model.list":    { models: [
    { id: "claude-sonnet-4", name: "Claude Sonnet 4", providerID: "anthropic" },
    { id: "gpt-4o",         name: "GPT-4o",          providerID: "openai" },
    { id: "deepseek-v3",    name: "DeepSeek V3",     providerID: "deepseek" },
  ]},
  "config.agents": { agents: [
    { name: "build",   label: "Build Agent" },
    { name: "debug",   label: "Debug Agent" },
    { name: "architect", label: "Architect Agent" },
  ]},
  "command.list":  { commands: [
    { command: "help", description: "Show help" },
    { command: "search", description: "Search code" },
  ]},
  "session.switchAgent": { ok: true },
  "session.switchModel": { ok: true },
  // ... 其他方法返回默认空结果
}
```

### 启动方式

```powershell
# 独立端口，不与真实 Bridge 冲突
$env:MOCK_BRIDGE_PORT='8081'
node scripts/e2e/mock-bridge.mjs
```

Maestro flow 中连接地址相应改为：`ws://10.0.2.2:8081/ws`

---

## 四、Maestro Driver 可靠性修复

### Root Cause

Maestro 的 KeyValueStore 使用文件锁写 `%USERPROFILE%\.maestro\session.db`，多进程并发时 IOException。这是 Maestro 2.6.1 已知问题。

### 修复方案

**短期（立即采用）**：

```yaml
# 每个 Maestro flow 开头清理 session 状态
# 在 CI 脚本中执行
- run: |
    Remove-Item "$env:USERPROFILE\.maestro\session.db" -ErrorAction SilentlyContinue
    Remove-Item "$env:USERPROFILE\.maestro\tests\*" -Recurse -ErrorAction SilentlyContinue
```

**中期**：升级 Maestro 到 3.x 以上（如果已修复）。

**长期**：使用 `scripts/e2e/adb-test.mjs`（自定义 Node.js runner）作为备选方案，绕过 Maestro 的 Java 层。

---

## 五、分层测试用例

### Layer 1: Smoke（Maestro，~2 min）

验证 app 无崩溃、ConnectScreen 渲染正常、安装正确。

| # | Flow | 步骤 | 断言 |
|---|------|------|------|
| 1.1 | `smoke.yaml` | launch → 输入 URL/password/dir → Connect | `+ New` visible |
| 1.2 | 清理 | `adb shell pm clear` + `am force-stop` | — |

### Layer 2: Bridge 集成（Maestro + Mock，~5 min）

Mock Bridge 运行在 8081 端口，包含所有 mock payload。完全覆盖 UI 界面。

| # | Flow | 测试功能 | 关键断言 |
|---|------|---------|---------|
| 2.1 | `connect-success.yaml` | 连接 Mock Bridge | `Connected` visible in Settings |
| 2.2 | `model-picker.yaml` | ⚙ 按钮 → Model Picker | `Select Model` visible, 3 models listed |
| 2.3 | `model-select.yaml` | 选择模型 | 点模型 → Modal 关闭 → 调用 switchModel |
| 2.4 | `agent-switch.yaml` | ⌘ → SlashSheet → Agent | `Switch agent` visible, 点 agent 触发 switchAgent |
| 2.5 | `session-crud.yaml` | 会话创建/列表/删除 | 列表显示 mock session, 删除成功 |
| 2.6 | `session-info.yaml` | ChatScreen header buttons | ⚙ / 📋 / ↻ 全部 visible |
| 2.7 | `file-browser.yaml` | 文件浏览/搜索 | file.list 返回 mock 数据，搜索框交互正常 |
| 2.8 | `settings-full.yaml` | Settings 完整展示 | VCS / Providers / Agents / Config 列表 |
| 2.9 | `slash-commands.yaml` | SlashSheet 命令/Agent 列表 | 命令可点击，Agent 有 "Switch agent" |
| 2.10 | `disconnect.yaml` | 断开连接 | 回到 ConnectScreen |

### Layer 3: UI 组件专项（Maestro，~3 min）

独立测试 UI 组件不依赖 Bridge。

| # | Flow | 说明 |
|---|------|------|
| 3.1 | `navigation.yaml` | Tab 切换（Chat/Files/Settings） |
| 3.2 | `sessions-buttons.yaml` | Switch Modal 打开/关闭 |
| 3.3 | `files-empty-state.yaml` | 无文件时的 empty state 显示 |
| 3.4 | `settings-display.yaml` | 离线状态下 Settings 控件渲染 |
| 3.5 | `chat-empty-state.yaml` | 无 session 时的 ChatScreen empty state |

### Layer 4: 全链路 E2E（Maestro + 真实 OpenCode，~10 min）

需要 OpenCode Agent 服务端运行（`OPENCODE_URL` 指向真实实例）。

| # | Flow | 说明 |
|---|------|------|
| 4.1 | `full-session.yaml` | 创建 → 发送消息 → 接收 SSE 流式响应 → 验证文本渲染 |
| 4.2 | `tool-permission.yaml` | 触发工具调用 → 验证 ToolApprovalSheet → 批准/拒绝 |
| 4.3 | `session-revert.yaml` | 消息级 Revert + Unrevert |
| 4.4 | `session-fork.yaml` | Fork 会话 |
| 4.5 | `session-switch-agent.yaml` | 切换 Agent → SSE 通知流变化 |
| 4.6 | `session-switch-model.yaml` | 切换 Model → 新消息使用新模型 |
| 4.7 | `code-edit-apply.yaml` | 文件编辑 diff → 验证 FileBrowser 更新 |

---

## 六、Flow 文件结构规范

### 命名规范

```
.maestro/flows/
├── l1-smoke/                 # Layer 1
│   └── smoke.yaml
├── l2-bridge/                # Layer 2
│   ├── connect-success.yaml
│   ├── model-picker.yaml
│   ├── agent-switch.yaml
│   ├── session-crud.yaml
│   ├── session-info.yaml
│   ├── file-browser.yaml
│   ├── settings-full.yaml
│   ├── slash-commands.yaml
│   └── disconnect.yaml
├── l3-ui/                    # Layer 3
│   ├── navigation.yaml
│   ├── sessions-buttons.yaml
│   └── settings-display.yaml
└── l4-e2e/                   # Layer 4
    ├── full-session.yaml
    ├── tool-permission.yaml
    ├── session-revert.yaml
    └── session-switch-agent.yaml
```

### Flow 编写约定

```yaml
appId: com.mobileagentbridge
tags:
  - layer: l2
  - needs-mock: true
  - needs-opencode: false
env:
  BRIDGE_URL: "ws://10.0.2.2:8081/ws"
---
# ─── ⚙ 模型选择按钮 ─────────────────────
- launchApp
- runFlow: .maestro/flows/l2-bridge/_connect.yaml     # 复用连接步骤
- runFlow: .maestro/flows/l2-bridge/_create-session.yaml  # 复用创建会话

- assertVisible: "⚙"
- tapOn: "⚙"
- assertVisible: "Select Model"
```

使用 `runFlow` 复用公共步骤（连接、创建会话），减少重复。

---

## 七、启动/清理脚本

### `scripts/e2e/run-layer.mjs`

```mjs
// 统一入口，用法：
//   node scripts/e2e/run-layer.mjs --layer l2 --mock

import { execSync, spawn } from "node:child_process"

const layer = process.argv.find(a => a.startsWith("--layer="))?.split("=")[1] || "l1"
const useMock = process.argv.includes("--mock")

// 1. Kill old processes
execSync("taskkill /f /im node.exe 2>nul || true")

// 2. Start mock bridge if needed
if (useMock) {
  const mock = spawn("node", ["scripts/e2e/mock-bridge.mjs"])
  // wait for port
}

// 3. Install APK
execSync("adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk")

// 4. Run flows
const flows = glob.sync(`.maestro/flows/${layer}-*/**/*.yaml`)
for (const flow of flows) {
  execSync(`.maestro/maestro.cmd test ${flow}`, { timeout: 120000 })
}

// 5. Cleanup
execSync("adb shell pm clear com.mobileagentbridge")
execSync("taskkill /f /im node.exe 2>nul || true")
```

---

## 八、CI 配置（GitHub Actions）

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 6 * * *'  # 每天 6:00 UTC
  workflow_dispatch:

jobs:
  e2e-l1-l2:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - uses: actions/setup-java@v4
        with: { distribution: 'temurin', java-version: '17' }

      - name: Create Android emulator
        run: |
          echo "y" | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --install "system-images;android-33;google_apis;x86_64"
          echo "no" | $ANDROID_HOME/tools/bin/avdmanager create avd -n test -k "system-images;android-33;google_apis;x86_64" -d pixel_6

      - name: Launch emulator
        run: |
          $ANDROID_HOME/emulator/emulator -avd test -no-window -no-audio &
          adb wait-for-device

      - name: Build APK
        run: cd apps/mobile/android && ./gradlew assembleRelease

      - name: Clean Maestro session
        run: Remove-Item "$env:USERPROFILE\.maestro\session.db" -ErrorAction SilentlyContinue

      - name: Run Layer 1 (Smoke)
        run: node scripts/e2e/run-layer.mjs --layer l1

      - name: Start Mock Bridge + Run Layer 2
        run: node scripts/e2e/run-layer.mjs --layer l2 --mock

      - name: Upload test artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: maestro-screenshots
          path: ~/.maestro/tests/

  e2e-l3:
    needs: e2e-l1-l2
    runs-on: windows-latest
    steps:
      # ... 类似步骤，运行 Layer 3 UI 组件测试

  e2e-l4:
    needs: e2e-l1-l2
    runs-on: [self-hosted, opencode]  # 需要真实 OpenCode 服务端
    steps:
      # ... 运行 Layer 4 全链路 E2E
```

---

## 九、优先级与实施路径

| 阶段 | 内容 | 预估工时 | 依赖 |
|------|------|---------|------|
| **P0** | Mock Bridge server (`scripts/e2e/mock-bridge.mjs`) | 1d | 无 |
| **P0** | 清理 Maestro session.db 脚本 | 0.5d | 无 |
| **P1** | Layer 1 + Layer 3 现有 flows 整理到子目录 + npm scripts 统一 | 0.5d | P0 |
| **P1** | Layer 2 flows（model-picker, agent-switch, settings-full 等 8 个新 flow） | 2d | Mock Bridge |
| **P2** | `scripts/e2e/run-layer.mjs` 统一启动器 | 1d | P0-P1 |
| **P2** | GitHub Actions CI 配置 | 1d | P1 |
| **P3** | Layer 4 flows（需真实 OpenCode） | 2d | 真实 OpenCode 实例 |
| **P3** | 失败自动截图 + 通知 | 0.5d | CI 配置 |

### 建议 P0 立即开工

1. **`scripts/e2e/mock-bridge.mjs`** — 这是核心基础设施，有了它所有 Layer 2 测试可独立运行
2. **Maestro session.db 清理** — 解决 heartbeat 超时问题，让现有 flows 稳定通过

---

## 十、npm scripts 更新

```jsonc
// package.json
{
  "scripts": {
    // 现有保持兼容
    "e2e:nav":    ".maestro\\maestro.cmd test .maestro\\flows\\navigation.yaml",
    "e2e:buttons":".maestro\\maestro.cmd test .maestro\\flows\\sessions-buttons.yaml",
    "e2e:all":    "node scripts/e2e/run-layer.mjs --layer l1 --layer l2 --mock",

    // 新增
    "e2e:l1":     "node scripts/e2e/run-layer.mjs --layer l1",
    "e2e:l2":     "node scripts/e2e/run-layer.mjs --layer l2 --mock",
    "e2e:l3":     "node scripts/e2e/run-layer.mjs --layer l3",
    "e2e:l4":     "node scripts/e2e/run-layer.mjs --layer l4",
    "e2e:ci":     "node scripts/e2e/run-layer.mjs --layer l1 --layer l2 --layer l3",
    "e2e:mock":   "node scripts/e2e/mock-bridge.mjs",
  }
}
```
