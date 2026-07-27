# 手机客户端 E2E 测试用例 — 双观测层

每个 Flow 有两个版本：
- **UI 层** (Maestro YAML)：在 Android 模拟器上操作 App，校验 UI 渲染
- **协议层** (Node.js mjs)：WS 直连 Bridge，校验 RPC 数据

流程步骤完全一致，观测校验点不同。

---

## Flow 1：Core Chat

### 流程步骤

```
连接 → 创建 Session → 发消息 → 等待流式回复 → (如触发工具) 审批 → 等待最终回复
```

### UI 层校验点（Maestro）

| 步骤 | 校验点 | 预期 |
|------|--------|------|
| 连接 | `assertNotVisible: "Connect"` | 连接成功，ConnectScreen 消失 |
| 连接 | `assertVisible: "Chat"` | Tab 栏出现 |
| 创建 Session | `assertVisible: "Message"` | 输入框渲染，进入 ChatScreen |
| 发消息 | `assertVisible: "AI is thinking"` | 等待状态显示 |
| 流式回复 | `assertVisible: "Hello"` (timeout 60s) | 模型回复文本出现 |
| 工具审批 | `tapOn: "Approve"` | 权限弹窗出现并处理 |
| 工具进度 | `assertVisible: "Glob\|Read\|Shell"` (timeout 30s) | ToolProgressCard 渲染 |
| 最终回复 | `"AI is thinking"` 消失 | waiting 状态关闭 |

### 协议层校验点（Node.js mjs）

| 步骤 | RPC | 校验点 |
|------|-----|--------|
| 连接 | `auth.login` | 返回 `{ token: string }` |
| 连接后 | `health.ping` | 返回 `{ ok: true }` |
| 创建 Session | `session.create` | 返回包含 `id`（以 `ses_` 开头） |
| 发消息 | `message.send` | 返回 payload（prompt 提交成功） |
| SSE 事件 | `session.next.text.delta` | 收到至少一个 text delta 事件 |
| SSE 事件 | `session.next.text.ended` | text segment 正常结束 |
| SSE 事件 | `session.next.step.started` + `ended` | step 生命周期完整 |
| SSE 事件 | `session.next.tool.called` + `success/failed` | (如触发) tool 生命周期完整 |
| 最终事件 | `session.status` 中 `idle: true` | session 回到空闲 |

> 注意：协议层改发 "list files" 以更大概率触发工具调用。

---

## Flow 2：Session Management

### 流程步骤

```
连接 → 创建 Session → 返回列表 → 创建第二个 Session → 进入详情 → 重命名 → 删除
```

### UI 层校验点（Maestro）

| 步骤 | 校验点 | 预期 |
|------|--------|------|
| 连接 | `assertNotVisible: "Connect"` | 连接成功 |
| 创建第 1 个 | `assertVisible: "Message"` | 进入 Chat |
| 返回列表 | `assertVisible: "+ New"` | SessionsScreen 渲染 |
| 创建第 2 个 | `assertVisible: "Message"` | 第 2 个创建成功 |
| 打开详情 | `assertVisible: "Edit"` | SessionInfoModal 弹出 |
| 重命名 | `assertVisible: "Saved"` | 保存后新名称显示 |
| 删除 | 断言的 Session 不再出现 | 列表刷新 |

### 协议层校验点（Node.js mjs）

| 步骤 | RPC | 校验点 |
|------|-----|--------|
| 连接 | `auth.login` | 返回 token |
| Session create #1 | `session.create` | 返回 `id` |
| Session list | `session.list` | `data.length === 1` |
| Session create #2 | `session.create` | 返回不同的 id |
| Session list | `session.list` | `data.length === 2` |
| Session get | `session.get` | 返回 session 详情含 id/title |
| Session rename | `session.rename` | 返回成功，后续 `session.get` 验证 title 变更 |
| Session delete | `session.delete` | 返回成功 |
| Session list | `session.list` | `data.length === 1`（少了一个） |

---

## Flow 3：File Browser

### 流程步骤

```
连接 → 进 Files 标签 → 浏览目录 → 搜索文件 → 阅读文件内容
```

### UI 层校验点（Maestro）

| 步骤 | 校验点 | 预期 |
|------|--------|------|
| 连接 | `assertVisible: "Files"` | Tab 栏有 Files |
| 进入 Files | `assertVisible: "Search files"` | 文件列表渲染 |
| 搜索 | `assertVisible: "package.json"` | 搜索结果 |
| 进入目录 | `assertVisible: ".."` | 目录导航渲染 |
| 阅读文件 | `assertVisible: "name"` | 文件内容预览 |

### 协议层校验点（Node.js mjs）

| 步骤 | RPC | 校验点 |
|------|-----|--------|
| 连接 | `auth.login` + `project.switch` | 正常 |
| `file.list("/")` | `file.list` | 返回数组，每项含 `name`/`type`/`size`/`modified` |
| `file.list(src/)` | `file.list` | 进入子目录，验证 `..` 存在 |
| `file.search("main")` | `file.search` | 返回匹配项，每项含 `file`/`matches` |
| `file.read(package.json)` | `file.read` | 返回 `{ content: string }`，长度 > 0 |
| `file.info` | `file.info` | 返回 `{ path/type/size/permissions/modified }` |

---

## Flow 4：Settings & Disconnect

### 流程步骤

```
连接 → 进 Settings → 查看配置 → 查看 Saved Rules → 切回 Chat → 切回 Settings → 断连
```

### UI 层校验点（Maestro）

| 步骤 | 校验点 | 预期 |
|------|--------|------|
| 连接 | `assertVisible: "Settings"` | Tab 栏 |
| 进 Settings | `assertVisible: "Bridge URL"` | 连接状态区 |
| 查看配置 | `assertVisible: "Server Config"` | 配置展开 |
| 查 Saved Rules | `assertVisible: "Always Allow"` | 规则区可见 |
| 切回 Chat | `assertVisible: "+ New"` | Tab 切换正常 |
| 断连 | `assertVisible: "Connect"` | 回到 ConnectScreen |
| 断连后 | `assertNotVisible: "Chat"/"Files"/"Settings"` | Tab 栏消失 |

### 协议层校验点（Node.js mjs）

| 步骤 | RPC | 校验点 |
|------|-----|--------|
| 连接 | `auth.login` | 返回 token |
| `config.get` | `config.get` | 返回对象含有效配置 |
| `config.providers` | `config.providers` | 返回 providers 列表（可能空） |
| `config.agents` | `config.agents` | 返回 agents 列表（可能空） |
| `permission.saved.list` | `permission.saved.list` | 返回 saved rules（可能空） |
| `model.list` | `model.list` | 返回模型列表 |
| `vcs.get` | `vcs.get` | 返回 VCS 信息 |
| `auth.logout` | `auth.logout` | 返回成功 |
| 再次 `health.ping` | `health.ping` | 返回 `unauthorized`（token 已失效） |
