# 原生 Markdown 引擎（C1/C2）— 立项设计文档

> **日期**：2026-09-23
> **状态**：已立项，待 Task 0 Spike 决策门
> **配套实施计划**：`docs/plans/2026-09-23-native-markdown-engine.md`
> **上一阶段**：`docs/plans/2026-09-12-chat-scroll-ownership-design.md`（滚动归属）、
> 本地提交 `4eb8210` / `80cf87b` / `5a22e19` / `3a5369c`（渲染层增量优化四连）。

---

## 1. 背景与动机

### 1.1 已完成的三层 JS 层优化（现网基线）

流式卡顿已在 JS 侧做过四轮优化（commit 记录见上），每轮均有打桩实测：

| 优化 | commit | 实测效果 |
|---|---|---|
| 80→120ms delta 合并（`STREAM_DELTA_FLUSH_MS`） | `4eb8210` | 渲染次数 12.5/s → 8.3/s |
| `ChatMessageArea` 隔离流式订阅 + 列表 item 引用稳定 | `4eb8210` | 流式 flush 不再整屏重渲染 |
| 未闭合代码围栏零解析（`StreamingCodeTail`） | `80cf87b` | 代码场景 JS CPU 4.19s → 1.49s（−64%） |
| `useDeferredValue` 流式降级 + 纯文本尾部单节点 | `3a5369c` | 紧急输入可抢占流式渲染 |

**继续用 JS 解析的天花板**（社区 benchmark，react-native-nitro-markdown `docs/comparison.md`）：
237KB 文档 Marked ≈ 400ms vs md4c C++ ≈ 29ms（13.5x）。我们用的正是 `react-native-marked`
（内核 marked），**每次流式 flush 的尾部解析仍是纯 JS、仍占 JS 线程**。

### 1.2 本项目要解决的

把「markdown 解析」整体移出 JS 线程 —— 这是流式卡顿剩余成本里**唯一还没有动过的环节**：

- **C1 `react-native-nitro-markdown`**：C++ md4c + JSI 原生解析，**增量 AST 复用**（流式追加
  走原生 range 更新，不整篇重解析），渲染仍是真实 RN 组件，`renderers` 可整体替换节点渲染器
  （可无缝套我们现成的 `MarkdownCodeBlock` / `MarkdownTable`）。
- **C2 `react-native-streamdown`**：`react-native-enriched-markdown`（原生 md4c 解析）+
  `remend`（不完整 markdown 修复）+ `react-native-worklets` **Bundle Mode**，把处理放到
  worklet 后台线程，JS 线程全程空闲。

社区同类方案佐证：`software-mansion/enriched-markdown` issue #391（流式整篇重解析 → block 级增量
是公认最大优化点）、`markstream` 的 fence-atomic/live-node 窗口、`react-native-markdown-display`
#164 的增量渲染诉求。

---

## 2. 依赖兼容性事实（2026-09-23 实测 npm / 仓库）

### 2.1 我们的现状

| 项 | 值 |
|---|---|
| React Native | **0.76.9**（`newArchEnabled=true`、`hermesEnabled=true`） |
| React / react-test-renderer | **18.3.1** |
| 平台 | **仅 Android**（无 `apps/mobile/ios` 目录）；Windows 上构建（CMake/NDK 已跑通：ReactNativeBlobUtilSpec） |
| 包管理 / 工作区 | pnpm workspace；`metro.config.js` 有自定义 `nodeModulesPaths`（apps/mobile + 根 node_modules） |
| babel | `babel.config.js` 只有 `module:@react-native/babel-preset`（无 plugin 列表） |
| 当前 markdown 依赖 | `react-native-marked ^8.1.1`（现网引擎）；`react-native-markdown-display 7.0.2` **仅剩注释引用，疑似死依赖** |

### 2.2 C1 兼容性

| 包 | 版本 | peer 关键项 | 对我们 |
|---|---|---|---|
| `react-native-nitro-markdown` | 0.12.4（2026-09-10 发布） | RN `>=0.75.0`、`react-native-nitro-modules >=0.37 <0.38`、`ratex-react-native >=0.1.4`；**要求 New Arch** | RN 0.76.9 ✓ 新架构 ✓ |
| `react-native-nitro-modules@0.37.1` | — | peer `react *`、`react-native *` | 无阻碍 |
| `ratex-react-native@0.1.14`（README 推荐） | — | **`react >=19.2.0`、`react-native >=0.84.0`** | ✗ 与 React 18.3.1 / RN 0.76.9 冲突 |
| `ratex-react-native@0.1.4 ~ 0.1.8` | — | peer `react *`、`react-native *` | ✓ peer 无冲突（**未经上游验证** → Spike 要测的点） |

- 上游 README 标注的「runtime gate `0.86.3`」是其 CI 门槛，**不是 peer 硬依赖**；peer 下限是 RN 0.75。
- **结论：C1 存在一条「不升级 RN」的可试路径**：`react-native-nitro-markdown@0.12.4 +
  react-native-nitro-modules@0.37.1 + ratex-react-native@0.1.8`（pin 旧 ratex）。能否构建/运行，
  只有 Spike 能回答。

### 2.3 C2 兼容性（硬阻塞）

| 包 | 版本 | peer 关键项 | 对我们 |
|---|---|---|---|
| `react-native-streamdown` | 0.3.0（2026-09-04） | `react-native-enriched-markdown >=1.0.0`、**`react-native-worklets >=0.10.0`**、`remend 1.3.0`（精确） | 取决于 worklets |
| `react-native-worklets@0.10 / 0.11` | — | **`react-native: 0.83 - 0.86`** | ✗ 我们是 0.76.9 |
| `react-native-worklets@0.12` | — | `react-native: 0.83 - 0.87` | ✗ |
| `react-native-worklets@0.13` | — | `react-native: 0.86 - 0.88` | ✗ |
| `react-native-enriched-markdown` | 1.0.2 | `react-native *` + `katex >=0.16` | peer 无阻碍，但被 worklets 卡住 |

- **结论：C2 在依赖层面要求 RN ≥ 0.83**（streamdown 要求的最低 worklets 版本即 0.83-0.86）。
- 升级 RN 的连带效应：RN 0.83 peer 是 **React ^19.2.0**（0.86.3 是 ^19.2.3）→ 本项目还要连带
  **React 18 → 19**（`react-test-renderer`、`@types/react` 同步升）。
- C2 另有两个工程前提（来自官方 Bundle Mode setup guide）：
  1. `babel.config.js` 加 `react-native-worklets/plugin`（`bundleMode: true` +
     `importForwarding.moduleNames: ['remend']`）；
  2. `metro.config.js` 用 `getBundleModeMetroConfig` + watch `.worklets/` 目录 + **Metro 补丁**
     —— 官方原文：**"The one-shot `react-native bundle` command (offline release bundling)
     requires the patch"**。而我们的发布链路正是离线 `react-native bundle`（见 AGENTS.md），
     与自定义 `nodeModulesPaths` 配置叠加，是明确的风险点。

### 2.4 兼容性一句话结论

> **两条路都有 RN 升级风险，但严重度不同**：
> C1 =「先试 pin 旧 ratex 在 RN 0.76 上裸跑」（便宜、先试、可能零升级）；
> C2 =「**前置** RN 0.83+ / React 19 升级 + Metro/Babel 工程改造」（必然升级、改造面大）。

---

## 3. 需求（验收口径）

1. **流式解析出 JS 线程**：流式期间 markdown 解析不再占用 JS 线程（C1 为原生 C++；C2 为 worklet 线程）。
2. **渲染契约不破**（决定 e2e 是否要改）：
   - 代码块 = 横向 ScrollView + nestedScrollEnabled + 可横滑（`stub-code-scroll.mjs` 断言 `HorizontalScrollView` + 内部 `TextView` 锚点）；
   - 表格自适应列宽 + 全屏详情（`l2-md-table-chat` / `l2-md-table-file-viewer`）；
   - 主题色跟随 app 暗色：`markdownText` / `markdownCodeBg` / `markdownLink` / `markdownBorder`；
   - 解析失败回退可读文本（现网 `MarkdownChunk` 的 fallback 行为）；
   - 链接点击行为与现网一致（legacy 走 react-native-marked 的 linkPress；原生要核对 link/`imageOptions` 策略）。
3. **可回滚**：引擎用**编译期常量开关**切换（单文件），legacy 路径在 M4 前保留可切回。
4. **仅 Android**：iOS 无目录，不在本项目范围（后续要 iOS 时按两库平台矩阵另评估）。
5. **性能验收**（同一打桩 harness，release 包，Pixel_7 + ANGLE，12 次/s、CHUNK=80）：
   - **主指标**：24s 流式的 **JS 线程 CPU 时间** 相对同批次 baseline 降 ≥50%（原生解析出线程后理论上降到"纯渲染"水平）；
   - **副指标**：`p90/p95 帧时` 不劣化、`High input latency` 帧数不增；
   - 诚实边界：模拟器 GPU-bound（app 自身 CPU 仅 ~20%），帧时不是主判据，**同批次 A/B 对照**才算数。

---

## 4. 现网实测基线（3a5369c，release + ANGLE 模拟器 + mock 打桩）

| 场景 | 总帧 | p90 / p95 / p99 | JS CPU（24s 流） | main CPU |
|---|---|---|---|---|
| 空闲（对照） | 0 帧 | — | 0.00s | ~0.10s |
| 原生滚动（对照） | 765 帧/15s=51fps | GPU p90 21ms | — | — |
| 正文 markdown 17,124 字符 | 157 | 53 / 85 / 350ms | **2.87s** | 1.90s |
| 未闭合代码围栏 16,624 字符 | 214 | 53 / 97 / 200ms | **2.75s** | 1.87s |

> 同类指标历史波动区间 1.5–4.7s（模拟器噪声），**验收必须同批次对照**（baseline 构建 vs 引擎切换
> 构建，同日同环境各跑一次）。

---

## 5. 方案对比

| 维度 | C1 `react-native-nitro-markdown` | C2 `react-native-streamdown` |
|---|---|---|
| 解析位置 | **原生 C++（JSI 同步调用）** | 原生 md4c（enriched-markdown）+ worklet 后台线程 |
| 流式策略 | `MarkdownStream` + session，**增量 AST 复用**（追加不整篇重解析），`updateStrategy="raf"/"interval"` | `StreamdownText markdown={...}`，remend 修复不完整块 + 后台线程（仍整篇重解析，但**不占 JS 线程**） |
| 解析缺陷（对比 #391） | 有 range 级增量（`incrementalParsing`） | issue #391 就是 enriched-markdown 本尊，未做 block 增量（作者已回应在做） |
| 组件可替换性 | `renderers={{ code_block, table }}` 整节点替换 + `styles`/`theme` 分层 | 继承 EnrichedMarkdownText 的组件体系（本次 spike 核对） |
| RN 0.76.9 直接可用 | **待验**：peer 允许（ratex pin 0.1.4~0.1.8），runtime gate 是 0.86.3 | **不可用**：worklets ≥0.10 ⇒ RN ≥0.83 |
| 升级连带 | 不升级（首选）；失败则升到 0.86.3 + React 19.2.3 | RN 0.83+（React 19.2.0+）**必然** |
| 构建面 | 原生 C++/CMake/NDK（本仓库已有 CMake 构建经验）、可能的 nitro codegen（Spike 确认） | babel plugin + metro `getBundleModeMetroConfig` + **Metro 补丁（离线 bundle 硬性要求）** + `.worklets/` watch |
| 体积 | md4c C++ ~244KB + ratex | enriched + remend + worklets runtime |
| 维护方 | 个人（JoaoPauloCMarra），2026-09 仍活跃 | **Software Mansion**（官方维护流式） |
| 数学/KaTeX | 内置（`options.math`，可用 `math:false` 关掉省 ratex？Spike 核对） | `katex >=0.16` peer |
| 风险画像 | 新个人库 + 可能的版本 pin 冒险 | 大厂但**工程改造面大 + 必然 RN 升级** |

---

## 6. 决策门（Spike 协议）

**Gate A — C1 在当前栈裸跑**（先做，最便宜）：
1. 试装 `react-native-nitro-markdown@0.12.4 + react-native-nitro-modules@0.37.1 +
   ratex-react-native@0.1.8`；
2. Windows/NDK 构建 `assembleRelease` 成功 + 模拟器运行不崩（JSI/Nitro 挂载正常）；
3. 用现有打桩 harness 量一次（正文 + 代码围栏两个场景）。

**判据**：
- 构建/运行失败，或 JS CPU 无显著下降 → C1@0.76 判负 → 进 Gate C；
- 成功且 JS CPU 同批次 −≥50% → **选 C1**（记入附录，转实施计划 Task 4+）。

**Gate B — C2 依赖预检**（不装包，只留证）：`npm view react-native-worklets@0.10/0.11/0.12
peerDependencies` 的 `react-native: 0.83-…` 就是判定依据 → **C2 ⇒ RN 升级门，确定性**。

**Gate C — RN 升级门（若 Gate A 失败或后续选 C2）**：RN 0.76.9 → 0.83+（React 19.2），
**单独立项**（本计划只留门与验收口径：unit 全绿 + APK 构建 + maestro 冒烟），升级完成后再回来
跑 Gate A'（新栈上重试 C1）/ 或直接上 C2。

**降级路径（两门全挂的保底）**：B1 `FlashList` + 现有 JS 引擎三连优化，不做原生引擎。

**附录 — 决策记录（Spike 完成后回填）**
```
- 日期：
- Gate B 结果：C2 硬阻塞 —— streamdown 要求 worklets>=0.10，其 peer 为 RN 0.83-0.86 ⇒ 需 RN 升级（React 19.2+）
- Gate A 结果（构建 / 运行 / JS CPU A-B 数据）：
- 最终选择（C1 / C2 / 降级 B1）：
- 后续所需 RN 版本：
```

---

## 7. 架构

```
MessageItem / PartBlock
  └─ MarkdownRenderer (公开入口不变)
       ├─ engine='legacy' → 现有 MarkdownRendererInner（react-native-marked + 冻结块 + 快速路径）
       └─ engine='native' → NativeMarkdown
              ├─ useMarkdownSession() + 内容 diff：新增后缀 → session.append(增量)
              │              内容替换/回退 → session.reset(全文)
              ├─ <MarkdownStream updateStrategy="raf" incrementalParsing />
              ├─ styles/theme ← useThemeColors（markdownText/markdownCodeBg/markdownLink/markdownBorder）
              ├─ renderers → 我们的 MarkdownCodeBlock / MarkdownTable（保横滑/全屏契约）
              └─ onError → 回退渲染纯文本（对齐 legacy fallback）
```

- **开关**：`apps/mobile/src/config/markdownEngine.ts` 导出 `MARKDOWN_ENGINE: 'legacy' | 'native'`
  （编译期常量，单文件翻转，零 store/UI 改动）。
- **store/coalescer 不动**：chatStore 仍给整段 `content`；增量 diff 在 `NativeMarkdown` 内做
  （`content.startsWith(last)` → 只 append 差量），**避免把 delta 语义倒灌进 chatStore**。
  回退（历史加载/权威快照覆盖）天然命中 `reset` 分支。
- **会话范围注意**（nitro `docs/streaming.md`）：session range 用 UTF-16 码元；跨 emoji 的
  `getTextRange()/replace()` 会报 `invalid_range` —— 我们只用 `append(string)` / `reset(text)`，
  不碰 range API，天然规避；`append` 抛错一律 `reset` 兜底。

### 渲染契约清单（e2e 验收对照）

| 契约 | 依赖方 | native 侧要求 |
|---|---|---|
| 代码块可横滑 | `scripts/e2e/stub-code-scroll.mjs`（HorizontalScrollView+TextView） | `renderers.code_block = MarkdownCodeBlock` |
| 表格自适应+全屏详情 | `l2-md-table-chat` / `l2-md-table-file-viewer` | `renderers.table = MarkdownTable`（或核对原生表格是否需降级） |
| 暗色主题色 | app `ThemeContext` | `styles`/`theme` 映射 4 个色值 |
| 解析失败可读 | `MarkdownRenderer.test.tsx` fallback 断言 | `onError` + `errorText`/原始文本回退 |
| 链接行为 | 长按复制/点击策略 | 核对 link press / `imageOptions.remoteImages` 默认值 |

---

## 8. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | C1 需 pin ratex 旧版本，未经上游验证，可能运行时崩 | Gate A 先测；失败走 Gate C / 降级 B1 |
| R2 | RN 升级（0.76→0.83+/React 19）牵动全部原生依赖（blob-util 0.24、webview 14、autolink） | 单独立项 + 升级 Helper 逐项迁移；本计划只留门 |
| R3 | C2 的 Metro 补丁与我们**离线 `react-native bundle`** 发布链 + 自定义 `nodeModulesPaths` 冲突 | Gate A 优先避免 C2；选 C2 则 Task 中含 bundle 冒烟步骤 |
| R4 | Windows 上 nitro/CMake 构建未知步骤（nitrogen codegen 是否需要消费方执行） | Gate A 就在 Windows 上构建，第一关暴露 |
| R5 | 双引擎期间契约漂移（testID 变化打破 maestro flows） | Task 8 固定跑 `stub-code-scroll` + `l2-md-table-*` 回归 |
| R6 | 原生 `renderers` key 名与文档差异（`code_block`/`table`） | Task 5/6 含「对照 api-reference 校验 key」步骤 |
| R7 | 包体积增长（md4c ~244KB + ratex） | 接受（解析性能优先）；在验收记录里记录 APK 体积差 |
| R8 | 空洞风险：上游库月更、API 变化 | 只依赖 README 标注的 stable surface（组件/头文件导出），锁精确版本 |

---

## 9. 里程碑

| 阶段 | 交付 | 门 |
|---|---|---|
| **M0 Spike** | Gate A 实测 + Gate B 记证 → 附录回填最终选择 | JS CPU A/B ≥−50% 或明确记负 |
| **M1 引擎壳** | `MARKDOWN_ENGINE` 开关 + `NativeMarkdown` 骨架 + mock 单测 | `npx jest` 绿（默认 legacy） |
| **M2 流式+契约** | session diff 流式、theme/renderers/onError 契约 | 单测绿 + 打桩 A/B 达标 |
| **M3 默认切换** | flag 翻 `native` + e2e 回归（stub-code-scroll、l2-md-table-*、html flows） | e2e 绿 + 验收表回填 |
| **M4 收尾（后续）** | 移除 legacy 路径与死依赖（`react-native-markdown-display`、可能的 `react-native-marked`） | 单独小任务，另行决定 |

---

## 10. 不做（YAGNI）

- 不改 WS 协议 / chatStore 的 delta 语义（增量 diff 收敛在 NativeMarkdown 内）。
- 不做 iOS（无 ios 目录）。
- 不做 Web（两库均不支持或非目标）。
- 不为「原生引擎」重写表格/代码块（**直接复用现成组件**，通过 renderers 注入）。
- 不在本项目引入 Reanimated/KaTeX 主题系统（C1 `math:false`；C2 的 katex 仅按 peer 需要）。

---

## 11. 文件清单（预期）

| 文件 | 改动 |
|---|---|
| `apps/mobile/package.json` | + 三连依赖（版本以 Gate 结论为准），M4 − 死依赖 |
| `apps/mobile/src/config/markdownEngine.ts` | 新增：引擎开关常量 |
| `apps/mobile/src/components/chat/NativeMarkdown.tsx` | 新增：session diff 流式 + theme/renderers/onError |
| `apps/mobile/src/components/chat/MarkdownRenderer.tsx` | 修改：按 flag 分发 |
| `apps/mobile/__mocks__/react-native-nitro-markdown.js` | 新增（或 C2 对应包的 mock） |
| `apps/mobile/__tests__/NativeMarkdown.test.tsx` | 新增：diff append/reset、theme 映射、onError 回退、flag 分发 |
| `apps/mobile/android/*`（仅 Gate A/C 涉及） | 原生构建配置 /（Gate C 时）RN 升级迁移 |
| `docs/plans/2026-09-23-native-markdown-engine.md` | 实施计划（本设计的执行版） |
