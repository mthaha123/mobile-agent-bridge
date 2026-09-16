# 聊天滚动归属与交互原语重建 — 设计文档

> **日期**: 2026-09-12
> **状态**: ✅ 已完成（P0-P3），P4 待实施
> **目标**: 从结构上消除聊天页三类滚动/点击缺陷，而不是逐点打补丁
> **涉及文件**: `apps/mobile/src/components/chat/**`、`apps/mobile/src/components/common/**`、`MessageList`、`ToolGroupCard`、`HorizontalScrollBox`、`AppPressable`

---

## 1. 问题（三个用户可见缺陷）

| # | 现象 | 触发条件 |
|---|------|---------|
| P1 | 聊天时有数据更新（流式/SSE）时，**按钮点不动**，但可以上下滑动 | 会话正在流式输出、工具状态更新、列表重排时 |
| P2 | 文本框内容**只能竖向滑动，无法横向滑动** | 代码块、bash/shell 输出、diff、源码查看的横向内容 |
| P3 | 聚合模式一级展开后，内容滑到最底部继续拖，**外层会话列表朝反方向滚动** | `ToolGroupCard` level 1 内框过滚动 |

---

## 2. 根因分析

三个缺陷不是独立 bug，而是同一条架构选择 + 三处实现遗漏：

### 2.1 共同根源：`inverted` FlatList + cell 内嵌纵向滚动

`MessageList.tsx` 使用 `inverted`（数据倒序 + `scaleY(-1)` 镜像）作为聊天列表方案。该方案本身可行，但在 Android / 新架构下产生两个副作用：

- **Pressability 坐标失配**：新架构（`newArchEnabled=true`，`apps/mobile/android/gradle.properties`）下，Pressability 用 `measure()` 从 Fabric 影子树取按钮区域；`inverted` 的原生 transform + 流式频繁重排使测量值与实际屏幕位置不一致，手指第一次 `touchMove` 即判定 `LEAVE_PRESS_RECT` → 按下被取消。原生命令的滚动不受影响，所以"划得动、点不动"。
- **嵌套滚动 delta 方向反转**：内嵌 `nestedScrollEnabled` 的纵向 ScrollView 在 inverted 父列表内**过滚动**时，嵌套滚动 delta 未因父级 `scaleY(-1)` 取反，导致父列表朝反方向滚动。

### 2.2 P1 根因（点击失效）

| 根因 | 位置 | 说明 |
|---|---|---|
| **主因**：Fabric Pressability + `inverted` transform | `MessageList.tsx`（`inverted`）、RN 0.76 新架构 | 见 2.1。RN 已知问题 `#51621`、`#48387`、`#57502`；维护者确认"父级带 transform 时问题仍在" |
| 加剧：Android `LayoutAnimation` | `ToolGroupCard.tsx` 的 `onContentSizeChange`、header/入口；`ChatScreen.tsx` 全局启用 | Android `LayoutAnimation` + FlatList 有"列表项点击失效"已知问题（RN `#31201`），流式期间反复触发 |
| 加剧：流式期间 JS 线程饱和 | `MarkdownRenderer`（每 token 重解析）、`buildChatListItems`、`mergeConsecutiveAssistantMsgs` | JS 线程忙于重新渲染时触摸事件被延迟/丢弃 |

### 2.3 P2 根因（横向滑动失效）

Android 嵌套滚动需要**父子都参与**（child 是 NestedScrollingChild，parent 是 NestedScrollingParent）：

- 父 FlatList 的 `nestedScrollEnabled` 在提交 `7d9f4e5` 被作为"临时 A/B 验证"移除（排查 `onEndReached` 不触发），**至今未恢复**（`MessageList.tsx:90` 仍留注释）。
- `ShellOutput`、`DiffDisplay`、`FileViewerScreen` 的横向 ScrollView **从未**加 `nestedScrollEnabled`。
- 结果：子横向拖拽被父纵向列表吞掉，表现为"只能上下滑"。
- 注：`MarkdownCodeBlock` / `MarkdownTable` 的 child 侧已加 `nestedScrollEnabled`，但因为父级未开，仍不生效。

### 2.4 P3 根因（方向反转）

RN Android **已知且未修复**的原生 bug `#29776`：带 `nestedScrollEnabled` 的 ScrollView 嵌在 `inverted` FlatList 内，过滚动时父列表方向反转。`docs/plans/2026-08-30-toolgroupcard-expand-design.md` 第 13 节已把"嵌套滚动手势"列为风险，但当时的缓解手段（`nestedScrollEnabled`）恰好触发了该 bug。

---

## 3. 设计目标与判断标准

**结构清晰 = 三个"唯一"**：

| 维度 | 现状（混乱） | 目标（清晰） |
|---|---|---|
| 纵向滚动归属 | inverted FlatList + cell 内嵌纵向 ScrollView 抢手势 | **每个可视面只有一个纵向滚动所有者** |
| 溢出策略 | 每个组件各自决定要不要内嵌滚动 | **溢出策略显式化**：裁剪 / 展开 / 另开独立滚动面 |
| 点击原语 | 到处是 core `TouchableOpacity` | **列表内统一走 `AppPressable`**（RNGH） |

---

## 4. 方案对比

| 方案 | 做法 | 结构清晰度 | 结论 |
|---|---|---|---|
| **A（采用）单一滚动归属 + 共享原语** | 去 inverted；纵向滚动只归列表/Modal；点击走 `AppPressable`；横向走 `HorizontalScrollBox`；一级展开改裁剪 + 详情 Modal | ★★★★★ | 三类问题从结构上消失；约定可守护、可复用 |
| B 保留 inverted，仅把内嵌纵向滚动换成 Modal | 改动更小 | ★★★☆☆ | P3 消失，但 transform 仍在，P1 的根未除，方向反转随时可能复发 |
| C 只做症状补丁 | 补 `nestedScrollEnabled`、加 `overScrollMode`、换 `onPressIn` | ★★☆☆☆ | 见效快，但约定不显式，后续组件极易再踩 |

**选择 A。** A 与 B 的关键差异：A 把"cell 内不得有纵向滚动"和"列表内点击走统一原语"变成可检查的结构约定；B 只是局部缓解。

---

## 5. 目标结构

```
ChatScreen
└─ MessageList                 ← 唯一纵向滚动所有者（普通 FlatList，无 inverted）
   └─ MessageItem
      ├─ StreamingText / MarkdownRenderer
      ├─ ToolGroupCard
      │    ├─ level 0：标题栏
      │    ├─ level 1：ClampBox（纯裁剪，不滚动）＋“展开全部”
      │    └─ 展开全部 → ToolDetailSheet（Modal，自己拥有纵向滚动）
      └─ HorizontalScrollBox   ← 原语：横向滚动（代码块/表格/diff/shell）
```

**关键变化：cell 里再没有纵向 ScrollView。** 一级展开要么裁剪（`ClampBox`），要么把详情放进 `ToolDetailSheet`（独立滚动面）。

---

## 6. 共享原语设计

| 原语 | 位置 | 职责 | 对应问题 |
|---|---|---|---|
| `AppPressable` | `components/common/AppPressable.tsx` | 包装 `react-native-gesture-handler` 的 `Pressable`，替代列表内所有 `TouchableOpacity` | P1 |
| `HorizontalScrollBox` | `components/common/HorizontalScrollBox.tsx` | 统一 `horizontal + nestedScrollEnabled + directionalLockEnabled`；横向内容统一走它 | P2 |
| `ClampBox` | `components/chat/ClampBox.tsx` | 纯 `maxHeight + overflow: hidden`，**永不含 ScrollView** | P3 |
| `ToolDetailSheet` | `components/chat/ToolDetailSheet.tsx` | Modal，自己拥有纵向滚动 | P3 |
| `useBottomAnchor` | `hooks/useBottomAnchor.ts` | 底部锚定 / 自动跟随 / 历史 prepend 视口保持 | 去掉 inverted 后替代它 |

### 6.1 `AppPressable`

```tsx
// components/common/AppPressable.tsx
import { Pressable, type PressableProps } from 'react-native-gesture-handler'

/**
 * 列表内统一点击原语。
 * 背景：RN 新架构下 core Touchable/Pressable 的 Pressability 用 Fabric 影子树
 * 测量触点区域，在 inverted/transform/频繁重排场景会误判 LEAVE_PRESS_RECT，
 * 表现为“划得动、点不动”。RNGH 用原生命中测试，绕开该缺陷。
 */
export const AppPressable = (props: PressableProps) => <Pressable {...props} />
```

- 迁移范围：`ToolGroupCard`、`BasicTool`、`ToolErrorCard`、`MarkdownCodeBlock`、`MarkdownTable`、`PartBlock`、`PermissionDock`、`AttachmentBar`。
- 新增依赖 `react-native-gesture-handler`，`MainLayout`（或入口）需挂 `GestureHandlerRootView`。
- 保留 `TouchableOpacity` 的视觉反馈可通过 RNGH `Pressable` 的 style 回调实现。

### 6.2 `HorizontalScrollBox`

```tsx
// components/common/HorizontalScrollBox.tsx
import { ScrollView, View } from 'react-native'

interface Props {
  children: React.ReactNode
  /** 内容实测超宽时才显示指示条 */
  showsIndicator?: boolean
  contentContainerStyle?: ViewStyle
}

/**
 * 横向滚动统一容器。
 * Android 嵌套滚动要求父子都参与：child 启用 nestedScrollEnabled，
 * 父列表也必须在 MessageList 上启用（见第 7 节约定）。
 * iOS 加 directionalLockEnabled 防止斜向手势落到父纵向列表。
 */
export const HorizontalScrollBox = ({ children, showsIndicator = true, contentContainerStyle }: Props) => (
  <ScrollView
    horizontal
    nestedScrollEnabled
    directionalLockEnabled
    showsHorizontalScrollIndicator={showsIndicator}
    contentContainerStyle={contentContainerStyle}
  >
    <View>{children}</View>
  </ScrollView>
)
```

替换对象：`ShellOutput`、`DiffDisplay`、`MarkdownCodeBlock`、`MarkdownTable`、`FileViewerScreen`（不换行源码模式）。
要求：横向内容不被压缩（保留 `flexShrink: 0` / `alignSelf: 'flex-start'`），ScrollView 有确定宽度。

### 6.3 `ClampBox` + `ToolDetailSheet`

```tsx
// components/chat/ClampBox.tsx：纯裁剪，刻意不提供滚动
export const ClampBox = ({ maxHeight, children }) => (
  <View style={{ maxHeight, overflow: 'hidden' }}>{children}</View>
)
```

- level 1：`ClampBox` 显示思考末尾/最新工具，**框内不可滚动**（避免嵌套纵向滚动）。
- 用户要看完整内容 → 点"展开全部" → `ToolDetailSheet`（Modal，唯一纵向滚动所有者）。
- 状态机简化为：`0 折叠 → 1 裁剪预览 → Modal 详情`；`ClampBox` 不参与手势协商，P3 从结构上消失。

### 6.4 `useBottomAnchor`（去 inverted 后的底部锚定）

```ts
/**
 * 普通（非 inverted）FlatList 的聊天底部锚定。
 * - 正序数据：最新消息在数组末尾、视觉底部
 * - 贴底时新内容/流式增长 → scrollToEnd({ animated: false })
 * - 不贴底不打断（用户在看历史）
 * - 历史 prepend 用 maintainVisibleContentPosition 保持视口
 */
export function useBottomAnchor(listRef: RefObject<FlatList>) {
  const isAtBottomRef = useRef(true)
  const onScroll = (e) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent
    isAtBottomRef.current =
      contentSize.height - layoutMeasurement.height - contentOffset.y <= 24
  }
  const scrollToEndIfPinned = useCallback(() => {
    if (isAtBottomRef.current) listRef.current?.scrollToEnd({ animated: false })
  }, [listRef])
  return { onScroll, scrollToEndIfPinned, isAtBottomRef }
}
```

`MessageList` 用 `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` 保持历史 prepend 视口稳定（该能力在非 inverted 列表上本就是为聊天设计）。

---

## 7. 三条不可违反的约定

1. **纵向滚动唯一**：只有 `MessageList` / 独立页面 / `Modal` 能拥有纵向滚动（竖直 `<ScrollView>` / `<FlatList>`）。
2. **cell 内只允许横向滚动**：横向一律走 `HorizontalScrollBox`（它保证 `nestedScrollEnabled`，且要求父列表也开启）。
3. **列表内点击一律 `AppPressable`**；流式未完成文本走 `StreamingText`（纯 `Text`），完成后才进 `MarkdownRenderer`。

**守护手段**：
- `MessageList` 必须保留 `nestedScrollEnabled`（父级参与嵌套滚动）。
- 加一条守护测试/ESLint 规则：扫描 `components/chat/**` 中是否出现纵向 `ScrollView`（`<ScrollView>` 未带 `horizontal`），出现即失败。
- 加测试断言 `MessageList` 无 `inverted`、存在 `maintainVisibleContentPosition`。

---

## 8. 迁移路径（增量、每步可独立验证）

| 阶段 | 动作 | 结构收益 | 风险 |
|---|---|---|---|
| **P0** | 新建 `HorizontalScrollBox` 并替换 ShellOutput/DiffDisplay/MarkdownCodeBlock/MarkdownTable/FileViewer；`MessageList` 恢复 `nestedScrollEnabled` | P2 从结构上消失 | 低 |
| **P1** | `ToolGroupCard` level 1 改 `ClampBox`，详情移到 `ToolDetailSheet` | cell 内不再有纵向滚动（P3 根除） | 中 |
| **P2** | 新建 `AppPressable`，替换列表内 Touchable；依赖 RNGH + `GestureHandlerRootView` | P1 主因消除 | 中 |
| **P3** | `MessageList` 去 inverted + `useBottomAnchor` | 去掉 transform 与方向反转的物理根源 | 高（回归面最大） |
| **P4** | `StreamingText` + delta 节流（约 100ms / 帧批量 flush） | 交互与性能 | 中 |

- P0 / P1 / P2 相互独立；P0 单独完成即可显著改善 P2。
- P3 是"彻底干净"的一步，需回归：进入会话定位、流式跟随、上滑加载历史、日期分隔符、FAB 回底。
- 依赖关系：P2 的 RNGH 应在 P3 之前引入并验证，避免两步同时改手势栈。

### 与 `onEndReached` 的关系

当初移除父列表 `nestedScrollEnabled` 是为了排查历史加载不触发。恢复它后需单独解决该问题（不要用牺牲嵌套滚动来规避）：

- 调整 `onEndReachedThreshold`；
- 或用 `onMomentumScrollEnd` 兜底判断是否到达顶部；
- 或对 `historyHint` 做可见性触发。

---

## 9. 风险与回归

| 风险 | 缓解 |
|---|---|
| 去 inverted 后进入会话定位/流式跟随回归 | `useBottomAnchor` 单测 + Maestro 历史会话流程；保留 `maintainVisibleContentPosition` |
| RNGH 引入影响现有手势栈 | 独立成 P2，先替换单个组件验证；挂 `GestureHandlerRootView` |
| `ClampBox` 裁剪可能藏住内容 | 保留"展开全部"入口；Modal 可滚动 |
| `HorizontalScrollBox` 在极长单行下性能 | 保留现有 `flexShrink: 0`；必要时对超长内容做行数上限 |
| `nestedScrollEnabled` 恢复后 `onEndReached` 不触发 | 见第 8 节专门处理，不与本设计混做 |

---

## 10. 测试计划

| 层 | 用例 |
|---|---|
| `MessageList.test.tsx` | 无 `inverted`；有 `nestedScrollEnabled`；有 `maintainVisibleContentPosition`；滚动到底触发历史加载；FAB 显隐 |
| `HorizontalScrollBox.test.tsx`（新增） | 渲染 `horizontal` + `nestedScrollEnabled`；溢出时指示条逻辑 |
| `ToolGroupCard.test.tsx` | level 1 不再渲染纵向 `ScrollView`（改断言 `ClampBox`）；点"展开全部"打开 `ToolDetailSheet`；level 状态机 |
| `ToolDetailSheet.test.tsx`（新增） | 打开/关闭、工具详情渲染、纵向滚动 |
| `AppPressable.test.tsx`（新增） | onPress/onLongPress 透传、disabled |
| `chatComponents.test.tsx` | 横向组件（代码块/表格/diff/shell）使用统一容器 |
| 守护测试（新增） | 扫描 `components/chat/**` 无纵向 `ScrollView` |
| Maestro | 历史聊天、分组模式展开、横向滑动代码块（真机路径） |

---

## 11. 文件清单

| 文件 | 改动 |
|---|---|
| `apps/mobile/src/components/common/HorizontalScrollBox.tsx` | 新增 |
| `apps/mobile/src/components/common/AppPressable.tsx` | 新增 |
| `apps/mobile/src/components/chat/ClampBox.tsx` | 新增 |
| `apps/mobile/src/components/chat/ToolDetailSheet.tsx` | 新增 |
| `apps/mobile/src/hooks/useBottomAnchor.ts` | 新增 |
| `apps/mobile/src/components/chat/MessageList.tsx` | 恢复 `nestedScrollEnabled`（P0）；去 inverted + `useBottomAnchor`（P3） |
| `apps/mobile/src/components/chat/ToolGroupCard.tsx` | level 1 改 `ClampBox`；详情入口改 `ToolDetailSheet`；移除 Android `LayoutAnimation`（P1） |
| `apps/mobile/src/components/chat/ShellOutput.tsx` | 横向容器改 `HorizontalScrollBox`（P0） |
| `apps/mobile/src/components/chat/DiffDisplay.tsx` | 同上（P0） |
| `apps/mobile/src/components/chat/MarkdownCodeBlock.tsx` | 同上（P0） |
| `apps/mobile/src/components/chat/MarkdownTable.tsx` | 同上（P0） |
| `apps/mobile/src/screens/FileViewerScreen.tsx` | 不换行模式用 `HorizontalScrollBox`（P0） |
| 列表内交互组件 | `TouchableOpacity` → `AppPressable`（P2） |
| `apps/mobile/package.json` | 新增 `react-native-gesture-handler`（P2） |
| 入口 / `MainLayout` | 挂 `GestureHandlerRootView`（P2） |

---

## 12. 明确不做（YAGNI）

- 不为此改动 Bridge 或任何 WS 协议（纯客户端渲染层）。
- 不在本设计内处理 `onEndReached` 不触发的修复（单独任务）。
- 不引入 Reanimated 替换 `LayoutAnimation`（先用"移除动画"验证；确需动画再评估）。
- 不做展开状态的跨回收记忆（沿用 `2026-08-30` 设计的取舍）。

## 13. 决策记录

1. **采用方案 A（单一滚动归属 + 共享原语）**：从结构上消除嵌套纵向滚动，B/C 只缓解不根除。
2. **保留 `nestedScrollEnabled` 作为父列表常驻属性**：它此前被"临时 A/B"移除且未恢复，是 P2 的直接原因。
3. **`ClampBox` 刻意不提供滚动**：宁可少一个内嵌滚动面，也不要重蹈 P3。
4. **P0 先行**：风险最低、可单测覆盖、立刻验证 P2，作为后续重构的信任基础。
