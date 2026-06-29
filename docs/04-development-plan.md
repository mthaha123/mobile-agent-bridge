# 开发计划：Mobile Agent Bridge

## 摘要

本文档描述了构建连接 AI 编码 Agent 服务器（OpenCode、Hermes、OpenClaw）的手机客户端桥接的分阶段开发计划。该计划优先考虑核心功能的早期交付，并根据用户反馈进行迭代增强。

---

## 1. 开发理念

### 1.1 核心原则

| 原则 | 描述 |
|------|------|
| **尽早交付价值** | 尽可能快地交付可用功能 |
| **迭代增强** | 构建、学习、改进 |
| **最小可行产品** | 首先聚焦核心工作流 |
| **质量基础** | 不积累技术债务 |

### 1.2 成功标准

| 里程碑 | 成功指标 |
|--------|----------|
| **Phase 1 完成** | 可连接 OpenCode，发送消息，查看响应 |
| **Phase 2 完成** | 可审批工具、浏览文件、管理会话 |
| **Phase 3 完成** | 生产就绪，可替代终端供移动端使用 |

---

## 2. 技术栈

### 2.1 手机客户端

| 组件 | 技术 | 理由 |
|------|------|------|
| **框架（Android/iOS）** | React Native | 跨平台，生态丰富 |
| **框架（HarmonyOS）** | ArkUI (ArkTS) | 原生鸿蒙 SDK |
| **语言** | TypeScript | 类型安全，开发体验好 |
| **状态管理** | Zustand | 简单、轻量 |
| **导航** | React Navigation | 标准，支持良好 |
| **HTTP/REST** | 原生 `fetch()` / Axios | 直接调用 OpenCode REST API |
| **SSE** | `react-native-sse` | 原生 EventSource polyfill，接收实时事件流 |
| **Markdown** | react-native-markdown | 原生渲染 |
| **语法高亮** | react-syntax-highlighter | 广泛语言支持 |
| **存储** | AsyncStorage / @ohos.data.preferences | 本地持久化 |

### 2.2 Bridge 服务器

| 组件 | 技术 | 理由 |
|------|------|------|
| **运行时** | Node.js/Bun | 与 OpenCode 相同 |
| **框架** | Express/Fastify | 轻量、快速 |
| **HTTP** | REST + SSE | 与 OpenCode 兼容 |
| **数据库** | SQLite | 本地存储 |
| **隧道** | Tailscale/FRP | 安全远程访问 |

---

## 3. Phase 1：核心 MVP（第 1-4 周）

### 3.1 目标

> 可连接 OpenCode 服务器，发送消息，接收响应，并查看它们。

### 3.2 功能

| 功能 | 优先级 | 工作量 |
|------|--------|--------|
| **服务器连接** | P0 | 2 天 |
| **聊天界面** | P0 | 5 天 |
| **流式令牌显示** | P0 | 3 天 |
| **会话列表** | P0 | 2 天 |
| **会话管理** | P0 | 2 天 |
| **基本设置** | P0 | 2 天 |

### 3.3 详细分解

#### 第 1 周：基础搭建

| 任务 | 描述 | 时间 |
|------|------|------|
| 1.1 | 项目初始化（React Native + TypeScript） | 1 天 |
| 1.2 | 导航结构（底部标签栏） | 0.5 天 |
| 1.3 | 状态管理配置（Zustand） | 0.5 天 |
| 1.4 | 实现 OpenCode REST 客户端（fetch/axios） | 1 天 |
| 1.5 | 实现 SSE 事件流客户端 | 1 天 |

> **注意：** 不能使用 `@opencode-ai/sdk`（依赖 Node.js）。必须手写 HTTP/SSE 协议。

#### 第 2 周：连接与聊天

| 任务 | 描述 | 时间 |
|------|------|------|
| 2.1 | 连接设置页面 | 1 天 |
| 2.2 | 服务器连接逻辑 | 1 天 |
| 2.3 | 聊天页面布局 | 1 天 |
| 2.4 | 消息输入组件 | 1 天 |
| 2.5 | 消息列表组件 | 1 天 |

#### 第 3 周：流式传输与会话

| 任务 | 描述 | 时间 |
|------|------|------|
| 3.1 | 流式令牌显示 | 1 天 |
| 3.2 | 会话列表页面 | 1 天 |
| 3.3 | 会话创建 | 0.5 天 |
| 3.4 | 会话切换 | 0.5 天 |
| 3.5 | 会话删除 | 0.5 天 |
| 3.6 | 消息历史加载 | 1 天 |

#### 第 4 周：打磨与测试

| 任务 | 描述 | 时间 |
|------|------|------|
| 4.1 | 错误处理 | 1 天 |
| 4.2 | 加载状态 | 0.5 天 |
| 4.3 | 单元测试 | 1 天 |
| 4.4 | 集成测试 | 1 天 |
| 4.5 | Bug 修复 | 0.5 天 |

### 3.4 交付物

- [ ] 可连接 OpenCode 服务器的移动应用
- [ ] 带流式响应的聊天界面
- [ ] 会话列表和管理
- [ ] 基本设置（服务器 URL、认证）
- [ ] 核心逻辑的单元测试

### 3.5 验证

| 测试用例 | 预期结果 |
|----------|----------|
| 连接 OpenCode 服务器 | 状态显示"已连接" |
| 发送消息 | 消息出现在聊天中 |
| 接收响应 | 令牌实时流式显示 |
| 创建会话 | 新会话出现在列表中 |
| 切换会话 | 消息正确加载 |
| 删除会话 | 会话从列表中移除 |

---

## 4. Phase 2：增强功能（第 5-8 周）

### 4.1 目标

> 可审批工具、浏览文件、查看代码、有效管理会话。

### 4.2 功能

| 功能 | 优先级 | 工作量 | OpenCode TUI 参考 |
|------|--------|--------|-------------------|
| **工具审批（含拒绝消息）** | P0 | 3 天 | `routes/session/permission.tsx` allow/once/always/reject |
| **14 种工具专用渲染器** | P0 | 5 天 | Shell/Read/Write/Edit/ApplyPatch/Glob/Grep 等专用组件 |
| **文件浏览器（@mention 式）** | P0 | 3 天 | `prompt/autocomplete.tsx` 模糊搜索 |
| **文件查看器** | P0 | 2 天 | `<markdown>` 元素 + 语法高亮 |
| **Markdown 渲染** | P0 | 2 天 | `packages/` 内 markdown 引擎 |
| **HTML 渲染** | P1 | 1 天 | 移动端特有，TUI 无 |
| **语法高亮** | P0 | 1 天 | TextMate 100+ scope |
| **Shell 模式（! 命令）** | P0 | 2 天 | `prompt/index.tsx` shell 模式检测 |
| **斜杠命令系统** | P0 | 2 天 | `keymap.tsx` 命令注册 |
| **Agent 颜色标记** | P1 | 0.5 天 | theme 中 per-agent color |
| **思考/推理折叠** | P1 | 1 天 | `ReasoningPart` 3 种模式 |
| **差异预览（权限时）** | P1 | 1 天 | `permission.tsx` 内联 diff |
| **Sidebar 信息面板** | P2 | 3 天 | `feature-plugins/sidebar/` Context/Files/LSP/MCP/Todo |
| **会话时间线** | P2 | 2 天 | `routes/session/dialog-timeline.tsx` |

### 4.3 详细分解

#### 第 5 周：工具系统

| 任务 | 描述 | 时间 | OpenCode 源码参考 |
|------|------|------|-------------------|
| 5.1 | Shell 命令渲染器（含输出折叠、$ 前缀） | 1 天 | `route/session/index.tsx` tool Shell |
| 5.2 | Read/Write/Edit 文件渲染器 | 1 天 | `route/session/index.tsx` tool Read/Write/Edit |
| 5.3 | Glob/Grep 搜索渲染器 | 0.5 天 | `route/session/index.tsx` tool Glob/Grep |
| 5.4 | WebFetch/WebSearch 渲染器 | 0.5 天 | `route/session/index.tsx` tool WebFetch/WebSearch |
| 5.5 | Task(子Agent)/Question/Skill/TodoWrite 渲染器 | 1 天 | `route/session/index.tsx` |

#### 第 6 周：权限与 Question

| 任务 | 描述 | 时间 | OpenCode 源码参考 |
|------|------|------|-------------------|
| 6.1 | 权限审批组件（allow once/always/reject+消息） | 1 天 | `routes/session/permission.tsx` |
| 6.2 | 权限差异预览（Edit 工具内联 diff） | 0.5 天 | `permission.tsx` diff preview |
| 6.3 | Question 多步向导（多选、确认流程） | 1 天 | `routes/session/question.tsx` |
| 6.4 | 文件搜索（@mention 风格） | 1 天 | `component/prompt/autocomplete.tsx` fuzzysort |

#### 第 7 周：文件与显示

| 任务 | 描述 | 时间 | OpenCode 源码参考 |
|------|------|------|-------------------|
| 7.1 | 文件浏览器（目录树 + Git 状态） | 1 天 | `feature-plugins/sidebar/files.tsx` |
| 7.2 | 文件查看器（语法高亮 + 行号） | 1 天 | `feature-plugins/sidebar/` |
| 7.3 | 思考/推理折叠组件 | 0.5 天 | `ReasoningPart` 3 种模式 |
| 7.4 | Shell 模式（! 命令输入检测） | 0.5 天 | `prompt/index.tsx` shell mode |

#### 第 8 周：打磨与测试

| 任务 | 描述 | 时间 | OpenCode 源码参考 |
|------|------|------|-------------------|
| 8.1 | Markdown 渲染 + 代码块高亮 | 0.5 天 | `<markdown>` element |
| 8.2 | HTML 渲染（安全清理） | 0.5 天 | 移动端特有 |
| 8.3 | Agent 切换 + 模型选择 | 0.5 天 | `dialog-agent.tsx` + `dialog-model.tsx` |
| 8.4 | Sidebar 信息面板（LSP/MCP/Todo） | 1 天 | `feature-plugins/sidebar/` |
| 8.5 | 单元测试 + 集成测试 | 1.5 天 |

### 4.4 交付物

- [ ] 14 种工具专用渲染器（Shell/Read/Write/Edit/ApplyPatch/Glob/Grep/WebFetch/WebSearch/Task/Question/Skill/TodoWrite/GenericTool）
- [ ] 权限审批系统（allow once / always / reject with message）
- [ ] 权限差异预览（Edit 工具内联 diff）
- [ ] Question 多步向导
- [ ] Shell 模式（! 命令）
- [ ] 文件浏览器（@mention 模糊搜索）
- [ ] 文件查看器（语法高亮）
- [ ] Markdown 渲染
- [ ] HTML 渲染（安全清理、沙箱隔离）
- [ ] Agent 切换 + 模型选择
- [ ] Sidebar 信息面板
- [ ] 思考/推理折叠显示
- [ ] 单元测试 + 集成测试

### 4.5 验证

| 测试用例 | 预期结果 |
|----------|----------|
| Agent 请求工具 | 权限对话框出现 |
| 批准工具 | 工具执行 |
| 拒绝工具 | 工具跳过 |
| 浏览目录 | 文件正确列出 |
| 查看文件 | 内容带语法高亮显示 |
| 查看 Markdown | 正确渲染 |

---

## 5. Phase 3：生产就绪（第 9-12 周）

### 5.1 目标

> 生产就绪的应用，可替代终端供移动端使用。

### 5.2 功能

| 功能 | 优先级 | 工作量 |
|------|--------|--------|
| **离线模式** | P2 | 3 天 |
| **推送通知** | P1 | 2 天 |
| **语音输入** | P2 | 2 天 |
| **图片粘贴** | P2 | 1 天 |
| **多服务器** | P2 | 2 天 |
| **键盘快捷键** | P3 | 2 天 |
| **主题系统** | P3 | 2 天 |
| **会话导出** | P3 | 1 天 |
| **插件系统** | P3 | 4 天 |
| **性能优化** | P1 | 2 天 |

### 5.3 详细分解

#### 第 9 周：离线与通知

| 任务 | 描述 | 时间 |
|------|------|------|
| 9.1 | 本地会话缓存 | 1 天 |
| 9.2 | 离线消息队列 | 1 天 |
| 9.3 | 推送通知配置 | 1 天 |
| 9.4 | 通知处理 | 1 天 |

#### 第 10 周：输入增强

| 任务 | 描述 | 时间 |
|------|------|------|
| 10.1 | 语音输入（Whisper） | 1.5 天 |
| 10.2 | 图片粘贴 | 0.5 天 |
| 10.3 | 文件附件 | 0.5 天 |
| 10.4 | 斜杠命令 | 0.5 天 |

#### 第 11 周：主题与快捷键

| 任务 | 描述 | 时间 |
|------|------|------|
| 11.1 | 主题系统（亮/暗/跟随系统 + 自定义） | 1 天 |
| 11.2 | 键盘快捷键系统（Modal keybind） | 1 天 |
| 11.3 | 会话导出（Markdown） | 0.5 天 |
| 11.4 | 插件系统设计 | 1 天 |

#### 第 12 周：性能与打磨

| 任务 | 描述 | 时间 |
|------|------|------|
| 12.1 | 插件系统实现 | 1.5 天 |
| 12.2 | 性能优化 | 1 天 |
| 12.3 | 无障碍支持 | 0.5 天 |
| 12.4 | 国际化 | 0.5 天 |
| 12.5 | 最终测试 | 0.5 天 |

### 5.4 交付物

- [ ] 带缓存的离线模式
- [ ] 推送通知
- [ ] 语音输入
- [ ] 图片粘贴
- [ ] 多服务器支持
- [ ] 键盘快捷键系统
- [ ] 主题系统（亮/暗/系统/自定义）
- [ ] 会话导出
- [ ] 插件系统
- [ ] 性能优化
- [ ] 无障碍支持
- [ ] 国际化

### 5.5 验证

| 测试用例 | 预期结果 |
|----------|----------|
| 进入离线状态 | 缓存的会话可用 |
| 收到通知 | 点击打开应用 |
| 语音输入 | 文本正确转录 |
| 粘贴图片 | 图片附加到消息 |
| 导出会话 | 可下载文件 |
| 切换服务器 | 消息正确加载 |

---

## 6. Bridge 服务器开发

### 6.1 Phase 1：基础服务器（第 1-2 周）

| 任务 | 描述 | 时间 |
|------|------|------|
| 6.1.1 | 项目配置 | 0.5 天 |
| 6.1.2 | HTTP 路由 | 0.5 天 |
| 6.1.3 | SSE 管理器 | 0.5 天 |
| 6.1.4 | OpenCode 适配器 | 1 天 |
| 6.1.5 | 认证 | 0.5 天 |

### 6.2 Phase 2：隧道与安全（第 3-4 周）

| 任务 | 描述 | 时间 |
|------|------|------|
| 6.2.1 | Tailscale 集成 | 1 天 |
| 6.2.2 | FRP 集成 | 1 天 |
| 6.2.3 | 令牌管理 | 0.5 天 |
| 6.2.4 | 频率限制 | 0.5 天 |
| 6.2.5 | 日志记录 | 0.5 天 |

### 6.3 Phase 3：高级功能（第 5-6 周）

| 任务 | 描述 | 时间 |
|------|------|------|
| 6.3.1 | Hermes 适配器 | 1.5 天 |
| 6.3.2 | OpenClaw 适配器 | 1.5 天 |
| 6.3.3 | 多服务器路由 | 1 天 |
| 6.3.4 | 健康监控 | 0.5 天 |

---

## 7. 项目结构

### 7.1 移动应用结构

```
mobile-agent-bridge/
├── apps/
│   ├── mobile/                    # React Native 应用 (Android + iOS)
│   │   ├── src/
│   │   │   ├── components/        # 可复用 UI 组件
│   │   │   ├── screens/           # 页面组件
│   │   │   ├── stores/            # Zustand 状态存储
│   │   │   ├── services/          # API 和网络
│   │   │   ├── types/             # TypeScript 类型
│   │   │   └── App.tsx
│   │   ├── android/               # Android 特定
│   │   ├── ios/                   # iOS 特定
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── harmony/                   # HarmonyOS 应用 (ArkUI ArkTS)
│       ├── entry/
│       │   ├── src/main/
│       │   │   ├── ets/           # ArkTS 源码
│       │   │   │   ├── components/
│       │   │   │   ├── pages/
│       │   │   │   └── services/
│       │   │   ├── resources/
│       │   │   └── module.json5
│       │   └── build-profile.json5
│       ├── packages/              # HAR 包
│       └── oh-package.json5
├── servers/
│   └── bridge/                    # Bridge 服务器（核心组件）
│       ├── src/
│       │   ├── server/            # WebSocket 服务器（手机→桥）
│       │   │   ├── ws.ts          # WebSocket 连接管理
│       │   │   ├── session.ts     # 手机请求→SDK 调用路由
│       │   │   └── auth.ts        # JWT 认证
│       │   ├── adapters/          # Agent 适配器（桥→Agent）
│       │   │   ├── OpenCodeAdapter.ts  # 使用 @opencode-ai/sdk
│       │   │   ├── HermesAdapter.ts    # JSON-RPC over stdio
│       │   │   └── OpenClawAdapter.ts  # WebSocket
│       │   ├── tunnel/            # 内网穿透管理
│       │   │   ├── tailscale.ts
│       │   │   └── frp.ts
│       │   ├── types/
│       │   └── index.ts
│       ├── __tests__/
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── shared/                    # 共享代码
│       ├── src/
│       │   ├── types/             # 通用类型
│       │   ├── constants/         # 共享常量
│       │   └── utils/             # 共享工具
│       ├── package.json
│       └── tsconfig.json
├── docs/                          # 文档
│   ├── 01-agent-systems-comparison.md
│   ├── 02-mobile-ui-feature-requirements.md
│   ├── 03-architecture-design.md
│   └── 04-development-plan.md
├── package.json                   # Monorepo 根
├── pnpm-workspace.yaml
└── tsconfig.json
```

---

## 8. 团队与资源

### 8.1 团队角色

| 角色 | 职责 | 数量 |
|------|------|------|
| **移动端开发** | React Native / ArkUI 应用开发 | 1-2 |
| **后端开发** | Bridge 服务器开发 | 1 |
| **设计师** | UI/UX 设计 | 0.5 |
| **QA** | 测试和质量保证 | 0.5 |

### 8.2 开发环境

| 工具 | 用途 |
|------|------|
| **VS Code** | IDE |
| **Android Studio** | Android 开发 |
| **Xcode** | iOS 开发 |
| **DevEco Studio** | HarmonyOS 开发 |
| **Git** | 版本管理 |
| **pnpm** | 包管理 |
| **Docker** | Bridge 服务器部署 |

---

## 9. 风险管理

### 9.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| React Native 性能 | 高 | 尽早分析，优化关键路径 |
| SSE 连接稳定性 | 高 | 实现重连、离线支持 |
| iOS 键盘问题 | 中 | 真机测试，使用原生输入 |
| 内存使用 | 中 | 实现分页、懒加载 |

### 9.2 进度风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 范围蔓延 | 高 | 严格阶段边界，聚焦 MVP |
| 依赖问题 | 中 | 使用稳定库，准备备选 |
| 测试延迟 | 中 | 尽早自动化测试 |

---

## 10. 成功指标

### 10.1 Phase 1 成功

| 指标 | 目标 |
|------|------|
| **连接成功率** | > 95% |
| **消息发送** | < 100ms |
| **流式延迟** | < 50ms |
| **崩溃率** | < 1% |
| **用户满意度** | > 4.0/5.0 |

### 10.2 Phase 2 成功

| 指标 | 目标 |
|------|------|
| **工具审批时间** | < 2s |
| **文件加载时间** | < 1s |
| **会话切换时间** | < 500ms |
| **内存使用** | < 150MB |
| **电池使用** | < 3%/小时 |

### 10.3 Phase 3 成功

| 指标 | 目标 |
|------|------|
| **离线可用性** | > 90% 缓存数据 |
| **通知送达** | < 5s |
| **语音识别准确率** | > 95% |
| **应用商店评分** | > 4.5/5.0 |
| **日活跃用户** | > 1000 |

---

## 11. 时间线总结

```
第 1-4 周:   Phase 1 - 核心 MVP
              ├── 连接 + 聊天
              ├── 流式传输
              └── 会话管理

第 5-8 周:   Phase 2 - 增强功能
              ├── 工具审批
              ├── 文件浏览器
              └── 文件查看器

第 9-12 周:  Phase 3 - 生产就绪
              ├── 离线模式
              ├── 通知
              └── 性能优化

第 13+ 周:   维护与增强
              ├── Bug 修复
              ├── 用户反馈
              └── 新功能
```

---

## 12. 后续步骤

### 12.1 立即可执行动作

1. [ ] 搭建项目结构
2. [ ] 初始化 React Native 应用
3. [ ] 创建 Bridge 服务器骨架
4. [ ] 实现 OpenCode 适配器
5. [ ] 构建基本聊天界面

### 12.2 第 1 周目标

1. [ ] 项目配置完成
2. [ ] 导航功能正常
3. [ ] 状态管理到位
4. [ ] 原生 HTTP REST 客户端实现完成（fetch/axios）
5. [ ] SSE 事件流客户端实现完成（react-native-sse）

---

*文档版本：1.0*
*最后更新：2026-06-28*
