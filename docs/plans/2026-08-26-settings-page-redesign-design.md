# Settings 页面重构设计（清理死功能 + 补齐高价值设置项）

日期：2026-08-26
状态：已确认（用户批准）

## 背景与问题

Settings 页现有 7 个区块，经代码审计其中 3 个是"死"的：

| 区块 | 状态 | 依据 |
|------|------|------|
| Connection | ✅ 有用 | 只读，真实反映连接 |
| Project | ✅ 有用 | 只读 |
| Config（查看 + Edit JSON 弹窗） | ❌ 死功能 | Bridge `config.get` 是 stub 永远返回 `{config:{}}`；`config.update` 是 no-op 返回 `{ok:true}`。编辑保存无任何效果 |
| Providers 名单 | ⚠️ 半死 | 纯展示无操作，与 ChatScreen ModelPickerModal 重复 |
| Agents 名单 | ⚠️ 半死 | 纯展示无操作，与 ChatScreen switchAgent 重复 |
| Saved Permissions | ✅ 有用且独有 | `permission.saved.list/remove` 真实对接 SDK |
| Disconnect | ✅ 有用 | — |

主题目前跟随系统，用户决定本期不做手动切换。

## 决策记录

1. **方向**：清理 + 补齐高价值功能（非最小清理、非完整重设计）。
2. **新增项**：默认 Agent / 默认 Model、关于/版本信息、权限规则完整管理。主题切换不做。
3. **默认值存储位置**：方案 A——客户端本地持久化。
   - 备选 B（Bridge settings RPC）：需双侧协议改动 + 双侧测试，单用户场景收益趋近于零，否决。
   - 备选 C（只读展示 BRIDGE_DEFAULT_MODEL env）：无操作感且 agent 无默认机制，否决。

## 设计

### 1. 删减清单（客户端 + 服务端对齐）

| 删除项 | 位置 |
|--------|------|
| Config 区块 + Edit JSON Modal + configEdit state | `apps/mobile/src/screens/SettingsScreen.tsx` |
| `fetchConfig`/`updateConfig`/`config` 字段（登录 Promise.all 同步移除） | `apps/mobile/src/stores/configStore.ts` |
| `fetchProviders`/`providers` 字段 | `apps/mobile/src/stores/configStore.ts` |
| Providers / Agents 只读区块 | `SettingsScreen.tsx` |
| `config.get`/`config.update`/`config.providers` handler | `servers/bridge/src/server/router.ts` |

保留：`config.agents`、`model.list`、`command.list`（SlashSheet 与 ChatScreen 消费中）。

### 2. Defaults 区块（默认 Agent / 默认 Model）

- 新建 `stores/settingsStore.ts`：`defaultAgent: string | null`、`defaultModel: { id, providerID, variant? } | null`
- 持久化：复用已有 `react-native-blob-util` 写 `DocumentDir/settings.json`。
  不引入 AsyncStorage（新原生依赖需重打 APK），零原生改动。
- UI：
  - Default Agent 行 → Modal 单选，数据源 `configStore.agents`，含"清除（跟随服务端默认）"
  - Default Model 行 → 复用现有 `ModelPickerModal` 组件，数据源 `configStore.models`

### 3. 生效链路

`sessionStore.createSession` 内部读 `useSettingsStore.getState()`，
将 `agent` / `model` 传入 `session.create`。Bridge `session.create`
已支持两参数（对象形式 `{id, providerID, variant}` 已解析），调用方零改动，协议零变更。

### 4. Permissions 增强

- 去掉 `slice(0, 10)` 全量渲染
- 按 `rule.tool` 分组显示
- 删除前 `Alert.alert` 二次确认

### 5. About 区块

- App 版本：`src/config/appInfo.ts` 常量（与 package.json version 同步），不引入 react-native-device-info
- Bridge 版本：`health.ping` 响应扩展 `{ ok, bridgeVersion }`（读 bridge package.json）
  ——唯一协议变更点，响应字段追加、向后兼容
- OpenCode server 版本：SDK v2 无版本端点，本期不做

### 6. 测试计划

| 文件 | 内容 |
|------|------|
| `__tests__/settingsStore.test.ts`（新） | 持久化读写（mock blob-util）、设置/清除默认值 |
| `__tests__/SettingsScreen.test.tsx` | Defaults 选择交互、权限分组+删除确认断言、"不再渲染 Config/Providers"负向断言 |
| `__tests__/sessionStore.test.ts` | createSession 携带 defaults |
| Bridge `router.test.ts` | health.ping 返回 bridgeVersion；config.get/update/providers 返回 unknown method |

验证命令：
- `cd apps/mobile && npx jest`
- `cd servers/bridge && npm test`

## 风险与约束

- 接口对齐约束（AGENTS.md）：删 stub handler 与客户端调用必须同一提交内完成，双侧测试同步更新。
- `health.ping` 扩展仅追加字段，旧客户端不受影响。
- blob-util 文件写入失败时静默降级为内存态（不阻塞 UI）。
