# RN Upgrade 0.76.9 → 0.86.3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `apps/mobile` 从 RN 0.76.9 + React 18.3.1 升到 RN 0.86.3 + React 19.2.3，全量回归门通过，从而解锁原生 markdown 引擎项目（Gate C，见 `2026-09-23-native-markdown-engine-design.md` §6 附录）。

**Architecture:** 在独立分支 `rn-upgrade-0.86` 上做依赖版本族（JS）与 android 模板（Gradle/Kotlin/SDK/MainApplication）两条线的对齐迁移，每个阶段以既有测试/构建/e2e 作门禁；全绿后 merge 回 `main`，再回原生 markdown 计划重跑 Gate A'。

**Tech Stack:** React Native 0.86.3 / React 19.2.3 / Gradle 9.3.1 / Kotlin 2.1.20 / compileSdk 36 / pnpm workspace / ts-jest 自定义配置 / Maestro e2e。

---

## 约束（AGENTS.md，必须遵守）

- 每条 bash < 3s 或 fire-and-forget；**构建必须后台** `Start-Process` + 短轮询；依赖变更后的构建**不加 `--offline`**。
- 日志写 `logs/build/`；提交前 `git status` 无杂散；端口只用测试段（8081/19985 等，绝不碰 8080/4097/4100-4109 生产段）。
- 每任务一个 commit。**在分支 `rn-upgrade-0.86` 上执行**（本计划 Task 1 创建；main 在 merge 前保持可用，这就是回滚手段）。

## 版本事实（权威源：`npm pack @react-native-community/template@0.86.3` 模板原文 + 本机现状）

| 项 | 现状 | 目标 | 备注 |
|---|---|---|---|
| react / react-test-renderer | 18.3.1 / ^18.3.1 | **19.2.3 / 19.2.3** | 模板 pin 精确版本 |
| @types/react / @types/react-test-renderer | ^18.3.0 / — | **^19.2.0 / ^19.1.0（新增）** | |
| react-native | 0.76.9 | **0.86.3** | |
| @react-native/{babel-preset,metro-config,typescript-config,codegen} | 0.76.9 | **0.86.3** | codegen 我们自己也在 devDeps |
| @react-native/gradle-plugin | ^0.76.9 | **^0.86.3** | settings.gradle includeBuild 它 |
| @react-native/jest-preset | — | **0.86.3（新增）** | RN peer 项 |
| @react-native-community/cli* | ^20.2.0 | 保持 | 模板 20.1.0，我们更高 |
| jest / @types/jest | ^29.7.0 / ^30.0.0 | 保持 | 模板 29/29.5；@types/jest30 是风险 R3 |
| typescript | ^5.4.0 | **^5.8.3** | |
| Gradle wrapper | 8.7 | **9.3.1** | JDK17+ 本机满足 |
| AGP / Kotlin | 8.2.1（显式 classpath）/ 1.9.24 | **模板式（versionless classpath + rootproject 插件）/ 2.1.20** | 见 Task 3 Step 2 回退阶梯 |
| buildTools / compileSdk / targetSdk | 34 / 34 / 34 | **36 / 36 / 36** | |
| minSdk / NDK | 24 / 27.1.12297006 | **不变** | 模板同值 |
| node | 22.20.0 | ≥22.11 ✓ | |
| MainApplication.kt | 0.76 风格 | 模板式 `loadReactNative` + `getDefaultReactHost(context, PackageList(...))` | |

## 风险矩阵（处置在 Task 5）

| # | 风险 | 判据/处置 |
|---|---|---|
| R1 | **react-native-blob-util@0.24.10**（旧架构 DSL、读 `rootProject.ext`、我们有 classpath jar hack）——最大未知 | Task 5 阶梯：先原样构建 → 报错逐类处置（classpath hack / 最新版本探测 `npm view react-native-blob-util versions`）→ 构建仍死才开换库子任务 |
| R2 | RNTL **12.9**（peer 兼容 React19：`react>=16.8`）runtime 未知 | jest 挂在 renderer/act 相关 → 升 RNTL 14.0.1（peer react>=19, RN>=0.78 ✓） |
| R3 | @types/jest30 vs 模板 29.5 | 只在 tsc 报 @types/jest 冲突时降到 ^29.5.13 |
| R4 | @types/react19 的 TS 破坏性 | **tsc 基线 = 25 个既有错误（本机实测）**，验收口径「不新增」 |
| R5 | 残留 `metro-react-native-babel-preset@0.77`（deprecated、babel.config 未引用） | 不动（YAGNI） |
| R6 | AGENTS 打包链 `npx react-native bundle` | CLI 保持 20.2 不变，风险低；Task 6 回归覆盖 |
| R7 | Gradle 9.3.1 需 JDK17+ | 本机 JDK17（maestro 同源）`java -version` Task 1 留证 |
| R8 | nitro/ratex 栈 | nitro peer `*` 升级后天然满足；ratex 0.1.14（需 RN≥0.84/React≥19.2）**Task 7** 才升 |

---

### Task 1: 建分支 + 基线存档

**Files:** 无（只读 + 分支）

**Step 1: 建分支（这就是回滚面）**

Run: `git checkout -b rn-upgrade-0.86`
Expected: `Switched to a new branch 'rn-upgrade-0.86'`

**Step 2: 三条基线（后续验收的对照数字）**

Run: `cd apps/mobile && npx jest --silent 2>&1 | Select-Object -Last 5`
Expected: `Tests: 2 failed, 1103 passed, 1105 total`（2 个既有失败：ChatScreen 模型选择 / SessionsScreen rename——**升级后不得新增**）

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | Select-String -Pattern 'error TS' | Measure-Object`
Expected: `Count = 25`（本机实测基线，「不新增」口径）

Run: `java -version 2>&1 | Select-Object -First 1`
Expected: `17.x` 或更高

**Step 3: 无 commit**（分支创建 + 只读命令）

---

### Task 2: package.json 依赖版本族对齐

**Files:**
- Modify: `apps/mobile/package.json`

**Step 1: 按版本事实表改 deps/devDeps**

必须的键值变化（保持既有条目顺序，就地替换值）：
- dependencies: `"react": "19.2.3"`、`"react-native": "0.86.3"`
- devDependencies: `"react-test-renderer": "19.2.3"`、`"@types/react": "^19.2.0"`、
  `"typescript": "^5.8.3"`、`"@react-native/babel-preset": "0.86.3"`、
  `"@react-native/codegen": "0.86.3"`、`"@react-native/metro-config": "0.86.3"`、
  `"@react-native/typescript-config": "0.86.3"`、`"@react-native/gradle-plugin": "^0.86.3"`
- 新增两条 devDependencies（按字母序插入）：`"@react-native/jest-preset": "0.86.3"`、
  `"@types/react-test-renderer": "^19.1.0"`

**Step 2: 安装 + 版本验证**

Run: `pnpm --dir apps/mobile install`
Expected: `Done in Nx`，无 UNMET PEERDEPS **error**（warning 记录即可；若报 react-native 系 peer 冲突，原样记录进 Task 6 验收笔记）

Run:
```powershell
node -e "const p=require('./apps/mobile/package.json');const d={...p.dependencies,...p.devDependencies};['react','react-native','react-test-renderer','@types/react','@react-native/babel-preset','@react-native/metro-config','@react-native/gradle-plugin'].forEach(k=>console.log(k,d[k]))"
```
Expected: 逐行等于版本事实表目标值（`react-native0.86.3` / `react 19.2.3` / …）。

**Step 3: 快速 jest 冒烟（预期可能挂，分类后处理）**

Run: `cd apps/mobile && npx jest --silent 2>&1 | Select-Object -Last 8`
- Expected A：全绿（仅 2 既有失败）→ 直接 Task 3；
- Expected B：新失败 → **只记录不修**（修复归 Task 4），分类：`act/renderer` 类→R2；`JSX/props 类型` → R4；其它原样记日志，继续 Task 3（构建线可并行）。

**Step 4: Commit**

```bash
git add apps/mobile/package.json ../../pnpm-lock.yaml 2>/dev/null || git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "chore(mobile): bump RN 0.76.9 -> 0.86.3 + React 18 -> 19.2.3 deps"
```
（lockfile 在仓库根：`git add pnpm-lock.yaml` 用根相对路径执行，见下）

正确命令（仓库根执行）：`git add apps/mobile/package.json pnpm-lock.yaml && git commit -m "chore(mobile): bump RN 0.76.9 -> 0.86.3 + React 18 -> 19.2.3 deps"`

---

### Task 3: Android 构建文件迁移（对照 RN 0.86.3 模板）

**Files:**
- Modify: `apps/mobile/android/gradle/wrapper/gradle-wrapper.properties`
- Modify: `apps/mobile/android/build.gradle`
- Modify: `apps/mobile/android/settings.gradle`
- Modify: `apps/mobile/android/app/build.gradle`
- Modify: `apps/mobile/android/gradle.properties`
- Modify: `apps/mobile/android/app/src/main/java/com/mobileagentbridge/MainApplication.kt`
- Modify: `apps/mobile/android/app/src/main/java/com/mobileagentbridge/MainActivity.kt`

> 模板已 pack 在 `logs/build/react-native-community-template-0.86.3.tgz`（Task 2 前的探测产物，必要时 `tar -xOf <tgz> <路径>` 重读原文）。
> 权威对照工具：`https://react-native-community.github.io/helper/?from=0.76.9&to=0.86.3`

**Step 1: wrapper → Gradle 9.3.1**

`gradle-wrapper.properties` 的 `distributionUrl` 改为：
```
distributionUrl=https\://services.gradle.org/distributions/gradle-9.3.1-bin.zip
```

**Step 2: root `build.gradle` 对齐模板（AGP 回退阶梯）**

目标（模板原文 + 我们保留全部 ext 值，blob-util 要读 `rootProject.ext`）：
```groovy
buildscript {
    ext {
        buildToolsVersion = "36.0.0"
        minSdkVersion = 24
        compileSdkVersion = 36
        targetSdkVersion = 36
        ndkVersion = "27.1.12297006"
        kotlinVersion = "2.1.20"
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle")
        classpath("com.facebook.react:react-native-gradle-plugin")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin")
    }
}
ext {
    buildToolsVersion = "36.0.0"
    minSdkVersion = 24
    compileSdkVersion = 36
    targetSdkVersion = 36
    ndkVersion = "27.1.12297006"
    kotlinVersion = "2.1.20"
}
apply plugin: "com.facebook.react.rootproject"
```
（保留项目顶层的 `ext {}` 双写：模板 app/build.gradle 读 `rootProject.ext.*`，blob-util 也读它。）

**回退阶梯（出现才做）**：
1. Gradle 报 `classpath ... requires a version` → 定版本：Run `Get-ChildItem node_modules\@react-native\gradle-plugin -Recurse -File | Select-String -Pattern 'com.android.tools.build:gradle|agpVersion' | Select-Object -First 5`（在 `apps/mobile` 下执行），把 gradle-plugin 指望的 AGP 版本显式补到 classpath；
2. blob-util 报 `unresolved reference: com.facebook.react`（它的 build.gradle `apply plugin` 找不到插件）→ 保留旧 hack 一行：`classpath(files("../node_modules/@react-native/gradle-plugin/react-native-gradle-plugin/build/libs/react-native-gradle-plugin.jar"))`（必要时先在该目录 `gradlew :react-native-gradle-plugin:jar` 生成——0.86 的插件可能是 Kotlin DSL 源码 in-place，报错原文再定）；
3. 删除旧的 `AGP 8.2.1` 显式版本行与旧的 blob-util hack（若 Step 2 目标已成功构建）。

**Step 3: `settings.gradle` 对齐模板原文**

```groovy
pluginManagement { includeBuild("../node_modules/@react-native/gradle-plugin") }
plugins { id("com.facebook.react.settings") }
extensions.configure(com.facebook.react.ReactSettingsExtension){ ex -> ex.autolinkLibrariesFromCommand() }
rootProject.name = 'MobileAgentBridge'
include ':app'
includeBuild('../node_modules/@react-native/gradle-plugin')
```
（保留我们的 `rootProject.name`；对照：旧版多 `repositories{}` 段可删——模板无。）

**Step 4: `app/build.gradle` 对齐模板**

- `apply plugin` 三行照模板（`com.android.application` / `org.jetbrains.kotlin.android` / `com.facebook.react`）——已有则核对顺序；
- `react {}` 块尾部确保有 `autolinkLibrariesWithApp()`（模板新增调用，缺失则 autolink 不生效）；
- `android {}`：SDK 引用仍走 `rootProject.ext.*`（值已由 Step 2 更新到 36）；`namespace`/`applicationId` 保持 `com.mobileagentbridge`；
- `dependencies` 保持 `com.facebook.react:react-android` + hermes 分支（模板同款）；
- release 签名保持现状（debug keystore，与既有发布链一致）。

**Step 5: `gradle.properties` 补模板新项**

追加（保留现有 newArchEnabled=true / hermesEnabled=true / jvmargs 等）：
```
edgeToEdgeEnabled=false
```

**Step 6: `MainApplication.kt` 换模板实现**

目标（包名替换后）：
```kotlin
package com.mobileagentbridge

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages.apply {
        // Packages that cannot be autolinked yet can be added manually here, for example:
        // add(MyReactNativePackage())
      },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
```

**Step 7: `MainActivity.kt` 按模板抽取对照后迁移**

Run: `tar -xOf logs\build\react-native-community-template-0.86.3.tgz package/template/android/app/src/main/java/com/helloworld/MainActivity.kt`
把差异（预期主要是 `ReactActivityDelegate`/`loadReactNative` 相关或无变化）按需并入我们的 `MainActivity.kt`，包名/applicationId/`getMainComponentName()`（`MobileAgentBridge`）保持项目值。
Expected: 改完后 `Select-String -Path apps\mobile\android\app\src\main\java\com\mobileagentbridge\MainActivity.kt -Pattern 'getMainComponentName'` 仍输出组件名行。

**Step 8: 构建门（后台 + 轮询；不加 --offline）**

复用自包含 bat 模式（把 `logs/build/build-md-gate.bat` 的内容抄成 `logs/build/build-rn-upgrade.bat`，日志改 `build-rn-upgrade.log`），`Start-Process -WindowStyle Hidden cmd /c <bat>` 后轮询 `EXIT=`：
Expected: `EXIT=0` + `BUILD SUCCESSFUL`。
失败 → 读 `What went wrong` 分类：本文件迁移问题→本任务内修；第三方原生库问题（blob-util/webview）→ **Task 5**；JS bundle 打包阶段错误 → **Task 4**。

**Step 9: Commit**

```bash
git add apps/mobile/android
git commit -m "feat(android): migrate to RN 0.86.3 template (gradle 9.3.1/kotlin 2.1.20/sdk 36/mainapplication)"
```

---

### Task 4: JS/TS 适配门（React 19 + @types/react 19）

**Files:** 按失败现场（`apps/mobile/__tests__/*`、`apps/mobile/src/**`、`jest.setup.js`）

**Step 1: 全量 jest，采集失败清单**

Run: `cd apps/mobile && npx jest --silent 2>&1 | Select-String -Pattern 'FAIL|✕' | Select-Object -First 30`
Expected（对照基线）: 只允许既有 2 失败；新增失败在此修。

**已知 React19 修复套路（命中才用）**：
- `Cannot read properties of undefined (reading 'unstable_isBatchingLegacy')` / `ReactDOM.test-utils` 类 → 测试改用 `react-test-renderer` 的 `act` 或 RNTL `render`；仍在挂 → **R2 升 RNTL**：`pnpm --dir apps/mobile add -D @testing-library/react-native@14.0.1`（peer：react≥19、RN≥0.78 ✓）。
- `JSX element type 'X' does not have any construct or call signatures` / children 丢失 → @types/react19 的 `JSX.Element` 收紧：给缺 children 的组件显式 `children?: React.ReactNode`（只改报错处，不全局重构）。
- `Cannot find module '@types/react-test-renderer'` → Task 2 应已加，漏了补上。

**Step 2: tsc 门（基线 25）**

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | Select-String -Pattern 'error TS' | Measure-Object`
Expected: `Count = 25`（新增则逐条修；25 个既有错误不要"顺手"修——它们是基线口径）

**Step 3: jest 门**

Run: `cd apps/mobile && npx jest --silent 2>&1 | Select-Object -Last 5`
Expected: `Tests: 2 failed, >=1103 passed`（仅 2 既有失败）

**Step 4: Commit**

```bash
git add -A
git commit -m "fix(mobile): adapt tests and types for React 19 / @types/react 19"
```
（无改动则本任务不产生 commit。）

---

### Task 5: 原生依赖风险处置（R1 blob-util 阶梯，构建报错驱动）

**Files:** `apps/mobile/package.json`（如需升 blob-util）、`apps/mobile/android/*`（如需补 rootProject.ext 兼容）

> 前置：Task 3 Step 8 构建门的失败日志。Task 3 一次通过 → 本任务只跑 Step 3 的运行冒烟。

**Step 1: 按报错原文定位**

Run: `Select-String -Path logs\build\build-rn-upgrade.log -Pattern 'What went wrong|FAILED|error:|unresolved reference|Execution failed' | Select-Object -First 15`
逐条分类：属于 `:app` 模板迁移 → 回 Task 3；属于某库 → 继续 Step 2。

**Step 2: blob-util 处置阶梯（命中即停）**
1. 报 `rootProject.ext` 相关 → 确认 Task 3 Step 2 的顶层 `ext {}` 还在（它就是给 blob-util 的）；
2. 报 Kotlin/AGP DSL（`compileSdkVersion` 旧 API 等）→ Run `npm view react-native-blob-util versions --json | Select-Object -Last 5`，有更新版本则升到最新并重建；无则最小 patch 其 build.gradle（**优先避免**；开修前把原文记进本任务笔记）；
3. 报 interop/TurboModule → 不动（interop layer 负责），转 Step 3 运行冒烟判定。

**Step 3: 运行冒烟（构建过但运行可能炸——R1 的 runtime 面）**

后台构建 → 装 → `.maestro\maestro.cmd test .maestro\flows\shared\connect.yaml`（连 mock 8081，flow 内自带 URL 输入）
Expected: 连接完成不红屏。blob-util 运行面验证（文件下载通道）不在此任务：留 Task 6 之后的 e2e 观察项（file-browser flows 可选跑：`maestro test .maestro/flows/file-browser.yaml`，失败记为 R1 遗留不阻塞 merge，写进收尾笔记）。

**Step 4: Commit（如有改动）**

```bash
git add -A
git commit -m "fix(android): keep native deps building on RN 0.86.3 (blob-util ladder)"
```

---

### Task 6: 回归验收门（四条全过才算升级完成）

**Files:** 无

**Step 1: 单测门**

Run: `cd apps/mobile && npx jest --silent 2>&1 | Select-Object -Last 5`
Expected: `Tests: 2 failed, 1103+ passed`（仅既有 2 个）

**Step 2: 类型门**

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | Select-String -Pattern 'error TS' | Measure-Object`
Expected: `Count = 25`（不新增）

**Step 3: 构建门**

检查 `logs\build\build-rn-upgrade.log` 末尾或重跑 bat：Expected `EXIT=0` + `BUILD SUCCESSFUL`。

**Step 4: 运行门（连接冒烟 + 聊天主链路）**

前置：模拟器在线（`adb devices` → `device`）、mock bridge 8081 LISTENING（否则 fire-and-forget 启动：`Start-Process -WindowStyle Hidden -FilePath cmd -ArgumentList '/c node scripts\e2e\mock-bridge.mjs > logs\build\mock-bridge-8081.log 2>&1' -WorkingDirectory 'D:\code\mobile-agent-bridge'`）。

Run: `.maestro\maestro.cmd test .maestro\flows\shared\connect.yaml`
Expected: 连接成功（`+ New` 出现）

Run: `.maestro\maestro.cmd test .maestro\flows/l3-core-chat.yaml`
Expected: PASS（聊天主链路在新栈可用）

**Step 5: 记录四门结果到 Task 8 的合并信息里**（无源码改动，无 commit）

---

### Task 7: ratex 升 0.1.14 + 回原生 markdown 计划跑 Gate A'

**Files:**
- Modify: `apps/mobile/package.json` + `pnpm-lock.yaml`
- Modify: `docs/plans/2026-09-23-native-markdown-engine-design.md`（Gate A' 附录回填，归原生计划管辖）

**Step 1: ratex 升到 README 推荐版（新栈下 peer 才满足）**

Run: `pnpm --dir apps/mobile add ratex-react-native@0.1.14`
Expected: 无 peer error（`react >=19.2.0` / `react-native >=0.84.0` 现在都满足）。

**Step 2: 重建 + 装包（RN0.86 下 nitro 栈应能过 `compileReleaseKotlin`）**

复用 Task 3 的 `build-rn-upgrade.bat` 后台构建 + 轮询 → Expected `EXIT=0`。
装 release 包：`adb -s emulator-5554 install -r apps\mobile\android\app\build\outputs\apk\release\app-release.apk` → `Success`。

**Step 3: 跑原生计划的 Gate A'（原样执行 `2026-09-23-native-markdown-engine.md` 的 Task 4 全部步骤）**

要点：flag 翻 native → 构建装包 → `.maestro\flows\tmp-md-connect.yaml` 连接 →
```powershell
$env:MODE='text'; $env:SECTIONS='60'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
$env:MODE='code'; $env:SECTIONS='25'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
```
Expected: **JS CPU 相对 A 组（legacy 同批次）≥−50%** 且运行不崩 → Gate A' 通过，附录回填到原生计划文档。

**Step 4: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml docs/plans/2026-09-23-native-markdown-engine-design.md
git commit -m "chore(mobile): ratex 0.1.14 on new stack + record Gate A' results"
```
（若 Gate A' 判负：**不 commit**，按原生计划 Task 5 分支重新决策——本任务到此为止，别自行处理。）

---

### Task 8: 收尾 — merge 回 main + 恢复原生计划执行

**Files:** 无（分支操作）

**Step 1: 分支全绿确认（Task 6 四门 + Task 7 Step 2 构建）**

Run: `git log --oneline main..rn-upgrade-0.86`
Expected: 列出本计划全部任务 commit。

**Step 2: 合并回 main（回滚窗口就此关闭）**

Run:
```
git checkout main
git merge --no-ff rn-upgrade-0.86 -m "merge: RN 0.86.3 + React 19 upgrade (Gate C)"
git push origin main
```
Expected: merge 成功并推送；`git status -sb` 显示与 origin 同步。

**Step 3: 交接回原生 markdown 计划**

- 原生计划状态更新：附录「后续所需 RN 版本」已满足 → 从其 **Task 6** 继续（主题/renderers/验收/e2e/收尾）；
- 更新本升级计划末尾「状态：✅ 完成 + 日期 + Gate A' 结果链接」并 commit：
```bash
git add docs/plans/2026-09-23-rn-upgrade.md
git commit -m "docs(rn-upgrade): mark upgrade done, link Gate A' outcome"
git push origin main
```

---

## 备注：已知限制（执行时不要"修"）

1. **不要顺手修 25 个既有 tsc 错误 / 2 个既有 jest 失败**——它们是验收基线，动了就说不清是升级引入的还是顺手改的。
2. RNTL 不主动升（R2）；`metro-react-native-babel-preset` 不删（R5）；blob-util 不换库（R1 阶梯 3 为止，换库是新立项）。
3. 业务代码除 React19 类型错误外一律不动（升级任务不夹带重构）。
4. 构建/端口/日志纪律同 AGENTS：后台构建、`logs/build/`、测试段端口。
5. main 在 Task 8 merge 前不接受任何升级相关改动——回滚 = 弃分支，别做逆向补丁。

---

## 执行状态（2026-09-23 回填）

- **✅ 完成并已合入 main**（merge commit `fcd377f`，已 push；分支 `rn-upgrade-0.86` 保留）。
  Task 1–6 四门全绿：jest `2 failed / 1103 passed`（基线不变）、tsc `11 ≤ 25`（零新增，
  一处 `renameSession` 显式标注连锁解开 16 个类型错）、`assembleRelease EXIT=0`（7m50s/312 tasks）、
  connect 冒烟 5/5 + `l3-core-chat` PASS。
- **Task 7 Gate A'：性能判据 FAIL（判负）**——2×2 双轮数据与归因见
  `2026-09-23-native-markdown-engine-design.md` 附录。处置（用户决策）：**C1 留在 flag 后**，
  默认 `MARKDOWN_ENGINE='legacy'`（零行为变化）；后续优化另行立项（MarkdownStream 定制
  `renderMarkdown` 做冻结块 / `updateStrategy=interval` 降频 / listener 只刷尾部块）。
  原生计划 Task 6–10 随之搁置。
- ratex 已升 `0.1.14`（README 推荐版本，新栈下 peer 满足）。
- 执行期发现并处置的升级坑（均已入对应 commit）：`react-native` 0.86 不再自带 hermesc
  → 新增直接依赖 `hermes-compiler`（pnpm isolated 布局 vs gradle 扁平路径）；metro 0.84 默认
  打开 package exports → 关回（zustand esm 的 `import.meta` 过不了 hermesc）；RTR19 的
  `create` 初始渲染推迟到 act → `jest.setup.js` 统一垫片。
- **机器级环境适配（刻意未进仓库）**：`~/.gradle/gradle.properties` 把 Gradle Plugin Portal
  重定向到阿里云镜像（本环境 plugins.gradle.org 握手被重置）；Gradle 9.3.1 发行包经腾讯云镜像
  预置进 `~/.gradle/wrapper/dists` 缓存（services.gradle.org 直连超时）。
