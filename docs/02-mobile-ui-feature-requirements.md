# 手机端 UI 功能需求

## 摘要

本文档定义了连接 AI 编码 Agent 服务器（OpenCode、Hermes、OpenClaw）的手机客户端所需的 UI 功能。需求来源于对 OpenCode TUI 源码（React/Ink 终端 UI）的深入分析、现有移动编码应用调研，以及移动优先设计最佳实践。

**OpenCode TUI 源码参考：** OpenCode 的 TUI 使用 `@opentui/solid`（SolidJS 终端 UI 框架，非 Ink/React），位于 `packages/opencode/src/cli/cmd/tui/`。包含 30+ 组件文件、18+ 对话框（dialog-agent、dialog-model、dialog-session-list 等）、prompt 系统（autocomplete、frecency、history、stash）、feature-plugins（diff-viewer、which-key、sidebar）、33 套主题引擎等。本需求文档基于对 `D:\code\opencode\packages\opencode\src\cli\cmd\tui\` 源码的逐文件分析，将这些终端 UI 能力映射到移动端交互模式。

**已在 OpenCode TUI 源码中验证的功能：** 会话管理（create/list/switch/fork/share）、Agent 切换（Tab/plan_enter自动切换）、模型选择（frecency/favorites）、消息流式显示（SSE V2Event: `session.next.text.delta` + `data.delta`）、14 种工具调用渲染器（Shell/Read/Write/Edit/ApplyPatch/Glob/Grep/WebFetch/WebSearch/Task/Question/Skill/TodoWrite/GenericTool）、权限审批（allow once/always/reject with message）、Question 多步向导、Sidebar 面板（Context/Files/LSP/MCP/Todo）、差异查看器（split/unified/file tree）、主题系统（33 themes + custom + system）、Prompt 历史/暂存、Shell 模式（`!` 开头）、斜杠命令、@-mention 文件补全等。

---

## 1. 核心用户场景

### 1.1 主要用例

| 场景 | 描述 | 优先级 |
|------|------|--------|
| **远程 Agent 控制** | 从手机控制远程服务器上的编码 Agent | P0 |
| **代码审查** | 审查代码变更、差异和文件修改 | P0 |
| **会话管理** | 开始、恢复和切换 Agent 会话 | P0 |
| **文件浏览** | 导航项目目录并查看文件 | P1 |
| **Markdown/HTML 查看** | 渲染文档和网页内容 | P1 |
| **工具审批** | 批准/拒绝 Agent 的工具执行（bash、文件编辑） | P0 |
| **语音输入** | 免手动的 Agent 交互 | P2 |

### 1.2 用户角色

| 角色 | 需求 | 使用模式 |
|------|------|----------|
| **移动开发者** | 快速修复、代码审查、监控 | 间歇性，5-15 分钟会话 |
| **团队负责人** | 多会话管理、任务委派 | 频繁，上下文切换 |
| **运维工程师** | 服务器监控、故障响应 | 紧急，时间敏感 |

---

## 2. 屏幕布局

### 2.1 主导航结构

```
┌─────────────────────────────────────────┐
│               导航栏                     │
├─────────┬─────────┬─────────┬──────────┤
│  聊天   │  文件   │  会话   │  设置    │
│   💬    │   📁    │   📋    │   ⚙️     │
└─────────┴─────────┴─────────┴──────────┘
```

### 2.2 聊天屏幕（主界面）

```
┌─────────────────────────────────────────┐
│  会话: my-project    [Agent: Build] ▾  │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 用户: 修复登录bug               │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ Agent: 我来分析认证模块...      │   │
│  │                                 │   │
│  │ 🔧 工具: read src/auth.ts      │   │
│  │ ✅ 工具: edit src/auth.ts       │   │
│  │                                 │   │
│  │ 通过添加适当的错误处理修复了问   │   │
│  │ 题。                             │   │
│  │                                 │   │
│  │ [查看差异] [批准] [拒绝]       │   │
│  └─────────────────────────────────┘   │
│                                         │
├─────────────────────────────────────────┤
│  [📎] [🎤] 输入消息...        [发送] │
└─────────────────────────────────────────┘
```

### 2.3 文件浏览器屏幕

```
┌─────────────────────────────────────────┐
│  📁 project-name                  ↩️    │
├─────────────────────────────────────────┤
│  📂 src/                               │
│  📂 tests/                             │
│  📂 docs/                              │
│  📄 README.md                          │
│  📄 package.json                       │
│  📄 .gitignore                         │
├─────────────────────────────────────────┤
│  [聊天] [文件] [会话] [设置]          │
└─────────────────────────────────────────┘
```

### 2.4 文件查看器屏幕

```
┌─────────────────────────────────────────┐
│  📄 src/auth.ts                    ↩️    │
├─────────────────────────────────────────┤
│  1  │ import { Auth } from './auth';    │
│  2  │                                  │
│  3  │ export class AuthService {       │
│  4  │   private token: string;         │
│  5  │                                  │
│  6  │   async login(user: string,      │
│  7  │              pass: string) {     │
│  8  │     // 错误：缺少错误处理        │
│  9  │     const result = await         │
│ 10  │       this.api.login(user,pass); │
│ 11  │     return result;               │
│ 12  │   }                              │
│ 13  │ }                                │
├─────────────────────────────────────────┤
│  [聊天] [文件] [会话] [设置]          │
└─────────────────────────────────────────┘
```

### 2.5 会话列表屏幕

```
┌─────────────────────────────────────────┐
│  会话                              +    │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐   │
│  │ my-project-fix    Build   2分钟前│   │
│  │ auth-refactor     Plan   1小时前│   │
│  │ docs-update       Build  3小时前│   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ other-project     Build   1天前 │   │
│  │ api-redesign      Plan   2天前 │   │
│  └─────────────────────────────────┘   │
├─────────────────────────────────────────┤
│  [聊天] [文件] [会话] [设置]          │
└─────────────────────────────────────────┘
```

### 2.6 设置屏幕

```
┌─────────────────────────────────────────┐
│  设置                              ↩️   │
├─────────────────────────────────────────┤
│  服务器连接                             │
│    主机: 192.168.1.100:4096            │
│    状态: 🟢 已连接                      │
│                                         │
│  Agent 设置                             │
│    默认 Agent: Build                    │
│    默认模型: claude-sonnet-4            │
│                                         │
│  UI 设置                                │
│    主题: 深色                           │
│    字号: 中                             │
│    代码字体: JetBrains Mono             │
│                                         │
│  通知                                   │
│    工具审批: 🔔 已启用                  │
│    会话完成: 🔔 已启用                  │
├─────────────────────────────────────────┤
│  [聊天] [文件] [会话] [设置]          │
└─────────────────────────────────────────┘
```

---

## 3. 功能规格

### 3.1 聊天界面

#### 3.1.1 消息类型

| 类型 | 内容 | 操作 |
|------|------|------|
| **用户消息** | 用户输入的文本 | 编辑，删除 |
| **Agent 响应** | 文本 + Markdown | 复制，分享 |
| **工具调用** | 工具名称 + 参数 | 查看详情 |
| **工具结果** | 执行输出 | 展开，复制 |
| **差异视图** | 文件变更 | 批准，拒绝，查看 |
| **错误** | 错误消息 | 重试，报告 |

#### 3.1.2 输入功能

| 功能 | 描述 |
|------|------|
| **文本输入** | 多行文本，支持 markdown |
| **语音输入** | 设备端语音识别，免手动操作 |
| **图片粘贴** | 截图/照片附件 |
| **文件附件** | 从设备选择文件 |
| **斜杠命令** | `/help`, `/model`, `/agent`, `/clear` |
| **提及系统** | `@file`, `@agent` 用于上下文 |
| **历史导航** | 上下箭头浏览历史消息 |

#### 3.1.3 流式显示

OpenCode 通过 SSE V2Event `session.next.text.delta`（含 `data.sessionID`, `data.delta`）实现令牌流式传输。手机端不直接连接 OpenCode SSE，而是通过 Bridge 将 SSE V2Event（`{ id, type, data }`）转为 WebSocket `notify` 帧（`{ type: "notify", method: event.type, payload: event.data }`）推送。Bridge 在服务端使用 `@opencode-ai/sdk` 的 `v2.event.subscribe()` 订阅 SSE，实时转发给手机端 WebSocket 连接：

```
┌─────────────────────────────────────────┐
│ Agent: 我来分析登录...                  │
│                                         │
│ ████░░░░░░░░░░░░░░░░ 25%               │
│                                         │
│ 流式令牌在此显示...                      │
│ [暂停] [停止]                           │
└─────────────────────────────────────────┘
```

### 3.2 工具审批系统

#### 3.2.1 工具调用显示

```
┌─────────────────────────────────────────┐
│ 🔧 工具请求: bash                      │
├─────────────────────────────────────────┤
│ 命令:                                   │
│ ```bash                                │
│ npm test                               │
│ ```                                    │
│                                         │
│ 超时: 30s                              │
│ 工作目录: /project                      │
│                                         │
│ [批准] [拒绝] [编辑后批准]             │
└─────────────────────────────────────────┘
```

#### 3.2.2 审批选项

| 选项 | 描述 |
|------|------|
| **批准** | 允许单次执行 |
| **拒绝** | 跳过该操作 |
| **编辑后批准** | 执行前修改命令 |
| **全部批准** | 会话内自动批准（带超时） |
| **YOLO 模式** | 自动批准所有工具（有风险） |

### 3.3 文件浏览器

#### 3.3.1 目录导航

| 功能 | 描述 |
|------|------|
| **树形视图** | 可折叠目录树 |
| **Git 状态** | 显示修改/新增/删除的文件 |
| **文件图标** | 类型特定图标（JS、TS、PY 等） |
| **大小/日期** | 文件元数据显示 |
| **搜索** | 模糊文件搜索 |
| **快速跳转** | 最近文件，书签 |

#### 3.3.2 文件操作

| 操作 | 描述 |
|------|------|
| **查看** | 在查看器中打开文件 |
| **编辑** | 在代码编辑器中打开（Phase 2） |
| **复制路径** | 复制文件路径到剪贴板 |
| **分享** | 分享文件内容 |
| **Git 追溯** | 查看行作者 |
| **Git 历史** | 查看文件变更历史 |

### 3.4 文件查看器

#### 3.4.1 语法高亮

| 语言 | 支持 |
|------|------|
| JavaScript/TypeScript | ✅ 完整 |
| Python | ✅ 完整 |
| Go | ✅ 完整 |
| Rust | ✅ 完整 |
| Java/Kotlin | ✅ 完整 |
| HTML/CSS | ✅ 完整 |
| Markdown | ✅ 渲染 |
| JSON/YAML | ✅ 完整 |
| Shell/Bash | ✅ 完整 |
| SQL | ✅ 完整 |

#### 3.4.2 查看器功能

| 功能 | 描述 |
|------|------|
| **行号** | 开关切换 |
| **自动换行** | 开关切换 |
| **缩放** | 双指缩放 |
| **文件内搜索** | 查找文本 |
| **跳转到行** | 跳转到指定行号 |
| **缩略图** | 代码概览（可选） |

### 3.5 Markdown 渲染器

#### 3.5.1 支持的语法元素

| 元素 | 支持 | 说明 |
|------|------|------|
| **标题** | ✅ | H1-H6 带锚点链接 |
| **粗体/斜体** | ✅ | 完整内联格式 |
| **代码块** | ✅ | 语法高亮 |
| **行内代码** | ✅ | 等宽字体 |
| **列表** | ✅ | 有序和无序 |
| **表格** | ✅ | 水平滚动 |
| **链接** | ✅ | 在浏览器中打开 |
| **图片** | ✅ | 懒加载 |
| **引用** | ✅ | 样式化 |
| **任务列表** | ✅ | 交互式复选框 |
| **LaTeX 数学** | ✅ | KaTeX 渲染 |
| **Mermaid 图表** | ✅ | 渲染为 SVG |
| **HTML** | ✅ | 清理后渲染 |

#### 3.5.2 Markdown 功能

| 功能 | 描述 |
|------|------|
| **流式渲染** | 令牌到达时即时渲染 |
| **复制代码** | 一键复制代码块 |
| **展开/折叠** | 长章节可折叠 |
| **深色模式** | 主题感知颜色 |
| **RTL 支持** | 从右到左文本 |

### 3.6 HTML 渲染器

#### 3.6.1 用例

| 来源 | 描述 |
|------|------|
| **文档** | API 文档、README 文件 |
| **网页内容** | 获取的网页 |
| **生成的 HTML** | Agent 输出 |

#### 3.6.2 安全

| 措施 | 描述 |
|------|------|
| **清理** | 移除危险标签/脚本 |
| **沙箱** | 与原生代码隔离 |
| **内容策略** | 限制外部资源 |

### 3.7 会话管理

#### 3.7.1 会话操作

| 操作 | 描述 |
|------|------|
| **创建** | 开始新会话 |
| **恢复** | 继续现有会话 |
| **重命名** | 自定义会话名称 |
| **删除** | 移除会话 |
| **导出** | 导出会话历史 |
| **分享** | 与团队分享会话 |

#### 3.7.2 会话列表功能

| 功能 | 描述 |
|------|------|
| **分组** | 按项目、日期、Agent 分组 |
| **搜索** | 按内容查找会话 |
| **排序** | 按日期、名称、活动 |
| **置顶** | 保留重要会话 |
| **归档** | 隐藏旧会话 |

### 3.8 Agent 切换

OpenCode TUI 中通过 Tab 键在 build/plan 两个主 Agent 间切换。手机端需要更直观的触控选择方式。

#### 3.8.1 Agent 选择

```
┌─────────────────────────────────────────┐
│ 选择 Agent                              │
├─────────────────────────────────────────┤
│  🟢 build                              │
│     完全访问，所有工具已启用             │
│                                         │
│  🟡 plan                               │
│     只读，专注于分析                    │
│                                         │
│  🔵 explore                            │
│     快速代码库搜索                      │
│                                         │
│  🟣 custom-agent                       │
│     自定义提示词和工具                  │
└─────────────────────────────────────────┘
```

#### 3.8.2 模型选择

```
┌─────────────────────────────────────────┐
│ 选择模型                                │
├─────────────────────────────────────────┤
│  anthropic                             │
│    ├── claude-sonnet-4-20250514        │
│    ├── claude-haiku-3-5                │
│    └── claude-opus-4-20250514          │
│                                         │
│  openai                                │
│    ├── gpt-4.1                         │
│    ├── o3                              │
│    └── o4-mini                         │
│                                         │
│  google                                │
│    ├── gemini-2.5-pro                  │
│    └── gemini-2.5-flash                │
└─────────────────────────────────────────┘
```

---

## 4. 交互模式

### 4.1 触控手势

| 手势 | 上下文 | 操作 |
|------|--------|------|
| **点击** | 消息 | 选择/复制 |
| **长按** | 消息 | 编辑/删除/分享 |
| **左滑** | 消息 | 回复 |
| **右滑** | 消息 | 反应 |
| **双指缩放** | 代码/图片 | 缩放 |
| **下拉** | 聊天 | 加载历史 |
| **双击** | 代码块 | 复制 |

### 4.2 键盘快捷键（外接键盘）

| 快捷键 | 操作 |
|--------|------|
| `⌘ + N` | 新建会话 |
| `⌘ + K` | 命令面板 |
| `⌘ + /` | 切换侧边栏 |
| `⌘ + Enter` | 发送消息 |
| `⌘ + Shift + A` | 批准工具 |
| `⌘ + Shift + R` | 拒绝工具 |
| `⌘ + ←` | 返回 |
| `⌘ + →` | 前进 |

### 4.3 触觉反馈

| 事件 | 反馈 |
|------|------|
| **消息已发送** | 轻触 |
| **需要工具审批** | 中触 |
| **错误** | 重触 |
| **会话完成** | 成功模式 |

---

## 5. 通知系统

### 5.1 通知类型

| 类型 | 触发 | 操作 |
|------|------|------|
| **工具审批** | Agent 请求执行工具 | 点击批准 |
| **会话完成** | Agent 完成任务 | 点击查看 |
| **错误** | Agent 遇到错误 | 点击重试 |
| **需要输入** | Agent 需要澄清 | 点击回复 |
| **后台任务** | 长时间运行任务更新 | 滑动查看 |

### 5.2 通知设置

| 设置 | 选项 |
|------|------|
| **工具审批** | 声音、震动、角标、锁屏 |
| **会话完成** | 声音、震动、角标 |
| **错误** | 声音、震动、角标、锁屏 |
| **免打扰时段** | 关闭除关键通知外的所有通知 |

---

## 6. 无障碍

### 6.1 屏幕阅读器支持

| 元素 | 标签 |
|------|------|
| **消息** | 完整的文本内容 |
| **工具调用** | "工具：[名称]，[参数]" |
| **按钮** | 清晰的操作描述 |
| **图片** | 替代文本或描述 |

### 6.2 VoiceOver/TalkBack

| 功能 | 实现 |
|------|------|
| **焦点顺序** | 逻辑阅读顺序 |
| **自定义操作** | 批准/拒绝工具调用 |
| **转子** | 按标题、链接导航 |

### 6.3 动态字体

| 平台 | 支持 |
|------|------|
| **iOS** | 系统文本大小 |
| **Android** | 字体缩放设置 |

---

## 7. 离线支持

### 7.1 离线功能

| 功能 | 离线行为 |
|------|----------|
| **查看历史** | 读取缓存的会话 |
| **草稿消息** | 排队等待发送 |
| **文件查看** | 读取缓存的文件 |
| **Agent 通信** | 消息排队 |

### 7.2 同步策略

| 数据 | 同步频率 |
|------|----------|
| **消息** | 实时（连接时） |
| **文件** | 按需 + 缓存 |
| **会话** | 按需 + 缓存 |
| **设置** | 变更时同步 |

---

## 8. 安全

### 8.1 认证

| 方法 | 描述 |
|------|------|
| **生物识别** | Face ID / 指纹 |
| **PIN 码** | 4-6 位数字 |
| **密码** | 强密码 |
| **SSH 密钥** | 设备绑定密钥 |

### 8.2 数据保护

| 数据 | 存储 |
|------|------|
| **SSH 密钥** | Secure Enclave / Keystore |
| **会话令牌** | Keychain / Keystore |
| **消息** | 加密数据库 |
| **文件** | 应用沙箱 |

### 8.3 网络安全

| 措施 | 实现 |
|------|------|
| **TLS** | 所有连接加密 |
| **证书绑定** | 防止中间人攻击 |
| **VPN 支持** | iOS/Android VPN API |

---

## 9. 平台特定功能

### 9.1 iOS

| 功能 | 实现 |
|------|------|
| **小组件** | 会话状态，快速操作 |
| **快捷指令** | Siri 集成 |
| **分享扩展** | 分享代码给 Agent |
| **后台刷新** | 保持会话活跃 |
| **推送通知** | APNs 集成 |

### 9.2 Android

| 功能 | 实现 |
|------|------|
| **小组件** | 会话状态，快速操作 |
| **快速设置** | 切换连接 |
| **分享意图** | 分享代码给 Agent |
| **后台服务** | 保持会话活跃 |
| **推送通知** | FCM 集成 |

### 9.3 HarmonyOS

| 功能 | 实现 |
|------|------|
| **服务卡片** | ArkUI ArkTS |
| **Share Kit** | 分享代码给 Agent |
| **后台任务** | 保持会话活跃 |
| **Push Kit** | 推送通知 |

### 9.4 HarmonyOS 架构策略

由于 **React Native 不原生支持 HarmonyOS**，需采用双框架方案：

```
┌──────────────────────────────────────────────────┐
│                   共享层                           │
│  ┌────────────────────────────────────────────┐  │
│  │        Bridge Server API 客户端            │  │
│  │  (TypeScript 通过 monorepo 包共享)         │  │
│  │  - API 客户端逻辑                          │  │
│  │  - SSE 事件处理                            │  │
│  │  - 数据类型定义                            │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
┌──────────▼──────────┐  ┌────────▼──────────┐
│   Android & iOS     │  │    HarmonyOS       │
│                     │  │                    │
│   React Native      │  │   ArkUI (ArkTS)    │
│   + TypeScript      │  │   + 原生 API       │
│                     │  │                    │
│   复用：            │  │   复用：           │
│   - Zustand stores  │  │   - 共享 TS API    │
│   - API 客户端      │  │   - Bridge 协议    │
│   - 组件逻辑       │  │   - ArkUI 组件     │
└─────────────────────┘  └────────────────────┘
```

**策略：**
1. **Bridge Server API 客户端**（共享 TypeScript 包）— 核心网络、认证、数据逻辑一次编写
2. **Android & iOS** — React Native 通过 npm 使用共享包
3. **HarmonyOS** — ArkUI（原生 ArkTS 框架）使用共享包或重新实现 API 客户端
4. **HarmonyOS 桥** — 轻量 ArkTS 包装器，封装共享 TypeScript 客户端（通过 JSI 桥或纯 HTTP 重新实现）

**选 ArkUI 而非 Flutter 的理由：**
- 官方 HarmonyOS SDK，完整 API 访问（Push Kit、Share Kit、卡片）
- 原生性能与集成
- 不依赖社区分支（`flutter_ohos` 为第三方项目）

**共享组件策略：**
| 组件 | Android/iOS | HarmonyOS |
|------|-------------|-----------|
| **网络层** | Axios（通过 npm 共享） | `@ohos.net.http` |
| **SSE 客户端** | EventSource（共享） | 自定义 ArkTS 实现 |
| **状态管理** | Zustand（共享） | `@ohos.data.preferences` |
| **UI 组件** | React Native | ArkUI ArkTS 声明式 |
| **导航** | React Navigation | `@ohos.router` |
| **Markdown** | react-native-markdown | `@ohos.markdown` |
| **语法高亮** | react-syntax-highlighter | 自定义 ArkTS 渲染器 |

---

## 10. 性能要求

### 10.1 响应时间

| 操作 | 目标 |
|------|------|
| **应用启动** | < 2 秒 |
| **屏幕切换** | < 300ms |
| **消息发送** | < 100ms |
| **令牌显示** | < 50ms |
| **文件加载** | < 1 秒 |

### 10.2 资源使用

| 资源 | 限制 |
|------|------|
| **内存** | < 200MB 活跃状态 |
| **电池** | < 5%/小时 活跃使用 |
| **网络** | < 1MB/分钟 空闲 |
| **存储** | < 100MB 应用 + 缓存 |

---

## 11. 国际化

### 11.1 支持的语言

| 语言 | 状态 |
|------|------|
| 英语 | ✅ 主要 |
| 简体中文 | ✅ 必需 |
| 繁体中文 | 🔜 Phase 2 |
| 日语 | 🔜 Phase 2 |
| 韩语 | 🔜 Phase 2 |

### 11.2 RTL 支持

| 语言 | 支持 |
|------|------|
| 阿拉伯语 | ✅ 完整 |
| 希伯来语 | ✅ 完整 |

---

## 12. 总结

### 12.1 核心功能（Phase 1：第 1-4 周）

1. **服务器连接**（HTTP + SSE）
2. **聊天界面**（流式令牌显示）
3. **会话管理**（创建/恢复/删除）
4. **工具审批系统**（批准/拒绝 Agent 操作）

### 12.2 增强功能（Phase 2：第 5-8 周）

1. **基本文件浏览器**（带 Git 状态）
2. **文件查看器**（带语法高亮）
3. **Markdown 渲染**（流式 + 富文本显示）
4. **HTML 渲染**（清理后、沙箱隔离）
5. **Agent/模型切换**
6. **语音输入**

### 12.3 高级功能（Phase 3：第 9-12 周）

1. **离线模式**
2. **推送通知**
3. **语音输入**
4. **多服务器支持**
5. **键盘快捷键系统**
6. **主题系统**
7. **会话导出**
8. **插件系统**
9. **协同会话**

---

## 13. OpenCode TUI 源码对比分析

### 13.1 分析范围

基于 `D:\code\opencode\packages\opencode\src\cli\cmd\tui\` 源码，逐文件比对当前手机端需求与 OpenCode TUI 实际实现。

### 13.2 功能覆盖矩阵

| 功能 | OpenCode TUI 实现 | 手机端需求 | 差异分析 |
|------|-------------------|-----------|----------|
| **会话创建** | `session.create()` 点击 Tab/Tab 创建 | §3.7.1 创建 | ✅ 已覆盖 |
| **会话列表/切换** | `DialogSessionList` 组件 + 快捷键 | §2.5 会话列表 | ✅ 已覆盖 |
| **会话 Fork** | `session.fork()` 从时间线或消息菜单 | 未实现 | ❌ 需补 |
| **会话共享** | `session.share()/unshare()` 生成分享链接 | 未实现 | ❌ 需补 |
| **会话压缩** | `session.summarize()` 自动压缩上下文 | 未实现 | ❌ 需补 |
| **会话撤销/重做** | `session.revert()/unrevert()` | 未实现 | ❌ 需补 |
| **会话时间线** | `DialogTimeline` 跳转到历史消息 | 未实现 | ❌ 需补 |
| **会话导出** | 导出为 Markdown | §3.7.1 导出 | ✅ 已覆盖 |
| **Agent 切换** | Tab 键 cycle + plan_enter/exit 自切换 | §3.8 Agent 选择 | ✅ 已覆盖 |
| **Agent 颜色** | 每个 Agent 不同颜色标记 | 未实现 | ❌ 需补 |
| **模型选择** | `DialogModel` + frecency + favorites | §3.8.2 模型选择 | ✅ 已覆盖 |
| **消息流式显示** | `message.part.updated` + delta 字段 | §3.1.3 流式显示 | ✅ 已覆盖 |
| **Markdown 渲染** | `<markdown>` 元素 + 语法高亮 | §3.5 Markdown | ✅ 已覆盖 |
| **思考/推理显示** | 可折叠 thought block，3 种模式 | 未实现 | ❌ 需补 |
| **工具调用渲染** | 14 种专用渲染器（Shell/Read/Write/Edit 等） | §3.2 通用工具审批 | ❌ 需专项渲染 |
| **Shell 模式** | `!` 开头直接执行 shell 命令 | 未实现 | ❌ 需补 |
| **斜杠命令** | `/` 触发命令自动补全 | §3.1.2 提到 | ❌ 需完整实现 |
| **@-mention 补全** | @文件名/Agent/Reference 模糊搜索 | §3.1.2 提到 | ❌ 需完整实现 |
| **Prompt 暂存** | `DialogStash` 保存/恢复草稿 | 未实现 | ❌ 需补 |
| **Prompt 历史** | 上下箭头浏览历史 | §3.1.2 历史导航 | ✅ 已覆盖 |
| **编辑器集成** | `/editor` 打开 $EDITOR | 未实现 | ❌ 需补 |
| **权限审批** | allow once / always / reject with message | §3.2 工具审批 | ✅ 已覆盖 |
| **权限差异预览** | Edit 权限显示内联 diff | 未实现 | ❌ 需补 |
| **Question 系统** | 多步问题、多选、Confirm 流程 | 未实现 | ❌ 需补 |
| **差异查看器** | 完整 diff viewer：split/unified、file tree | §3.7.2 提到 | ❌ 需独立实现 |
| **文件浏览器** | `@` 触发文件搜索 | §3.3 文件浏览器 | ✅ 已覆盖 |
| **Sidebar 面板** | Context/Files/LSP/MCP/Todo | 未实现 | ❌ 需补 |
| **LSP 状态** | LSP 连接/诊断状态 | 未实现 | ❌ 需补 |
| **MCP 状态** | MCP 服务器状态/切换 | 未实现 | ❌ 需补 |
| **Todo 列表** | `DialogTodo` 任务管理 | 未实现 | ❌ 需补 |
| **主题系统** | 33 内置 + 自定义 + 系统主题 | §2.6 主题深色 | ❌ 需扩展 |
| **快捷键系统** | Modal keybind + leader key + which-key | §4.2 键盘快捷键 | ❌ 需完整 |
| **命令面板** | `DialogCommand` 模糊搜索命令 | 未实现 | ❌ 需补 |
| **Toast 通知** | 信息/警告/成功/错误 toast | 未实现 | ❌ 需补 |
| **桌面通知** | 失焦时通知 + 声音效果 | §5 通知系统 | ✅ 已覆盖 |
| **插件系统** | Slot 注入 + 路由注册 + 命令注册 | 未实现 | ❌ 需补 |
| **工作区管理** | Workspace create/warp/delete | 未实现 | ❌ 需补 |

### 13.3 SDK 使用对比

**注意：** `@opencode-ai/sdk` 依赖 Node.js 运行时（cross-spawn），移动端 React Native / ArkTS 无法使用。以下对比仅说明协议层面的映射关系。

| 方面 | OpenCode TUI 实际使用 | 手机端实现方案 |
|------|----------------------|--------------|
| **SDK 版本** | `@opencode-ai/sdk/v2` | ❌ 无法使用，经 Bridge 代理 |
| **消息发送** | `client.v2.session.prompt()` + `client.session.shell()` + `client.session.command()` | WS `message.send/{sessionID, message}` → Bridge 代理 → `v2.session.prompt({ prompt: { text } })` |
| **事件订阅** | `sdk.v2.event.subscribe()` → V2Event 流 | WS `notify` 帧 → Bridge 将 SSE V2Event 转发为 `{ type: "notify", method, payload }` |
| **状态管理** | SolidJS `createStore` + `reconcile` | Zustand |
| **权限处理** | `client.v2.session.permission.reply()` + session 作用域 | WS `permission.reply/{sessionID, requestID, reply}` → Bridge 代理 → SDK |
| **Question 处理** | `client.v2.session.question.reply()/reject()` | WS `question.reply/reject` → Bridge 代理 → SDK |
| **文件搜索** | `client.find.files()` + fuzzysort | WS `file.search` → Bridge 转发到 OpenCode REST `/find/file` |

### 13.4 关键差异总结

**OpenCode TUI 有而当前需求未覆盖的功能：**

1. **Shell 模式** — 输入 `!ls -la` 直接在会话中执行 shell 命令并取回结果
2. **完整的 @-mention 系统** — @文件名 模糊搜索文件内容；@agent 切换 Agent；@reference/ 浏览配置引用
3. **14 种工具渲染器** — 每个工具类型（Shell/Read/Write/Edit/ApplyPatch/Glob/Grep/WebFetch/WebSearch/Task/Question/Skill/TodoWrite）有专用 UI，而非通用审批框
4. **差异查看器** — 含文件树的 split/unified diff 查看器，支持逐文件标记"已审查"
5. **Sidebar 面板** — 右侧 42 字符信息栏，显示上下文、文件树、LSP 状态、MCP 状态、待办
6. **Session 时间线** — 以时间轴方式回溯消息历史，支持从中点 Fork
7. **Question 多步向导** — 多步问题、多选、复选框、确认后再提交
8. **主题系统** — 33 内置 + 自定义 + 终端自动生成，100+ TextMate 语法作用域
9. **命令面板** — `Ctrl+P` 打开可搜索的命令列表
10. **插件系统** — UI slot 注入 + 全屏路由 + 命令注册 + 事件订阅 + 持久化 KV 存储

### 13.4 OpenCode TUI 插件系统详解

基于 `D:\code\opencode\packages\opencode\src\cli\cmd\tui\plugin\` 源码分析。

#### 插件系统核心机制

OpenCode TUI 插件系统是一个 **基于 slot 注入 + 路由注册 + 命令注册** 的扩展框架，构建在 `@opentui/solid` 之上。

**插件 API 暴露的能力：**

| API 命名空间 | 能力 |
|-------------|------|
| `api.route` | 注册全屏路由（如 diff viewer 注册 `diff` 路由） |
| `api.keymap` | 注册命令 + 键绑定层 |
| `api.slots` | 注入 UI 到命名 slot（8 个注入点） |
| `api.event` | 订阅 TUI 事件（session.status、permission 等） |
| `api.ui` | 操作对话框（Dialog、Toast、Prompt 等） |
| `api.kv` | 持久化键值存储 |
| `api.state` | 读取应用状态（会话、配置、diff、LSP、MCP） |
| `api.client` | 原生 SDK 客户端访问 |
| `api.theme` | 读取/切换主题 |
| `api.attention` | OS 通知 + 声音播放 |

**8 个 UI Slot 注入点：**

| Slot 名 | 位置 | 模式 | 用途示例 |
|---------|------|------|----------|
| `home_logo` | 首页 Logo 区 | replace | 自定义 Logo |
| `home_prompt` | 首页输入框 | replace | 自定义输入 |
| `home_bottom` | 首页底部 | multi-plugin | which-key 提示 |
| `home_footer` | 首页脚注 | single_winner | 版本信息 |
| `sidebar_content` | 侧边栏内容 | multi-plugin | LSP/MCP/Todo/Files |
| `sidebar_footer` | 侧边栏脚注 | single_winner | 目录路径 |
| `app_bottom` | 应用底部 | multi-plugin | which-key dock |
| `app` | 应用层 | default | which-key overlay |

**内置插件列表（共 13 个）：**
- `HomeFooter`、`HomeTips` — 首页信息
- `SidebarContext`、`SidebarMcp`、`SidebarLsp`、`SidebarTodo`、`SidebarFiles`、`SidebarFooter` — 侧边栏面板
- `Notifications` — 通知系统
- `PluginManager` — 插件管理 UI
- `WhichKey` — 键提示覆盖层
- `DiffViewer` — 全屏差异查看器（注册 `diff` 路由 + 20+ 命令）
- `SessionV2Debug` — 调试面板（实验性）

**插件生命周期：**
```
加载 → 解析依赖 → 顺序激活 → 创建作用域 → 调用 plugin(api) → 运行 → 反激活（自动清理）
```

所有插件的资源（命令、绑定、事件订阅、slot 注入）在反激活时**自动释放**，通过 AbortSignal + Proxy 拦截实现。

#### 移动端插件系统建议

**不需要实现与 TUI 完全相同的插件系统。** 理由：

| 维度 | TUI 插件系统 | 移动端推荐 |
|------|-------------|-----------|
| **Slot 注入** | 8 个终端 UI 注入点 | 移动端用 React Native 组件组合即可 |
| **路由注册** | 全屏路由 | 移动端路由由导航框架控制 |
| **命令注册** | 键绑定 + 命令面板 | 移动端用 Deep Link / Universal Link |
| **事件订阅** | 内部 TUI 事件 | 直接 SSE `message.part.updated` |
| **持久化** | KV store | AsyncStorage / SQLite |
| **外部插件** | npm 包动态加载 | 插件作为 npm 依赖静态打包 |

**移动端简化方案：** 提供 `AgentPlugin` 抽象，仅暴露 `onEvent`、`onToolCall`、`onMessage` 三个 hook，通过 Bridge 服务器端加载，移动端不直接执行第三方插件代码。

**对于手机端，需要优先补齐的功能（影响 MVP 可用性）：**
- Shell 模式（用户常需在移动端快速执行命令）
- 工具类型专用渲染（体验差异大）
- Sidebar 信息面板（监控 Agent 状态）
- 差异查看器（代码审查核心）

### 13.5 移动端适配策略

| OpenCode TUI 实现 | 移动端适配方式 |
|-------------------|---------------|
| Tab 键切换 Agent | 底部栏 Agent 标签切换 |
| Tab 键自动补全 | 输入框上方浮动候选栏 |
| Sidebar 面板 | 右侧抽屉式面板 (Drawer) |
| 对话框 (Dialog) | 底部弹出式 (Bottom Sheet) |
| 命令面板 | 搜索式命令选择器 |
| 差异查看器 | 全屏横向/纵向对比模式 |
| 14 种工具渲染器 | 每种工具专用卡片组件 |
| Toast 通知 | 顶部横幅通知 |
| Which-key 叠加 | 快捷键提示浮层 |
| Leader 键系统 | 长按 + 快捷操作

---

## 14. TUI ↔ 服务器 vs 手机 ↔ Bridge 接口对比（基于源码）

### 14.1 说明

基于 `D:\code\opencode\packages\opencode\src\cli\cmd\tui\` 源码的 ripgrep 全量搜索（85 个 SDK 调用点），逐条对比手机端协议与 TUI 的差异。

**三层架构：**
```
TUI 调用 @opencode-ai/sdk  ───HTTP+SSE──→  OpenCode serve
手机通过 WebSocket 调用 Bridge ───SDK──→  OpenCode serve
```

### 14.2 核心差异

| 维度 | TUI 直接调用 SDK | 手机端通过 Bridge |
|------|------------------|-------------------|
| **传输** | HTTP + SSE（两条连接） | WebSocket（一条连接双向） |
| **事件流** | `sdk.global.event()` SSE 流 | Bridge 转为 WS `event` 帧推送 |
| **文件操作** | ❌ TUI 无 `client.file.*` 调用 | ✅ 手机端额外实现 `file.list/read`（Bridge 直接 fs） |
| **接口处理** | 全部经 SDK 调用 OpenCode REST | 代理（session/message/permission 等经 SDK）+ 直接（auth/file/health 自处理） |
| **SDK 方法数** | 85 个调用点，21 个命名空间 | 约 25 个 Bridge 代理方法 + 7 个直接实现 |

### 14.3 完整接口对比

#### A. 应用启动（Bootstrap）— 7 个必须

| TUI 调用 | 源码位置 | 必须？ | 手机端方法 | 说明 |
|----------|---------|--------|-----------|------|
| `sdk.global.event()` | `context/sdk.tsx:83` | ✅ 核心 | 自动（Bridge WS 连接后即有事件流） | Bridge 连接即建立事件通道 |
| `client.config.providers()` | `context/sync.tsx:385` | ✅ 必须 | `config.providers` | 拉取提供商列表 |
| `client.config.get()` | `context/sync.tsx:392` | ✅ 必须 | `config.get` | 拉取完整配置 |
| `client.app.agents()` | `context/sync.tsx:391` | ✅ 必须 | `config.agents` | 拉取 Agent 列表 |
| `client.provider.list()` | `context/sync.tsx:386` | ✅ 必须 | `provider.list` | 拉取提供商详情 |
| `client.path.get()` | `context/project.tsx:39` | ✅ 必须 | 自动 | Bridge 自动获取路径信息 |
| `client.project.current()` | `context/project.tsx:40` | ✅ 必须 | 自动 | Bridge 自动获取项目信息 |

#### B. 启动时非阻塞加载 — 7 个，手机端可合并

| TUI 调用 | 源码位置 | 必须？ | 手机端方法 | 说明 |
|----------|---------|--------|-----------|------|
| `client.session.status()` | `context/sync.tsx:457` | ✅ 必须 | `session.status` | 会话运行状态 |
| `client.vcs.get()` | `context/sync.tsx:461` | ✅ 必须 | `vcs.get` | Git 分支信息 |
| `client.command.list()` | `context/sync.tsx:450` | ✅ 必须 | `command.list` | 斜杠命令列表 |
| `client.lsp.status()` | `context/sync.tsx:451` | ❌ 跳过 | — | 移动端无 LSP |
| `client.mcp.status()` | `context/sync.tsx:452` | ❌ Phase 3 | `mcp.status` | MCP 状态 |
| `client.provider.auth()` | `context/sync.tsx:460` | ❌ 跳过 | — | 服务端管理 |
| `client.formatter.status()` | `context/sync.tsx:456` | ❌ 跳过 | — | 格式化器状态 |
| `client.experimental.resource.list()` | `context/sync.tsx:453` | ❌ 跳过 | — | MCP 资源列表 |

#### C. 会话管理 — 12 个，手机端实现 8 个

| TUI 调用 | 源码位置 | 必须？ | 手机端方法 | 说明 |
|----------|---------|--------|-----------|------|
| `client.session.create()` | `prompt/index.tsx:1068` | ✅ 核心 | `session.create` | 创建会话 |
| `client.session.list()` | `sync.tsx:128` | ✅ 核心 | `session.list` | 列表 |
| `client.session.get()` | `sync.tsx:524` | ✅ 核心 | `session.get` | 获取详情 |
| `client.session.messages()` | `sync.tsx:525` | ✅ 核心 | `session.messages` | 消息历史 |
| `client.session.todo()` | `sync.tsx:526` | ✅ 核心 | `session.todo` | 待办列表 |
| `client.session.diff()` | `sync.tsx:527` | ✅ 核心 | `session.diff` | 文件差异 |
| `client.session.delete()` | `dialog-session-list.tsx:253` | ✅ 必须 | `session.delete` | 删除会话 |
| `client.session.update()` | `dialog-session-rename.tsx:22` | ✅ 必须 | `session.update` | 重命名 |
| `client.session.fork()` | 4 处调用 | ❌ 延后 | — | Fork 会话，移动端非必需 |
| `client.session.revert()` | 3 处调用 | 🔶 建议 | `session.revert` | 撤销，建议有 |
| `client.session.unrevert()` | `session/index.tsx:641` | 🔶 建议 | `session.unrevert` | 重做，建议有 |
| `client.session.abort()` | 2 处调用 | ✅ 核心 | `session.abort` | 中止操作 |
| `client.session.share/unshare()` | `session/index.tsx:472-579` | ❌ 跳过 | — | 分享功能 |
| `client.session.summarize()` | `session/index.tsx:559` | ❌ 跳过 | — | 自动压缩，服务端自动 |

#### D. 消息发送 — 3 个，全部必须

| TUI 调用 | 源码位置 | 必须？ | 手机端方法 | 说明 |
|----------|---------|--------|-----------|------|
| `client.v2.session.prompt()` | `prompt/index.tsx:1177` | ✅ 核心 | `message.send` | 发送文本消息（`prompt: { text }`） |
| `client.session.shell()` | `prompt/index.tsx:1136` | ❌ 降级 | `message.send` | 由 message.send + text prompt 替代 |
| `client.session.command()` | `prompt/index.tsx:1161` | ❌ 降级 | `message.send` | 由 message.send + text prompt 替代 |

#### E. 工具审批 — 4 个，全部必须

| TUI 调用 | 源码位置 | 手机端方法 |
|----------|---------|-----------|
| `client.v2.session.permission.reply({ sessionID, requestID, reply })` | `permission.tsx:428` | `permission.reply` | `reply: "once"\|"always"\|"reject"` |
| `client.permission.reply("always")` | `permission.tsx:171` | `permission.reply` | 全局路径（v1） |
| `client.permission.reply("reject") with message` | `permission.tsx:182` | `permission.reply` | 同上 |

#### F. Question 处理 — 3 个，全部必须

| TUI 调用 | 源码位置 | 手机端方法 |
|----------|---------|-----------|
| `client.v2.session.question.reply({ sessionID, requestID, questionV2Reply })` | `question.tsx:50` | `question.reply` | `questionV2Reply: { answers: [[string]] }` |
| `client.v2.session.question.reject({ sessionID, requestID })` | `question.tsx:57` | `question.reject` | |

#### G. 文件搜索（TUI 没有文件浏览器！）— 关键发现

| TUI 调用 | 源码位置 | 用途 | 手机端方法 |
|----------|---------|------|-----------|
| `client.v2.fs.find()` | `autocomplete.tsx:390` | @-mention 文件模糊搜索 | `file.search` | Bridge 转发到 OpenCode |
| `client.find.files()` | `dialog-tag.tsx:20` | 文件标签 | 同上 | 顶层 SDK 也可用 |

**⚠️ 关键发现：** TUI **没有** `client.file.list()` 或 `client.file.read()` 调用。TUI 没有独立的"文件浏览器"功能——文件只通过 @-mention 搜索（`client.find.files`）和会话差异（`client.session.diff`）展示。**手机端的文件浏览器和文件查看器是额外增强功能**，TUI 本身不支持。

#### H. Agent/模型切换 — 无直接 API 调用

Agent 和模型信息通过启动时加载的数据（`client.app.agents()`、`client.config.providers()`）即可，切换操作是**本地状态变更**，不触发服务器调用。

#### I. 跳过不实现的接口

| 跳过的 API | 数量 | 原因 |
|-----------|------|------|
| `client.provider.oauth.*` | 3 | 提供商设置是桌面操作 |
| `client.auth.set` | 1 | 提供商 API Key 设置 |
| `client.instance.dispose` | 4 | 实例重启（提供商变更后） |
| `client.experimental.console.*` | 3 | 组织切换（企业功能） |
| `client.experimental.workspace.*` | 7 | 工作区管理（桌面概念） |
| `client.vcs.diff` | 1 | Git 工作树 diff（桌面） |
| `client.vcs.status` | 1 | 仅工作区 warp 场景使用 |
| `client.v2.session.messages` | 1 | 实验性 v2 格式 |
| `client.app.skills` | 1 | 技能管理 |
| `client.global.upgrade` | 1 | 自升级（走应用商店） |
| `client.mcp.connect/disconnect` | 2 | MCP 开关，Phase 3 |
| `client.session.share/unshare` | 2 | 会话分享 |
| `client.session.fork` | 4 | Fork 会话 |
| `client.session.summarize` | 1 | 自动压缩 |

### 14.4 覆盖率总结

| 类别 | TUI 调用数 | 手机端实现 | 覆盖率 |
|------|-----------|-----------|--------|
| 应用启动（必须） | 7 | 7（含 Bridge 自动） | **100%** |
| 非阻塞加载 | 8 | 5（LSP/MCP 跳过） | **62%** |
| 会话 CRUD | 14 | 12（含顶层 SDK delete/update/fork/revert/unrevert） | **86%** |
| 消息发送 | 3 | 3（shell/command 降级为 message.send） | **100%** |
| 工具审批 | 4 | 4（v2.session.permission.reply） | **100%** |
| Question | 3 | 3（v2.session.question.reply/reject） | **100%** |
| 文件搜索 | 2 | 2（含文件浏览器增强） | **100%+** |
| 提供商/OAuth | 11（含顶层 SDK providers） | 0 | 0%（桌面操作） |
| 工作区管理 | 7 | 0 | 0%（桌面概念） |
| **总计** | **约 85** | **约 43** | **~51%** |

**更新（2026-07-08）：** 通过与 SDK v2 实际 API 表面核对发现，`session.delete`、`session.update`、`config.providers`、`vcs.get`、`session.diff`、`session.todo`、`session.fork`、`session.revert`、`session.unrevert` 均可通过顶层 SDK（非 `v2` 命名空间）调用，并非不可用。设计文档 `03-architecture-design.md §1.6` 已同步修正。

### 14.5 结论

**核心用户交互（会话/消息/审批/Question）全部对齐，覆盖率 100%。** 跳过的都是桌面概念（工作区、OAuth 提供商设置、Fork、分享）或移动端不需要的功能（LSP 状态、格式化器）。**手机端的文件浏览器是 TUI 没有的增强功能。**
