# 会话聚合模式设计文档

> **日期**: 2026-08-27
> **状态**: 已批准
> **目标**: 将一轮会话中的工具调用和思考内容按连续段聚合显示，提升移动端阅读体验

---

## 1. 问题

当前移动端会话页面将所有 tool call、reasoning、text 按 `parts[]` 顺序平铺渲染。一轮 agent 交互可能产生 20+ 个工具调用 + 思考块，全部独立显示导致：
- 信息密度过低，需要大量滚动
- 正文被工具卡片淹没
- 阅读效率极低

## 2. 社区参考

| 项目 | 做法 |
|------|------|
| **opencode-chamber** v1.2.0+ | 连续工具调用分组为 compact status header + per-tool glance rows |
| **assistant-ui** | `MessagePrimitive.GroupedParts` + `groupPartByType`，reasoning + tool-call 合并为可折叠"思维链" |
| **Claude Code 移动端** | 工具输出折叠为单行摘要，点击展开 |
| **expo-ai-elements** | React Native 专用的 Tool Call / Reasoning / Chain of Thought 组件 |

## 3. 设计方案：按连续段聚合

### 3.1 分段算法

对每条 assistant 消息的 `parts[]` 做线性扫描，将相邻的同类 part 合并为 segment：

```
输入: [reasoning, tool, tool, tool, reasoning, tool, tool, text, tool, text]

输出:
  Segment { type: 'reasoning', parts: [reasoning_1] }
  Segment { type: 'tool-group', parts: [tool_1, tool_2, tool_3] }
  Segment { type: 'reasoning', parts: [reasoning_2] }
  Segment { type: 'tool-group', parts: [tool_4, tool_5] }
  Segment { type: 'text', parts: [text_1] }
  Segment { type: 'tool-group', parts: [tool_6] }       ← 单个 tool 也包一层
  Segment { type: 'text', parts: [text_2] }
```

**分段规则：**
- `tool` + `tool`（相邻）→ 合并为同一 `tool-group`
- `reasoning` 始终独立一个 segment（不合并相邻 reasoning）
- `text` / `error` / `file` / `compaction` 各自独立
- 单个 tool call（前后被非 tool part 隔开）→ 仍作为 `tool-group(toolCount=1)` 渲染

### 3.2 视觉效果

```
┌─ 🧠 思考过程 ────────────────────┐
│ 分析代码结构，决定先读取 index.ts...  │
└────────────────────────────────────┘

┌─ 🔧 工具调用（3 个）✓ ────────────┐
│ ✓ 📖 Read src/index.ts             │
│ ✓ 📖 Read src/App.tsx              │
│ ✓ 🔎 Grep useState                 │
└────────────────────────────────────┘

┌─ 🧠 思考过程 ────────────────────┐
│ 根据读取结果，需要修改两个文件...      │
└────────────────────────────────────┘

┌─ 🔧 工具调用（2 个）✓ ────────────┐
│ ✓ 📝 Edit src/App.tsx              │
│ ✓ ✏️ Write src/utils.ts             │
└────────────────────────────────────┘

好的，我已经完成了代码修改，测试全部通过 ✅
```

### 3.3 ToolGroupCard 三层展开

| 层级 | 内容 | 触发 |
|------|------|------|
| **折叠态（默认）** | 标题栏：`🔧 工具调用（N 个）✓` 或 `🔧 工具调用（N 个，M 失败）✗` | 默认 |
| **展开态** | 每个 tool 一行 glance（图标 + 标题 + 副标题 + 状态图标） | 点击标题栏 |
| **详情态** | 该 tool 的 BasicTool 完整内容（Shell output / Diff / Result） | 点击某行 glance |

### 3.4 ThinkingBlock

- 每个 reasoning 独立一个可折叠块
- 标题：`🧠 思考过程`
- 折叠态：只显示标题栏
- 展开态：显示完整思考文本（MarkdownRenderer）

### 3.5 流式行为

**进行中：**
- 思考块显示 `🧠 思考中...` 动画（ThinkingShimmer）
- 工具组标题显示 `🔧 执行中...（N 个）⏳`
- 新 tool 到达时追加到组内列表末尾

**已完成：**
- 标题栏更新为成功/失败统计
- 默认折叠

## 4. 设置切换

在 `settingsStore` 中新增 `chatDisplayMode` 设置项：

- **`flat`（默认）**：保持现有行为，每个 part 独立通过 `PartBlock` 渲染，向后兼容
- **`grouped`**：启用聚合模式，连续 tool 合并为 `ToolGroupCard`，reasoning 独立为 `ThinkingBlock`

在 Settings 页面新增 "Chat" section，包含一个切换行：
```
Message Display    Flat（平铺）  →  Grouped（聚合）
```

设置持久化到 `mobile-agent-bridge-settings.json`，跨 session 保持。

## 5. 架构

### 4.1 新增组件

```
components/chat/
  ├── ToolGroupCard.tsx       ← 新增：工具调用聚合卡片
  ├── ThinkingBlock.tsx       ← 新增：思考内容折叠块
  └── (ContextToolGroup.tsx)  ← 废弃（功能被 ToolGroupCard 覆盖）
```

### 4.2 修改组件

```
components/chat/MessageItem.tsx  ← 核心改造：parts[] → segments → 分段渲染
```

### 4.3 分段逻辑位置

`MessageItem.tsx` 内新增 `buildSegments(parts)` 纯函数：

```typescript
interface Segment {
  type: 'tool-group' | 'reasoning' | 'text' | 'error' | 'file' | 'compaction'
  parts: Part[]
}
```

### 4.4 不变的部分

- **chatStore 数据结构**：`parts[]` 仍然平铺存储，不做任何改动
- **事件流 / 消息同步**：不变
- **PartBlock / Part 注册表**：自定义 renderer 仍有效
- **用户消息 / 系统消息**：不受影响
- **error / file / compaction**：独立渲染，不变

## 5. 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `components/chat/ToolGroupCard.tsx` | 新增 | 工具调用聚合卡片（三层展开） |
| `components/chat/ThinkingBlock.tsx` | 新增 | 思考内容折叠块 |
| `components/chat/MessageItem.tsx` | 修改 | 分段逻辑 + 新组件集成 |
| `components/chat/ContextToolGroup.tsx` | 废弃 | 功能被 ToolGroupCard 覆盖 |
