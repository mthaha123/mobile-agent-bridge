# 模型选择器重设计：两行布局 + 搜索

日期：2026-08-25
状态：已批准

## 背景

会话界面（ChatScreen）的模型选择弹窗中，服务商徽章与模型名挤在同一行：

- 徽章 `maxWidth: 110` + `numberOfLines={1}`，长服务商名（如 `opencode-go`）被截断
- 模型名无 `flexShrink`，长模型名（如 `claude-sonnet-4-5-20250929`）溢出不可见
- 模型数量多时无搜索能力，只能滚动查找

## 决策

- 弹窗样式：**保持居中 Modal**（不改为底部 Sheet）
- 搜索范围：**名称 + id + 服务商**，大小写不敏感
- 实现方式：**提取独立组件**（方案 A），ChatScreen 瘦身且逻辑可单测

## 设计

### 组件结构

新建 `apps/mobile/src/components/ModelPickerModal.tsx`：

```ts
interface ModelPickerModalProps {
  visible: boolean
  onClose: () => void
  onSelect: (model: unknown) => void   // 回调完整 model 对象
  models: unknown[]                    // 来自 configStore.models
  currentModel?: { id?: string; providerID?: string } | null
}
```

- 纯展示 + 过滤组件，无副作用；切换模型的 `switchModel` 调用留在 ChatScreen 的 `handleSwitchModel`，经 `onSelect` 回调衔接
- ChatScreen 删除内嵌 Modal JSX 及其 styles（modelPicker* / modelProvider* 系列），改为渲染 `<ModelPickerModal>`

### 条目两行布局（核心修复）

```
┌─────────────────────────────────────┐
│ claude-sonnet-4-5            ✓     │  ← 第一行：模型名 fontWeight 600
│ ┌──────────┐                        │     flexShrink=1 + numberOfLines=2 兜底
│ │ opencode │                        │  ← 第二行：服务商徽章
│ └──────────┘                        │     alignSelf flex-start，不限宽
└─────────────────────────────────────┘
```

- 右侧 ✓/› 独立列，不参与文字换行计算
- 选中判定保留现有 (id + providerID) 双字段匹配——同名模型可能来自不同 provider（如 deepseek-v4-flash 同时存在于 opencode 与 opencode-go）

### 搜索框

- 标题下方 TextInput，placeholder「搜索模型…」，有输入时右侧显示 ✕ 清除按钮
- 过滤用 `useMemo`：`query` 为空返回全部；否则小写化后对 `${name} ${id} ${providerID}` 做子串匹配
- 弹窗打开时清空上次搜索词（`useEffect` 监听 `visible`）

### 空态

- 「No models loaded」— models 数组为空
- 「无匹配模型」— 有模型但搜索无结果

## 测试

新建 `apps/mobile/__tests__/ModelPickerModal.test.tsx`（照 SlashSheet.test.tsx 的 react-test-renderer 模式）：

1. 正常渲染：条目含模型名与服务商名两段文本
2. 按名称过滤、按服务商过滤均命中
3. 大小写不敏感
4. 无结果时显示「无匹配模型」
5. 点选回调收到完整 model 对象
6. 清除按钮清空搜索词并恢复全列表
7. 选中项高亮（✓）

同步检查 `ChatScreen.test.tsx` 中引用内嵌 picker 文案的断言并修正。

## 验证

```bash
cd apps/mobile && npx jest __tests__/ModelPickerModal.test.tsx
cd apps/mobile && npx jest __tests__/ChatScreen.test.tsx
```
