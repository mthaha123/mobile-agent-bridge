# Native Markdown Engine (C1/C2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把流式 markdown 解析移出 JS 线程（原生引擎），在不破坏渲染契约与 e2e 的前提下，流式场景 JS 线程 CPU 相对同批次基线降 ≥50%，并保留可回滚的 legacy 路径。

**Architecture:** `MarkdownRenderer` 公开入口不变，按编译期开关 `MARKDOWN_ENGINE`（`legacy`/`native`）分发到新组件 `NativeMarkdown`；`NativeMarkdown` 用 nitro session 做**后缀差量 append / 整篇 reset** 的流式驱动，渲染走 `MarkdownStream`，`renderers` 注入我们现成的 `MarkdownCodeBlock`/`MarkdownTable` 保住横滑与表格契约；chatStore/coalescer 零改动。

**Tech Stack:** react-native-nitro-markdown 0.12.4 + react-native-nitro-modules 0.37.1 + ratex-react-native 0.1.8（pin 旧版避开 React19/RN0.84 peer，见设计文档 §2.2）/ RN 0.76.9 + newArch + Hermes / Jest + react-test-renderer / 打桩 harness（mock-bridge + jank-probe）。

**设计文档（决策依据 / 兼容性事实 / 风险）：** `docs/plans/2026-09-23-native-markdown-engine-design.md`

---

## 约束（来自 AGENTS.md，必须遵守）

- 每条 bash < 3s 或 fire-and-forget；**构建必须后台** `Start-Process` + 短轮询日志（禁止同步 gradlew）。
- 日志一律写 `logs/build/`；临时 adb dump/flow 用完即删；提交前 `git status` 无杂散文件。
- **端口只用测试段**：mock bridge `8081/18081`，绝不碰 `8080/4097/4100-4109`（生产）。
- 每个行为变更配单测；在 `main` 上按任务提交（仓库惯例）。
- 每任务 = 一个 commit。执行顺序 **Task 0 → 10**，条件任务已标注。

### 备注：已知限制（执行时不要"修"）

1. 模拟器 **GPU-bound**（app 自身 CPU ~20%）：帧时不是主判据，**主判据 = JS 线程 CPU 时间的同批次 A/B**；不要试图把 p90 修到 <16ms。
2. legacy 路径的三连优化（冻结块/围栏零解析/useDeferredValue）**全部保留**，flag 切回即回滚。
3. **不改** `chatStore` / `streamDeltaCoalescer` / `MessageItem` 的内容管道：`content` 整串传入，差量 diff 收敛在 `NativeMarkdown` 内。
4. 判负回滚必须走 Task 5 的 revert commit，不要"顺手"留一半依赖。

---

### Task 0: 打桩 harness 入库（后续所有验收依赖它）

**Files:**
- Create: `scripts/e2e/jank-probe.mjs`（从 `logs/build/jank-probe.mjs` 拷入）
- Create: `scripts/e2e/stream-stub.mjs`（从 `logs/build/mock-stream.mjs` 拷入）

**Step 1: 拷贝两个脚本**

```powershell
Copy-Item logs\build\jank-probe.mjs scripts\e2e\jank-probe.mjs
Copy-Item logs\build\mock-stream.mjs scripts\e2e\stream-stub.mjs
```

**Step 2: 改 jank-probe 的子进程路径**（原指向 logs/build）

在 `scripts/e2e/jank-probe.mjs` 中把 spawn 参数
`['logs/build/mock-stream.mjs']` 改为 `['scripts/e2e/stream-stub.mjs']`（共 1 处）。

**Step 3: 文件头补用法注释**（`stream-stub.mjs` 顶部追加）

```js
// 用法: MODE=text|plain|code SECTIONS=<节数> RATE=<次/秒> SECONDS=<秒> SESSION_ID=mock_s1 node scripts/e2e/stream-stub.mjs
// text=富 markdown（60 节 ≈17k） plain=纯文本 code=未闭合围栏（SECTIONS=25 ≈16.6k）
```

**Step 4: 冒烟确认脚本可跑**

Run: `node -e "require('fs').accessSync('scripts/e2e/jank-probe.mjs'); require('fs').accessSync('scripts/e2e/stream-stub.mjs'); console.log('ok')"`
Expected: `ok`

**Step 5: Commit**

```bash
git add scripts/e2e/jank-probe.mjs scripts/e2e/stream-stub.mjs
git commit -m "test(e2e): promote streaming jank harness to scripts/e2e"
```

---

### Task 1: Gate B 记证（C2 依赖层判决，写进设计文档附录）

**Files:**
- Modify: `docs/plans/2026-09-23-native-markdown-engine-design.md`（§6 附录）

**Step 1: 重跑三条 `npm view` 留证（结论应与 §2.3 一致）**

Run: `npm view react-native-worklets@0.10.0 peerDependencies && npm view react-native-streamdown@0.3.0 peerDependencies && npm view react-native-worklets@0.12.0 peerDependencies`
Expected: 输出包含 `react-native: '0.83 - 0.86'`、`react-native-worklets: '>=0.10.0'`、`react-native: '0.83 - 0.87'`。

**Step 2: 回填附录 Gate B**

在附录块写入：
```
- Gate B 结果：C2 硬阻塞 —— streamdown 要求 worklets>=0.10，其 peer 为 RN 0.83-0.86 ⇒ 需 RN 升级（React 19.2+）
```

**Step 3: Commit**

```bash
git add docs/plans/2026-09-23-native-markdown-engine-design.md
git commit -m "docs(native-md): record Gate B evidence (C2 requires RN>=0.83)"
```

---

### Task 2: 安装 C1 三连依赖（精确版本）

**Files:**
- Modify: `apps/mobile/package.json` + `pnpm-lock.yaml`

**Step 1: 安装（pin ratex 0.1.8，避开 React19/RN0.84 peer）**

Run: `pnpm --dir apps/mobile add react-native-nitro-markdown@0.12.4 react-native-nitro-modules@0.37.1 ratex-react-native@0.1.8`
Expected: 安装成功；若 pnpm 报 peer 警告/错误 → **原样记入附录 Gate A**，不加 `--force`、不改 peer 覆盖。

**Step 2: 确认版本钉住**

Run: `node -e "const p=require('./apps/mobile/package.json');console.log(p.dependencies['react-native-nitro-markdown'],p.dependencies['react-native-nitro-modules'],p.dependencies['ratex-react-native'])"`
Expected: `0.12.4 0.37.1 0.1.8`

**Step 3: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "chore(mobile): install react-native-nitro-markdown stack (C1 spike)"
```

---

### Task 3: M1 引擎开关 + `NativeMarkdown` 骨架（含流式差量 diff）

**Files:**
- Create: `apps/mobile/src/config/markdownEngine.ts`
- Create: `apps/mobile/src/components/chat/NativeMarkdown.tsx`
- Create: `apps/mobile/__mocks__/react-native-nitro-markdown.js`
- Test: `apps/mobile/__tests__/NativeMarkdown.test.tsx`
- Modify: `apps/mobile/src/components/chat/MarkdownRenderer.tsx`（分发）
- Test: `apps/mobile/__tests__/MarkdownRenderer.test.tsx`（分发断言）

**Step 1: 写 jest mock（node_modules 邻接规则，同 `react-native-blob-util` 惯例，自动生效）**

创建 `apps/mobile/__mocks__/react-native-nitro-markdown.js`：

```js
/** react-native-nitro-markdown 的 jest mock（原生模块在 jsdom 环境不可用） */
const appended = []
let resetTo = null

const mockSession = {
  getSession: () => ({ append: (s) => { appended.push(s) } }),
  reset: (t) => { resetTo = t },
}

module.exports = {
  __esModule: true,
  // 组件以字符串形式导出 → react-test-renderer 里可按 type 找到
  MarkdownStream: 'MarkdownStream',
  Markdown: 'Markdown',
  useMarkdownSession: () => mockSession,
  __mock: { appended, get resetTo() { return resetTo }, resetAll() { appended.length = 0; resetTo = null } },
}
```

**Step 2: 写失败测试 `NativeMarkdown.test.tsx`**

```tsx
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { NativeMarkdown } from '../src/components/chat/NativeMarkdown'

const nitro = require('react-native-nitro-markdown')
const mock = nitro.__mock

function render(content: string) {
  let tree!: TestRenderer.ReactTestRenderer
  act(() => { tree = TestRenderer.create(<NativeMarkdown content={content} />) })
  return tree
}
function streamNodes(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll((n: any) => n.type === 'MarkdownStream')
}

beforeEach(() => mock.resetAll())

describe('NativeMarkdown（原生引擎骨架）', () => {
  it('首帧 reset 全文（lastRef 从空开始）', () => {
    const tree = render('# Hello')
    expect(mock.resetTo).toBe('# Hello')
    expect(mock.appended).toEqual([])
    expect(streamNodes(tree).length).toBeGreaterThan(0)
  })

  it('后缀追加只把差量交给 session（增量 AST 复用路径）', () => {
    const tree = render('# Hello')
    act(() => { tree.update(<NativeMarkdown content="# Hello world" />) })
    expect(mock.appended).toEqual([' world'])
    expect(mock.resetTo).toBe('# Hello') // 没被覆盖
  })

  it('内容被替换（非前缀）→ 整篇 reset（历史加载/权威快照覆盖）', () => {
    const tree = render('# Hello')
    act(() => { tree.update(<NativeMarkdown content="完全不同的内容" />) })
    expect(mock.resetTo).toBe('完全不同的内容')
    expect(mock.appended).toEqual([])
  })

  it('append 抛错 → reset 兜底且不崩', () => {
    const tree = render('# Hello')
    nitro.useMarkdownSession = () => ({
      getSession: () => ({ append: () => { throw new Error('invalid_range') } }),
      reset: (t: string) => { mock.resetTo = t },
    })
    act(() => { tree.update(<NativeMarkdown content="# Hello+" />) })
    expect(mock.resetTo).toBe('# Hello+')
  })
})
```

Run: `cd apps/mobile && npx jest __tests__/NativeMarkdown.test.tsx`
Expected: FAIL — `Cannot find module '../src/components/chat/NativeMarkdown'`。

**Step 3: 实现**

创建 `apps/mobile/src/config/markdownEngine.ts`：

```ts
/**
 * Markdown 渲染引擎开关（M0 决策后翻转，见设计文档 §6）。
 * legacy = react-native-marked 冻结块三连优化（现网）
 * native = react-native-nitro-markdown（原生 C++ 解析 + session 增量流式）
 */
export type MarkdownEngine = 'legacy' | 'native'

export const MARKDOWN_ENGINE: MarkdownEngine = 'legacy'
```

创建 `apps/mobile/src/components/chat/NativeMarkdown.tsx`：

```tsx
/**
 * NativeMarkdown — C1 原生引擎流式渲染。
 *
 * 增量策略：store 侧只给整串 content（不改管道）；本组件维护 lastRef，
 *  - 新内容是旧内容的严格后缀（流式增长）→ 只 append 差量（原生增量 AST 复用）
 *  - 否则（首帧 / 权威快照覆盖 / 切会话历史）→ session.reset 整篇
 *  - append 失败（如非法 range）→ reset 兜底，不向上抛
 * ⚠️ 只用 append(string)/reset(text)，不用 getTextRange()/replace()：
 *    session range 是 UTF-16 码元，跨 emoji 会报 invalid_range。
 */
import React, { memo, useEffect, useRef } from 'react'
import { MarkdownStream, useMarkdownSession } from 'react-native-nitro-markdown'

export interface NativeMarkdownProps {
  content: string
}

export const NativeMarkdown: React.FC<NativeMarkdownProps> = memo(({ content }) => {
  const session = useMarkdownSession()
  const lastRef = useRef('')

  useEffect(() => {
    const last = lastRef.current
    if (content === last) return
    try {
      if (last && content.startsWith(last) && content.length > last.length) {
        session.getSession().append(content.slice(last.length))
      } else {
        session.reset(content)
      }
    } catch {
      session.reset(content)
    } finally {
      lastRef.current = content
    }
  }, [content, session])

  return <MarkdownStream session={session} updateStrategy="raf" incrementalParsing />
})
```

**Step 4: MarkdownRenderer 分发**

在 `MarkdownRenderer.tsx`：新增 import
`import { MARKDOWN_ENGINE, type MarkdownEngine } from '../config/markdownEngine'` 与
`import { NativeMarkdown } from './NativeMarkdown'`；把文件末尾导出

```ts
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = MarkdownRendererInner
```

改为：

```ts
export interface MarkdownRendererDispatchProps extends MarkdownRendererProps {
  /** 默认取全局开关；测试可用它显式覆盖 */
  engine?: MarkdownEngine
}

/**
 * 公开入口：按引擎开关分发。
 * ⚠️ 导出必须保持**普通具名函数**（不能被 memo 包住）：react-test-renderer 的
 * findAllByType(MarkdownRenderer) 依赖 fiber.type 即组件本体。
 */
export const MarkdownRenderer: React.FC<MarkdownRendererDispatchProps> = ({
  content,
  engine = MARKDOWN_ENGINE,
}) => (engine === 'native'
  ? <NativeMarkdown content={content} />
  : <MarkdownRendererInner content={content} />)
```

（保留原导出上方的长注释，挪到新导出上。）

**Step 5: 分发测试（`MarkdownRenderer.test.tsx` 顶部 describe 内追加）**

```tsx
it('engine=native 分发到原生引擎（渲染 MarkdownStream）', () => {
  const tree = TestRenderer.create(<MarkdownRenderer content="# Hi" engine="native" />)
  expect(tree.root.findAll((n: any) => n.type === 'MarkdownStream').length).toBeGreaterThan(0)
})

it('engine=legacy 走冻结块路径（无 MarkdownStream）', () => {
  const tree = TestRenderer.create(<MarkdownRenderer content="# Hi" engine="legacy" />)
  expect(tree.root.findAll((n: any) => n.type === 'MarkdownStream').length).toBe(0)
})
```

**Step 6: 全量验证**

Run: `cd apps/mobile && npx jest __tests__/NativeMarkdown.test.tsx __tests__/MarkdownRenderer.test.tsx`
Expected: 全 PASS。再跑 `cd apps/mobile && npx jest --silent` → 只剩 2 个既有失败（ChatScreen 模型选择 / SessionsScreen rename）。

**Step 7: Commit**

```bash
git add apps/mobile/src/config/markdownEngine.ts apps/mobile/src/components/chat/NativeMarkdown.tsx apps/mobile/src/components/chat/MarkdownRenderer.tsx apps/mobile/__mocks__/react-native-nitro-markdown.js apps/mobile/__tests__/NativeMarkdown.test.tsx apps/mobile/__tests__/MarkdownRenderer.test.tsx
git commit -m "feat(mobile): markdown engine flag + NativeMarkdown incremental session adapter"
```

---

### Task 4: Gate A — C1 在 RN 0.76 上的构建/运行/打桩 A-B（决策门）

**Files:**
- Modify: `apps/mobile/src/config/markdownEngine.ts`（临时翻 `native`，测完翻回）
- Modify: `docs/plans/2026-09-23-native-markdown-engine-design.md`（附录回填）

**前置检查**（逐条，任何一条不满足先补）：
- 模拟器在线：`adb devices` → 至少 1 台 `device`。
- mock bridge 在跑：`netstat -ano | findstr :8081` → LISTENING；否则 fire-and-forget：
  `Start-Process -WindowStyle Hidden -FilePath cmd -ArgumentList '/c node scripts\e2e\mock-bridge.mjs > logs\build\mock-bridge-8081.log 2>&1' -WorkingDirectory 'D:\code\mobile-agent-bridge'`
- **A 组基线（当前 HEAD 包，flag=legacy）先测**——保证同批次对照。

**Step 1: A 组基线（当前已安装包即可，无需构建）**

```powershell
$env:MODE='text'; $env:SECTIONS='60'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
$env:MODE='code'; $env:SECTIONS='25'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
```
把两行 `JS thread CPU-time delta` + `p90/p95` 记入临时笔记（附录回填用）。
Expected（参考值，允许波动）: text ≈2.87s、code ≈2.75s，p90 ≈53ms。
> 若包不是 HEAD 构建（`Test-Path` APK 时间早于 3a5369c），先按 Step 2 的后台构建打一次 flag=legacy 的包再测。

**Step 2: 后台构建（自包含 bat，不依赖机器上临时文件；release 首次含新原生依赖**不加 `--offline`**）**

```powershell
$bat = 'D:\code\mobile-agent-bridge\logs\build\build-md-gate.bat'
$log = 'D:\code\mobile-agent-bridge\logs\build\build-md-gate.log'
@"
cd /d D:\code\mobile-agent-bridge\apps\mobile\android
set GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx2048m -Dorg.gradle.daemon=false
call gradlew.bat assembleRelease --no-daemon > $log 2>&1
echo EXIT=%ERRORLEVEL% >> $log
"@ | Set-Content $bat -Encoding ascii
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -FilePath cmd -ArgumentList "/c `"$bat`""
Write-Output 'build started'
```
Expected: `build started` 立即返回（绝不同步等 gradlew）。

**Step 3: 轮询日志（每条 ≤15s，反复执行直到 EXIT= 出现）**

```powershell
for($i=0;$i -lt 16;$i++){ Start-Sleep -Seconds 8; if(Select-String -Path logs\build\build-md-gate.log -Pattern 'EXIT=' -Quiet -ErrorAction SilentlyContinue){ break } };
if(Select-String -Path logs\build\build-md-gate.log -Pattern 'EXIT=' -Quiet){ Write-Output 'BUILD DONE'; Get-Content logs\build\build-md-gate.log -Tail 3 } else { Write-Output 'still building'; Get-Content logs\build\build-md-gate.log -Tail 3 }
```
Expected: `EXIT=0` + `BUILD SUCCESSFUL`。
**若失败**：读日志，区分 (a) peer/codegen/CMake 问题 → 按 (失败路径) 走 Task 5；(b) 本项目代码错误 → 修复后重跑本步。

**Step 4: flag 临时翻 native**

`apps/mobile/src/config/markdownEngine.ts`: `'legacy'` → `'native'`（此 commit 不提交，保持工作区可回退）。
重跑 Step 2/3 构建（这次**同样不加 offline**；若依赖已进缓存可自行加）。

**Step 5: 安装 + 连接 + 进 Session 1**

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" -s emulator-5554 install -r apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```
连接（临时 flow，Task 10 结束前删除）`\.maestro\flows\tmp-md-connect.yaml`：
```yaml
appId: com.mobileagentbridge
---
- launchApp
- tapOn:
    text: "Connect"
    optional: true
- extendedWaitUntil:
    visible: "Session 1"
    timeout: 25000
- tapOn: "Session 1"
- extendedWaitUntil:
    visible: "Type a message..."
    timeout: 15000
```
Run: `.\.maestro\maestro.cmd test .maestro\flows\tmp-md-connect.yaml`
Expected: 5 步全 `COMPLETED`（启动不崩 = JSI/Nitro 挂载成功 = **Gate A 运行关通过**）。

**Step 6: B 组量测（与 Step 1 完全相同参数）**

```powershell
$env:MODE='text'; $env:SECTIONS='60'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
$env:MODE='code'; $env:SECTIONS='25'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
```

**Step 7: 判据 → 回填附录 → commit**

判据（设计文档 §6 Gate A）：
- **通过**：两场景 JS CPU 相对 A 组 **≥−50%**（text ≤1.5s、code ≤1.4s 量级），p90/p95 不劣化 >20%；若 A/B 波动 <30% → 各再跑一轮取中位。
- **判负**：构建/运行失败，或 JS CPU 下降 <30% → 跳 **Task 5（判负回滚）**，本任务剩余步骤跳过。

附录回填模板：
```
- Gate A 结果：构建=EXIT 0/失败点；运行=5步COMPLETED；JS CPU A组 text=x s / code=x s → B组 text=x s / code=x s（−xx%）
```
Flag 翻回 `'legacy'`（保默认安全），**回填文档与 flag 分两次提交**：

```bash
git add docs/plans/2026-09-23-native-markdown-engine-design.md
git commit -m "docs(native-md): record Gate A A/B results in appendix"
```

---

### Task 5（条件任务）: Gate A 判负回滚 或 Gate C RN 升级门

**分支 A —— 判负回滚（Gate A 失败且暂不升级时执行）**

**Files:** `apps/mobile/package.json`、`pnpm-lock.yaml`、`apps/mobile/src/components/chat/MarkdownRenderer.tsx`、`NativeMarkdown.tsx`、`markdownEngine.ts`、两个 test、`__mocks__`

Step 1: 删除 NativeMarkdown / markdownEngine / mock / 两个测试文件中与引擎相关部分，`MarkdownRenderer.tsx` 恢复为 `export const MarkdownRenderer = MarkdownRendererInner`。
Step 2: `pnpm --dir apps/mobile remove react-native-nitro-markdown react-native-nitro-modules ratex-react-native`
Step 3: `cd apps/mobile && npx jest --silent` → 只剩 2 个既有失败。
Step 4: `git add -A && git commit -m "revert(mobile): rollback C1 spike (Gate A failed)"`；设计文档附录记「判负原因 + 转降级 B1 或 Gate C」。

**分支 B —— 需要 RN 升级（选 C2，或 C1 要求新栈）**

⚠️ **本任务是独立立项级工作，BLOCKING Task 6+**。只列门与验收，不在本计划展开：
- 升级目标：**C2 → RN 0.83.x + React ^19.2.0；C1(新栈) → RN 0.86.3 + React ^19.2.3**（peer 见设计 §2.2/2.3）。
- 迁移工具：RN 官方 upgrade-helper 逐项 diff（package.json、gradle wrapper/AGP、MainApplication.kt、codegen、`@react-native/*` 版本族）。
- **验收门**：`cd apps/mobile && npx jest --silent` 既有 2 失败不新增 + `assembleRelease` EXIT=0 + maestro `shared/connect.yaml` 连接冒烟 + 现有 e2e 至少 `l3-core-chat` 过。
- 升级完成回到本计划 **Task 4 重跑 Gate A'**（新栈复测 C1）或直接进 C2 选型。
- 单独开计划文档：`docs/plans/2026-MM-DD-rn-upgrade.md`（本文件不承载）。

---

### Task 6: M2a — 主题色映射 + onError 回退（TDD）

**Files:**
- Modify: `apps/mobile/src/components/chat/NativeMarkdown.tsx`
- Test: `apps/mobile/__tests__/NativeMarkdown.test.tsx`

**Step 1: 写失败测试**（追加进 `NativeMarkdown.test.tsx`）

```tsx
it('styles 映射 app 主题色（text/code_block/link/border）', () => {
  const tree = render('# Hi')
  const node = streamNodes(tree)[0]
  const s = node.props.styles || {}
  expect(s.text).toBeDefined()
  expect(s.code_block).toBeDefined()
  expect(s.link).toBeDefined()
  expect(s.blockquote).toBeDefined()
})

it('解析失败回退渲染原始文本', () => {
  const tree = render('坏掉的内容 <<')
  act(() => { streamNodes(tree)[0].props.onError?.() })
  expect(String(streamNodes(tree)[0]?.parent?.parent ? 'x' : '')).toBeDefined()
  const texts = tree.root.findAll((n: any) => typeof n.type !== 'string' && JSON.stringify(n.props || {}).includes('坏掉的内容'))
  expect(texts.length).toBeGreaterThan(0)
})
```

Run: `cd apps/mobile && npx jest __tests__/NativeMarkdown.test.tsx -t "styles 映射"` → Expected FAIL（无 styles prop）。

**Step 2: 实现**

`NativeMarkdown.tsx` 追加：

```tsx
import { Text, StyleSheet } from 'react-native'
import { useThemeColors } from '../../theme/ThemeContext'
// 组件内：
const colors = useThemeColors()
const [failed, setFailed] = useState(false)
const styles = useMemo(() => ({
  text: { color: colors.markdownText },
  code_block: { backgroundColor: colors.markdownCodeBg },
  link: { color: colors.markdownLink },
  blockquote: { borderColor: colors.markdownBorder },
}), [colors.markdownText, colors.markdownCodeBg, colors.markdownLink, colors.markdownBorder])
// 渲染处：
if (failed) return <Text style={stylesPlain}>{content}</Text>
return <MarkdownStream
  session={session}
  updateStrategy="raf"
  incrementalParsing
  styles={styles}
  onError={() => setFailed(true)}
/>
```
（`stylesPlain = StyleSheet.create({ fallback: { fontSize: 14, lineHeight: 22 } })`，与 legacy `styles.fallback` 一致。）

> ⚠️ `styles` 的 key（`text/code_block/link/blockquote`）与 `MarkdownStream` 是否接受该 prop，
> 以实现时**核对** `react-native-nitro-markdown` 的 `docs/api-reference.md`/`docs/customization.md`
> 为准；不一致 → 改本步代码并同步改测试（key 名不是本仓库的契约，渲染结果才是）。

**Step 3: 跑通**

Run: `cd apps/mobile && npx jest __tests__/NativeMarkdown.test.tsx --silent`
Expected: 全 PASS。

**Step 4: Commit**

```bash
git add apps/mobile/src/components/chat/NativeMarkdown.tsx apps/mobile/__tests__/NativeMarkdown.test.tsx
git commit -m "feat(mobile): native markdown theme mapping + parse-error fallback"
```

---

### Task 7: M2b — renderers 注入（代码块/表格契约，保住 e2e）

**Files:**
- Modify: `apps/mobile/src/components/chat/NativeMarkdown.tsx`
- Test: `apps/mobile/__tests__/NativeMarkdown.test.tsx`

**Step 1: 写失败测试**（追加）

```tsx
it('注入 renderers：code_block 与 table 走我们现成的组件（横滑/全屏契约）', () => {
  const tree = render('```ts\nconst a = 1\n```')
  const node = streamNodes(tree)[0]
  expect(typeof node.props.renderers).toBe('object')
  expect(typeof node.props.renderers.code_block).toBe('function')
  expect(typeof node.props.renderers.table).toBe('function')
})
```

Run: `cd apps/mobile && npx jest __tests__/NativeMarkdown.test.tsx -t "注入 renderers"` → Expected FAIL。

**Step 2: 实现**

```tsx
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { MarkdownTable } from './MarkdownTable'
// 渲染处追加：
renderers={{ code_block: MarkdownCodeBlock as any, table: MarkdownTable as any }}
```
> ⚠️ renderer **node key 名**以 api-reference 为准（README 风格示例是 `code_block`/`blockquote`；
> 表格 key 可能是 `table` 或 `table_block`）——实现时打开
> `react-native-nitro-markdown/docs/api-reference.md` 的 renderer 列表核对；
> 另需核对 renderer 的**入参签名**（我们组件要的是 `{ text }` / `{ header, rows }`），
> 不匹配时在 `NativeMarkdown` 内写**薄包装函数**做适配（例如 `table_block: (node) => <MarkdownTable header={node.header} rows={node.rows} key={node.beg} />`），
> **不允许**为此改 `MarkdownCodeBlock/MarkdownTable` 的对外 props。

**Step 3: 跑通** → `npx jest __tests__/NativeMarkdown.test.tsx` 全 PASS。

**Step 4: Commit**

```bash
git add apps/mobile/src/components/chat/NativeMarkdown.tsx apps/mobile/__tests__/NativeMarkdown.test.tsx
git commit -m "feat(mobile): inject legacy code/table renderers into native markdown"
```

---

### Task 8: M2 验收 — flag=native 打桩终测（回填性能表）

**Files:** `docs/plans/2026-09-23-native-markdown-engine-design.md`（§4 表旁补 native 列）

**Step 1: flag 翻 `native` + 后台构建 + 轮询 + 安装 + 连接**
（复用 Task 4 的 Step 2–5 命令原文，bat 文件名改为 `build-md-accept.bat`/`.log` 以免覆盖日志。）

**Step 2: 两场景各跑两轮取中位**

```powershell
$env:MODE='text'; $env:SECTIONS='60'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
$env:MODE='code'; $env:SECTIONS='25'; $env:SESSION_ID='mock_s1'; node scripts\e2e\jank-probe.mjs 12 25
```
（每场景连跑 2 次，共 4 次；记录 `JS thread CPU-time delta` / `p90` / `p95` / `High input latency` 中位数。）

**Step 3: 对照判据**

| 指标 | 通过条件 |
|---|---|
| text JS CPU | ≤ Task 4 A 组的 50% |
| code JS CPU | ≤ Task 4 A 组的 50% |
| p90 / p95 | 不比 A 组劣化 >20% |
| High input latency 帧数 | 不增 |

Expected: 达标 → Step 4；不达标 → 回 Task 6/7 找原因（先查是否退回整篇 reset 路径：看 `NativeMarkdown` diff 是否命中 append），仍不达标且疑似引擎本身 → 转设计文档 Gate C/降级 B1 讨论。

**Step 4: 回填 + Commit**

```bash
git add docs/plans/2026-09-23-native-markdown-engine-design.md apps/mobile/src/config/markdownEngine.ts
git commit -m "docs(native-md): record native-engine acceptance A/B + flip flag to native"
```

---

### Task 9: M3 — e2e 回归（渲染契约）

**Files:** 无源码改动（失败才回 Task 7 修适配层）；`.maestro/flows/tmp-md-connect.yaml` 仍在

**Step 1: 单测全量 + 类型检查（只看新增错误）**

Run: `cd apps/mobile && npx jest --silent`
Expected: 仍为既有 2 失败，不新增。

Run: `cd apps/mobile && npx tsc --noEmit 2>&1 | findstr NativeMarkdown`（PowerShell: `Select-String NativeMarkdown`）
Expected: 无输出。

**Step 2: 代码块横滑契约（native 渲染下）**

Run: `node scripts\e2e\stub-code-scroll.mjs --scenario text`（已连 mock + Session 1 的状态沿用）
Expected: `=> PASS`（横滑生效 = `HorizontalScrollView`+`TextView` 结构仍在 = renderers 注入成功）。
失败 → 检查 renderer key/入参（Task 7 Step 2 的核对是否落实），修复后重跑。

**Step 3: 表格契约**

Run: `.maestro\maestro.cmd test .maestro\flows\l2-md-table-chat.yaml`
Expected: PASS。失败且确认是原生表格 renderer 不兼容 → 按 Task 7 的**薄包装**方式适配（不改组件对外 props），修复后重跑。

**Step 4: 不受影响项抽查**

Run: `.maestro\maestro.cmd test .maestro\flows\l3-core-chat.yaml`
Expected: PASS（聊天主链路无回归）。

**Step 5: Commit（如有适配修复）**

```bash
git add -A
git commit -m "fix(mobile): adapt native renderers to keep code/table contracts"
```
（无改动则本任务不产生 commit，跑通即过。）

---

### Task 10: 收尾 — flag 默认 native 确认 + 全量验证 + 清理 + push

**Files:**
- Modify: `apps/mobile/src/config/markdownEngine.ts`（若 Task 8 后又被翻回，最终必须是 `'native'`）
- Delete: `.maestro/flows/tmp-md-connect.yaml`
- Modify: `docs/plans/2026-09-23-native-markdown-engine-design.md`（里程碑状态 M0–M3 → ✅）

**Step 1: 确认最终状态**

Run: `node -e "console.log(require('fs').readFileSync('apps/mobile/src/config/markdownEngine.ts','utf8').match(/'legacy'|'native'/g).pop())"`
Expected: `'native'`

**Step 2: 全量验证**

Run: `cd apps/mobile && npx jest --silent` → Expected: 仅既有 2 失败。
Run: `git status --short` → Expected: 仅预期改动，无 `.log/.xml/.png` 杂散（logs/ 已 gitignore）。

**Step 3: 删临时 flow**

```powershell
Remove-Item .maestro\flows\tmp-md-connect.yaml -ErrorAction SilentlyContinue
```

**Step 4: 设计文档里程碑回填 + Commit + Push**

```
- M0 ✅ Gate A 通过（附录数据）；Gate B 记证；未触发 Gate C
- M1 ✅ 引擎开关 + 适配骨架
- M2 ✅ 流式 diff + 主题 + renderers + 打桩验收达标
- M3 ✅ e2e 回归绿，flag=native
- M4 ⬜ legacy 移除 + 死依赖清理（react-native-markdown-display；react-native-marked 视情况）——另行小任务
```

```bash
git add -A
git commit -m "docs(native-md): mark M0-M3 done; engine flag shipped as native"
git push origin main
```

---

## 备注：已知限制（执行时不要"修"）

- **模拟器 GPU-bound**：验收看 JS CPU A/B，不看帧率绝对值；p90 <16ms 不是本项目目标。
- `STREAM_DELTA_FLUSH_MS=120`、冻结块、围栏零解析、`useDeferredValue` 全部保留（legacy 可回切）。
- 不为原生引擎改 chatStore/coalescer/MessageItem 的内容管道；diff 只在 `NativeMarkdown` 内。
- iOS 无目录不在范围；Web 两库都不支持。
- C1 若判负走 Task 5 分支 A/B，**不留半套依赖**（pnpm remove + 源码回滚一次 commit 完成）。
