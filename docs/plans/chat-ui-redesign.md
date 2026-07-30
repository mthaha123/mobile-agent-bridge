# 移动端 Chat UI 改造方案 — 开发计划

## 背景

当前 Mobile Agent Bridge 的 Chat UI 基于简单的角色系统（user/assistant/system）渲染消息，与 OpenCode Web 的 Part 模型 + 工具注册表 + Dock 系统存在较大差距。本计划旨在将 Web 的设计模式适配到移动端，优先覆盖终端使用场景。

---

## 一、核心架构变更

### 1.1 Part 消息模型（替代角色系统）

**当前：** 消息按 `role` 区分，固定样式 + Markdown 渲染（已降级为纯文本）

**目标：** 引入 Part 类型系统，消息由多个 Part 组成：

```typescript
type PartType = 'text' | 'tool' | 'reasoning' | 'file' | 'error' | 'compaction'

interface Message {
  id: string
  role: 'user' | 'assistant'  // 仅用于消息级别归属
  parts: Part[]
  agent?: string
  model?: string
}
```

**变更文件：**
- `chatStore.ts` — 消息模型升级
- `ChatScreen.tsx` — renderMessage 改为 Part 调度
- 新增 `components/chat/PartBlock.tsx` — Part 类型分发器

### 1.2 工具渲染器注册表

**当前：** ToolRenderer 硬编码 switch-case（13 种工具）

**目标：** 插件式注册表，新增工具只需注册组件

```typescript
const TOOL_RENDERERS = new Map<string, React.FC<ToolPartProps>>()
function registerToolRenderer(tool: string, component: React.FC<ToolPartProps>)
```

**变更文件：**
- 新增 `components/chat/BasicTool.tsx` — 通用可折叠工具卡片
- 新增 `components/chat/ShellOutput.tsx`
- 新增 `components/chat/DiffDisplay.tsx`
- 新增 `components/chat/ToolErrorCard.tsx`
- 重构 `ToolRenderer.tsx` — 改为注册表调用

### 1.3 Dock 系统（替代 Modal）

**当前：** ToolApprovalSheet / QuestionSheet 以 Modal 弹出

**目标：** 输入区上方 inline Dock 面板

```
[消息流]
[Dock — 权限审批 / 问题面板 / 排队消息]
[Composer — 输入框 + 发送按钮]
```

**变更文件：**
- 新增 `components/composer/DockArea.tsx`
- 新增 `components/composer/PermissionDock.tsx`
- 新增 `components/composer/QuestionDock.tsx`
- 重构 `ToolApprovalSheet.tsx` — 权限审批移至 Dock
- 重构 `QuestionSheet.tsx` — 问题面板移至 Dock

---

## 二、功能组件详述

### P0 — 核心功能（必须实现）

#### 2.1 PartBlock — Part 类型调度器

```
Props:
  - part: Part

行为：
  - 按 part.type 从 PART_RENDERERS 注册表查找渲染器
  - 未注册类型 → null（静默跳过）
```

#### 2.2 BasicTool — 通用工具卡片

```
结构：
  [🔧 工具名 │ 文件路径 │ status 图标 │ ▼]
  └─ 折叠内容（输出/diff/预览）

Props:
  - icon: string
  - title: string
  - subtitle?: string
  - args?: string[]
  - status?: 'running' | 'success' | 'error'
  - defaultOpen?: boolean

状态机：
  running  → ActivityIndicator
  success  → ✓ 绿色
  error    → ✗ 红色
```

#### 2.3 ShellOutput — 终端输出

```
样式：
  - 等宽字体（monospace）
  - 深色背景 #0d1117
  - 行号（灰色）
  - 超过 20 行折叠

高亮：
  - ERROR → 红色背景
  - WARNING → 黄色背景
  - 可横向滚动防长行溢出
```

#### 2.4 DiffDisplay — 代码变更

```
样式：
  - 等宽字体
  - 添加行：绿色背景 + 前缀 +
  - 删除行：红色背景 + 前缀 -
  - 上下文行：无背景 + 空格前缀
  - 行号（灰色）
```

#### 2.5 ToolErrorCard — 错误展示

```
结构：
  [⚠️ 工具名 │ 错误摘要]
  └─ 详细错误信息（可折叠）
     └─ 复制按钮

替代当前系统消息插入聊天列表的做法。
```

### P1 — 重要功能（后续实现）

#### 2.6 ContextToolGroup — 上下文工具分组

```
自动合并 read/glob/grep/list：
  "已收集上下文：3 个文件，2 次搜索"
  └─ 展开子列表

Web 中此功能由 groupParts() 实现，移动端适配。
```

#### 2.7 Composer Dock — 审批/问题面板

```
位置：输入区上方，消息流下方

PermissionDock：
  ┌─────────────────────────────┐
  │ 🔒 工具请求                 │
  │ writeFile                   │
  │ /path/to/test.ts            │
  │ [拒绝] [批准一次] [始终允许] │
  └─────────────────────────────┘

QuestionDock：
  ┌─────────────────────────────┐
  │ ❓ 问题                     │
  │ 允许此操作？                │
  │ ○ Yes    ○ No              │
  │ [拒绝] [提交]               │
  └─────────────────────────────┘
```

#### 2.8 ThinkingShimmer + ReasoningBlock

```
Thinking 动画：
  [⏳ Thinking...]  +  点动画

Reasoning 折叠：
  [🧠 思考过程 ▼]
  └─ 思考痕迹文本
```

### P2 — 增强功能（后续实现）

#### 2.9 Markdown 渲染（完整版）

```
策略：
  - 优先使用 react-native-marked（轻量）
  - 降级方案：正则识别 ```code``` 和 `inline code`
  - 代码块：等宽 + 深色背景 + 复制按钮
```

#### 2.10 附件系统

```
支持：
  - 从相册选图
  - 从文件管理器选文件
  - 粘贴文本/代码
  - 附件显示为 Chip 标签
```

#### 2.11 长按消息菜单

```
ActionSheet：
  - 复制文本
  - 回退到此消息
  - 分支（fork）
  - 分享
```

---

## 三、不适配项

以下 P3 功能经评估当前无适配必要，标记为 **不适配**：

| 功能 | Web 实现 | 不适配原因 |
|------|---------|-----------|
| 横屏/分屏布局 | iPad 分屏 + 桌面三栏 | 移动端以竖屏单栏为主，横屏使用场景极少 |
| 键盘快捷键 | PageUp/Down/Home/End/Arrow | 移动端外接键盘使用率极低，RN 键盘事件支持有限 |
| 虚拟滚动优化 | virtua 虚拟化 + hash 跳转 | FlatList 已满足当前消息量级，hash 跳转在移动端无使用场景 |
| i18n 国际化 | useI18n 完整体系 | 当前仅需中英文，可继续使用硬编码 + 后续统一 |
| contenteditable 富文本 | 富文本输入 + 拖拽 | RN 不支持 contenteditable，TextInput 已满足输入需求 |
| shiki 语法高亮 | marked + shiki + katex | 移动端包体积敏感，语法高亮可用简化替代方案 |

---

## 四、实施路线图

```
Phase 1 (P0) — 消息系统重构
├── Part 消息模型 + PartBlock 调度器
├── BasicTool + ShellOutput + DiffDisplay
├── ToolErrorCard
└── 工具渲染器注册表

Phase 2 (P1) — 交互增强
├── ContextToolGroup
├── Composer Dock（Permission/Question）
├── ThinkingShimmer + ReasoningBlock
└── 停止按钮优化（Abort 确认）

Phase 3 (P2) — 体验完善
├── Markdown 渲染（含降级）
├── 附件系统（文件/图片）
├── 长按菜单
└── Slash 命令面板增强（@ agent / / command）
```

---

## 五、涉及文件清单

### 新增文件

```
src/components/chat/PartBlock.tsx
src/components/chat/BasicTool.tsx
src/components/chat/ShellOutput.tsx
src/components/chat/DiffDisplay.tsx
src/components/chat/ToolErrorCard.tsx
src/components/chat/ContextToolGroup.tsx
src/components/chat/ThinkingShimmer.tsx
src/components/chat/ReasoningBlock.tsx
src/components/composer/DockArea.tsx
src/components/composer/PermissionDock.tsx
src/components/composer/QuestionDock.tsx
src/types/message.ts
src/types/tool.ts
```

### 修改文件

```
src/screens/ChatScreen.tsx          — renderMessage → PartBlock 调度
src/screens/ToolApprovalSheet.tsx   — Modal → Dock 集成
src/screens/QuestionSheet.tsx       — Modal → Dock 集成
src/components/ToolRenderer.tsx     — switch-case → 注册表
src/stores/chatStore.ts             — 消息模型升级
src/stores/toolStore.ts             — 审批状态适配 Dock
src/stores/questionStore.ts         — 问题状态适配 Dock
src/components/MainLayout.tsx       — 可能需调整布局
```

### 删除文件

```
src/screens/ToolApprovalSheet.tsx（若完全被 Dock 替代）
src/screens/QuestionSheet.tsx（若完全被 Dock 替代）
```
