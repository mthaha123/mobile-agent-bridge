# 聊天 UI 标准化设计（推倒重来版）

日期：2026-08-22
状态：已确认（用户批准）

## 背景与目标

当前 ChatScreen/MessageList 存在一批结构性问题（列表方向存疑、Header/Footer 位置颠倒、iOS 键盘 offset 硬编码、单行输入框、无 scroll-to-bottom、无日期分隔符）。用户决定**推倒重来**，按主流聊天 UI 标准方案重建。

**范围**：
- 键盘 + 安全区处理（双平台统一）
- 滚动行为标准化（scroll-to-bottom 悬浮按钮）
- 多行自适应输入框
- 日期分隔符
- 不含 vector 图标替换

**不变项**：消息气泡渲染（`MessageItem` 及其子组件）完全不动；`chatStore` 完全不动。

## 核心方案：倒序数据 + inverted FlatList（gifted-chat 标准）

RN 的 `inverted` 将整个列表垂直镜像（scaleY(-1)）：数组 index 0 渲染在视觉底部。gifted-chat 等主流实现的标准搭配是**倒序数据（最新在 index 0）+ inverted**，使最新消息天然位于视觉底部。

### 数据流

```
chatStore.messages        时间正序（旧→新），reducer 逻辑保持现状
       │
MessageList 内部
useMemo(() => [...messages].reverse())   → 展示数据（新→旧）
       │
FlatList inverted          index 0 = 最新 = 视觉底部
```

### 各行为推导

| 行为 | 机制 | 需要的代码 |
|------|------|-----------|
| 新消息出现在底部 | 追加到 store 数组末尾 = 展示数组 index 0 = 视觉底部 | **零滚动代码** |
| 流式输出贴底 | 更新展示数组 index 0，底部 cell 就地更新；offset≈0 时内容自然下移入视口 | 无 |
| 历史加载触发 | `onEndReached` 在内容末端 = 视觉顶部 = 最旧消息侧触发 | 现有逻辑保留 |
| 历史插入视口稳定 | prepend 到 store 数组头 = 展示数组尾 = 视觉顶部；`maintainVisibleContentPosition` 保持位置 | 现有 MVP 配置保留 |

### Header/Footer 纠位（当前正好相反）

- `ListHeaderComponent`（布局顶 = **视觉底部**）= `ThinkingShimmer`（应在最新助手消息下方）
- `ListFooterComponent`（布局底 = **视觉顶部**）= "上滑加载更早消息" 提示

## 改动明细

### 1. MessageList.tsx — 重写

- 接收正序 `messages`，内部 memo 反转后交给 inverted FlatList
- 列表项为 union 类型：

```ts
type ListItem =
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'separator'; key: string; label: string }   // 今天 / 昨天 / M月D日
```

- 由 `useDateSeparators(displayData)` 在展示层插入分隔符（纯函数，可单测）
- `keyExtractor` 按 `kind:key`
- Scroll-to-bottom FAB：`onScroll` 记录 offset（阈值 200px），超过即显示悬浮按钮；点击 `scrollToOffset({ offset: 0, animated: true })`；回到 offset < 阈值隐藏
- 移除下拉刷新（inverted 列表的 RefreshControl 会渲染到屏幕底部，RN 已知怪癖）；刷新走标题栏 ↻

### 2. useDateSeparators（新增，放 components/chat/ 下）

- 输入倒序消息数组，输出混入 separator 的 ListItem 数组
- 相邻两条消息属同一天则只在日界首条前插入分隔符
- label：今天 / 昨天 / 其余 `M月D日`（跨年加年份）
- 时间来源：`ChatMessage.created ?? timestamp`

### 3. ChatScreen.tsx

- 移除 `KeyboardAvoidingView` 的硬编码 offset 90；改用 MainLayout 导出的 `TAB_BAR_HEIGHT` 计算 iOS offset
- Android 不用 KAV（manifest 已有 `adjustResize`，窗口自动缩放，RN 标准做法）
- 输入框 `multiline` 自适应高度：`minHeight` 单行起，`maxHeight` ~120px 后内部滚动
- 仅按钮发送（移除 `returnKeyType="send"` + `onSubmitEditing` 的回车发送路径，规避跨平台回车歧义）
- 传给 MessageList 的 props 对齐新接口；气泡 renderMessage 原样透传

### 4. MainLayout.tsx

- 导出 `TAB_BAR_HEIGHT` 常量（tab bar 实际高度），ChatScreen iOS KAV offset 引用它
- 根部统一处理安全区：iOS 用 RN 内置 SafeAreaView 包裹；Android 维持现状（非 edge-to-edge）
- 不新增原生依赖（不引入 react-native-safe-area-context）

## 测试计划

| 测试 | 文件 | 断言 |
|------|------|------|
| 倒序转换 | `__tests__/MessageList.test.tsx` | 正序输入 → FlatList data 首项为最新消息 |
| 分隔符插入 | 同上 | 跨天消息间出现 separator；同天仅一个 |
| FAB 显隐 | 同上 | offset > 200 显示、< 200 隐藏（onScroll 模拟） |
| ChatScreen 对齐 | `__tests__/ChatScreen.test.tsx`（现有文件适配） | 新 props 契约、multiline 输入行为 |

运行方式：`cd apps/mobile && npx jest`

## 明确不做

- vector 图标替换（维持 emoji）
- 未读计数徽标（FAB 只做回底，YAGNI）
- 本地消息持久化
- chatStore reducer 改动
- MessageItem / PartBlock / MarkdownRenderer 等气泡层改动
