/**
 * OpenCodeAdapter.rawSessionMessages 契约测试
 *
 * 锁定三条客户端无感契约：
 *   1. messages 恒定升序（旧→新）——无论哪条通道胜出、底层返回什么顺序
 *   2. 选边：新鲜度(max created)优先 → 数量 → v1 兜底
 *   3. cursor 绑定来源通道（v1:/v2: 前缀），翻页只路由到对应通道；遗留无前缀 cursor 走双通道兼容
 */
import { jest } from "@jest/globals"
import http from "http"
import type { Server } from "http"
import {
  initBackend,
  getBackend,
  sortMessagesAsc,
  pickChannel,
  tagCursor,
  parseTaggedCursor,
} from "../src/adapters/OpenCodeAdapter.js"

// ─── 测试工具 ────────────────────────────────────────────────

function mkMsg(id: string, created: number, role = "user") {
  return { info: { id, role, time: { created } }, parts: [{ type: "text", text: `t-${id}` }] }
}

function json(res: http.ServerResponse, obj: unknown, headers?: Record<string, string>) {
  res.writeHead(200, { "content-type": "application/json", ...(headers ?? {}) })
  res.end(JSON.stringify(obj))
}

interface MockCtx {
  port: number
  requests: string[]
  close(): Promise<void>
}

/** 启动 mock opencode server；routeHandler 按 v1/v2 分发（/api/ 前缀=v2，其余 /session/=v1） */
async function startMockServer(
  routeHandler: (channel: "v1" | "v2", reqUrl: string, res: http.ServerResponse) => void,
): Promise<MockCtx> {
  const requests: string[] = []
  const server: Server = http.createServer((req, res) => {
    const url = req.url || ""
    requests.push(url)
    const channel: "v1" | "v2" = url.startsWith("/api/") ? "v2" : "v1"
    routeHandler(channel, url, res)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  return {
    port,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function freshBackend(port: number) {
  initBackend(`http://127.0.0.1:${port}`)
  return getBackend()
}

const SID = "sess_test"

// ─── 选边 + 归一化（初始加载，无 cursor） ─────────────────────

describe("rawSessionMessages 初始加载：选边与归一化", () => {
  it("双通道平局(数量相同)且 v1 更新鲜 → 选 v1，输出按 created 升序，cursor 带 v1: 前缀", async () => {
    const ctx = await startMockServer((channel, _url, res) => {
      if (channel === "v1") {
        // 故意乱序返回（服务端真实顺序不可控），验证归一化
        json(res, [mkMsg("m_new", 3000), mkMsg("m_mid", 2000), mkMsg("m_old", 1000)], {
          link: `<http://127.0.0.1/session/${SID}/message?limit=50&before=tokA>; rel="next"`,
        })
      } else {
        // v2 投影滞后：最新只到 2500 < v1 的 3000（原始 HTTP 形状：{data:[...]}）
        json(res, { data: [mkMsg("p1", 2500), mkMsg("p0", 2400)], cursor: "proj-cursor-1" })
      }
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages(SID, { limit: 50 })
      expect(result.messages.map((m: any) => m.info.id)).toEqual(["m_old", "m_mid", "m_new"])
      expect(result.cursor).toBe("v1:tokA")
      // 双通道都被请求过
      expect(ctx.requests.some((u) => u.startsWith("/api/"))).toBe(true)
      expect(ctx.requests.some((u) => !u.startsWith("/api/") && u.includes("/session/"))).toBe(true)
    } finally {
      await ctx.close()
    }
  })

  it("同新鲜度时数量多者胜（v2 多 → 选 v2），输出升序，cursor 带 v2: 前缀", async () => {
      const ctx = await startMockServer((channel, _url, res) => {
      if (channel === "v1") {
        json(res, [mkMsg("a", 100), mkMsg("b", 500)])
      } else {
        json(res, { data: [mkMsg("x", 900), mkMsg("y", 300), mkMsg("z", 100), mkMsg("w", 400), mkMsg("v", 500)], cursor: "proj-cursor-2" })
      }
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages(SID, {})
      expect(result.messages.map((m: any) => m.info.id)).toEqual(["z", "y", "w", "v", "x"])
      expect(result.cursor).toBe("v2:proj-cursor-2")
    } finally {
      await ctx.close()
    }
  })

  it("v1 为空 → v2 胜出并升序输出（部分会话数据只在投影表）", async () => {
    const ctx = await startMockServer((channel, _url, res) => {
      if (channel === "v1") json(res, [])
      else json(res, { data: [mkMsg("q2", 800), mkMsg("q1", 700)], cursor: "proj-cursor-3" })
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages(SID, {})
      expect(result.messages.map((m: any) => m.info.id)).toEqual(["q1", "q2"])
      expect(result.cursor).toBe("v2:proj-cursor-3")
    } finally {
      await ctx.close()
    }
  })

  it("v2 投影为空 → v1 胜出并升序输出（投影表缺失场景）", async () => {
    const ctx = await startMockServer((channel, _url, res) => {
      if (channel === "v1") {
        json(res, [mkMsg("n2", 900), mkMsg("n1", 100)], {
          link: `<http://127.0.0.1/session/${SID}/message?limit=50&before=tokB>; rel="next"`,
        })
      }
      else json(res, { data: [] })
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages(SID, {})
      expect(result.messages.map((m: any) => m.info.id)).toEqual(["n1", "n2"])
      expect(result.cursor).toBe("v1:tokB")
    } finally {
      await ctx.close()
    }
  })

  it("双侧皆空 → 返回空数组", async () => {
    const ctx = await startMockServer((_channel, _url, res) => {
      json(res, _channel === "v1" ? [] : { data: [] })
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages(SID, {})
      expect(result.messages).toEqual([])
    } finally {
      await ctx.close()
    }
  })
})

// ─── cursor 通道绑定（翻页） ─────────────────────────────────

describe("rawSessionMessages 翻页：cursor 绑定来源通道", () => {
  it("v1: 前缀 cursor → 只请求 v1 路由（before=token），从 Link 头提取下一页并保留前缀", async () => {
    const ctx = await startMockServer((channel, _url, res) => {
      if (channel === "v1") {
        json(res, [mkMsg("old2", 50), mkMsg("old1", 40)], {
          link: `<http://127.0.0.1/session/${SID}/message?limit=50&before=tok099>; rel="next"`,
        })
      } else {
        json(res, { data: [mkMsg("should-not-appear", 99999)] })
      }
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages(SID, { cursor: "v1:tok123" })
      // 只查了 v1（一次请求），v2 未被触碰
      expect(ctx.requests.filter((u) => u.startsWith("/api/"))).toHaveLength(0)
      expect(ctx.requests).toHaveLength(1)
      expect(ctx.requests[0]).toContain("before=tok123")
      expect(result.messages.map((m: any) => m.info.id)).toEqual(["old1", "old2"])
      expect(result.cursor).toBe("v1:tok099")
    } finally {
      await ctx.close()
    }
  })

  it("v2: 前缀 cursor → 只请求 v2 路由（cursor=token）", async () => {
    const ctx = await startMockServer((channel, _url, res) => {
      if (channel === "v2") {
        json(res, { data: [mkMsg("p2", 60), mkMsg("p1", 50)], cursor: "proj-cursor-2" })
      } else {
        json(res, [mkMsg("should-not-appear", 99999)])
      }
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages(SID, { cursor: "v2:tok456" })
      expect(ctx.requests.filter((u) => !u.startsWith("/api/"))).toHaveLength(0)
      expect(ctx.requests[0]).toContain("cursor=tok456")
      // 新契约：cursor 自描述方向，带 cursor 时不能再拼 order=desc（否则服务端 400）
      expect(ctx.requests[0]).not.toContain("order=desc")
      expect(result.messages.map((m: any) => m.info.id)).toEqual(["p1", "p2"])
      expect(result.cursor).toBe("v2:proj-cursor-2")
    } finally {
      await ctx.close()
    }
  })

  it("遗留无前缀 cursor（旧版客户端）→ 双通道都查，向后兼容", async () => {
    const ctx = await startMockServer((channel, _url, res) => {
      if (channel === "v1") json(res, [mkMsg("l1", 10)])
      else json(res, { data: [] })
    })
    try {
      await freshBackend(ctx.port).rawSessionMessages(SID, { cursor: "legacy-raw-token" })
      expect(ctx.requests.some((u) => u.startsWith("/api/"))).toBe(true)
      expect(ctx.requests.some((u) => !u.startsWith("/api/") && u.includes("/session/"))).toBe(true)
    } finally {
      await ctx.close()
    }
  })
})

// ─── 纯函数单元 ──────────────────────────────────────────────

describe("sortMessagesAsc / pickChannel / cursor 工具", () => {
  it("sortMessagesAsc：created 缺失时按 id 字母序兜底（确定性输出）", () => {
    const noTimeA = { info: { id: "b" } }
    const noTimeB = { info: { id: "a" } }
    const timed = mkMsg("m", 100)
    const out = sortMessagesAsc([noTimeA, timed, noTimeB]) as any[]
    expect(out.map((m) => m.info.id)).toEqual(["a", "b", "m"])
  })

  it("pickChannel：空 vs 空 → v1；新鲜度并列且数量并列 → v1", () => {
    expect(pickChannel([], [])).toBe("v1")
    expect(pickChannel([mkMsg("a", 1)], [mkMsg("b", 1)])).toBe("v1")
  })

  it("tagCursor / parseTaggedCursor 往返一致；无前缀解析为 null", () => {
    expect(tagCursor("v1", "tok")).toBe("v1:tok")
    expect(tagCursor("v2", undefined)).toBeUndefined()
    expect(parseTaggedCursor("v1:tok")).toEqual({ channel: "v1", token: "tok" })
    expect(parseTaggedCursor("v2:tok")).toEqual({ channel: "v2", token: "tok" })
    expect(parseTaggedCursor("legacy")).toBeNull()
    expect(parseTaggedCursor(undefined)).toBeNull()
  })
})

// ─── autoNameNewSession（serve 自动命名：显式模型驱动） ───────────────────

import { cleanGeneratedTitle } from "../src/adapters/OpenCodeAdapter.js"

/** 独立 mock：可捕获请求体（PATCH 标题断言需要） */
async function startAutoNameMock(opts: {
  realTitle?: string
  realModel?: { providerID: string; id: string }
  assistantText?: string
}) {
  const requests: Array<{ method: string; url: string; body: string }> = []
  let patched = ""
  const server: Server = http.createServer((req, res) => {
    const url = req.url || ""
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString()
      requests.push({ method: req.method || "", url, body })
      if (url === "/api/session" && req.method === "POST") {
        json(res, { data: { id: "temp_sess_1" } })
        return
      }
      if (url.startsWith("/api/session/") && !url.includes("message")) {
        json(res, {
          data: {
            id: "sess_default_title",
            title: opts.realTitle ?? "New session - 2026-08-25T00:00:00Z",
            ...(opts.realModel ? { model: opts.realModel } : {}),
          },
        })
        return
      }
      if (url.startsWith("/session/temp_sess_1/message")) {
        if (req.method === "POST") {
          res.writeHead(200); res.end("{}"); return
        }
        // 轮询读回：assistant 回复即标题来源
        json(res, [
          { info: { id: "m1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "seed" }] },
          { info: { id: "m2", role: "assistant", time: { created: 2 } }, parts: [{ type: "text", text: opts.assistantText ?? "" }] },
        ])
        return
      }
      if (url === "/session/sess_default_title" && req.method === "PATCH") {
        try { patched = JSON.parse(body)?.title ?? "" } catch {}
        res.writeHead(200); res.end("{}"); return
      }
      if (url === "/session/temp_sess_1" && req.method === "DELETE") {
        res.writeHead(200); res.end("{}"); return
      }
      res.writeHead(404); res.end("{}")
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as { port: number }).port
  initBackend(`http://127.0.0.1:${port}`)
  return {
    backend: getBackend(),
    requests,
    get patchedTitle() { return patched },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe("autoNameNewSession（显式模型驱动）", () => {
  it("全链路：读模型→带显式模型建临时会话→种子→轮询标题→PATCH→DELETE，且不调用 summarize", async () => {
    const ctx = await startAutoNameMock({
      realModel: { providerID: "opencode-go", id: "ox-alpha-free" },
      assistantText: "\"移动端桥接项目架构分析\"。",
    })
    try {
      const r = await ctx.backend.autoNameNewSession("sess_default_title", "首条消息文本", "D:\\code")
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(r).toBe(true)
      // 创建临时会话时必须携带真实会话的显式模型（防回落欠费默认模型）
      const createBody = ctx.requests.find((q) => q.url === "/api/session")?.body ?? ""
      expect(createBody).toContain("opencode-go")
      expect(createBody).toContain("ox-alpha-free")
      // 种子写入临时会话
      expect(ctx.requests.some((q) => q.url.startsWith("/session/temp_sess_1/message") && q.method === "POST")).toBe(true)
      // 绝不再调用 summarize（其依赖的 small_model 可能欠费失效）
      expect(ctx.requests.some((q) => q.url.includes("/summarize"))).toBe(false)
      // PATCH 的标题经过清洗（去引号/句号）
      expect(ctx.patchedTitle).toBe("移动端桥接项目架构分析")
      // 临时会话清理
      expect(ctx.requests.some((q) => q.url === "/session/temp_sess_1" && q.method === "DELETE")).toBe(true)
    } finally {
      await ctx.close()
    }
  }, 60000)

  it("自定义标题会话：只做一次 GET 即返回 false（尊重手动命名）", async () => {
    const ctx = await startAutoNameMock({ realTitle: "我的重要会话" })
    try {
      const r = await ctx.backend.autoNameNewSession("sess_default_title", "文本")
      expect(r).toBe(false)
      expect(ctx.requests.filter((q) => q.url.startsWith("/api/session")).length).toBe(1)
      expect(ctx.requests.some((q) => q.url === "/api/session")).toBe(false)
    } finally {
      await ctx.close()
    }
  })

  it("真实会话缺模型信息：跳过并返回 false，不创建临时会话", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const ctx = await startAutoNameMock({ realModel: undefined as any })
    try {
      const r = await ctx.backend.autoNameNewSession("sess_default_title", "文本")
      expect(r).toBe(false)
      expect(ctx.requests.some((q) => q.url === "/api/session")).toBe(false)
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
      await ctx.close()
    }
  })

  it("模型无有效输出（如 provider 欠费 402 静默失败）：轮询超时返回 false 且不 PATCH", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const ctx = await startAutoNameMock({
      realModel: { providerID: "deepseek", id: "deepseek-v4-flash" },
      assistantText: "", // 模拟 deepseek 欠费后静默空回复
    })
    try {
      // 注入短超时（真实定时器），验证轮询耗尽后返回 false 且不 PATCH
      const r = await ctx.backend.autoNameNewSession("sess_default_title", "文本", undefined, { readTimeoutMs: 400 })
      expect(r).toBe(false)
      expect(ctx.patchedTitle).toBe("")
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
      await ctx.close()
    }
  }, 30000)

  it("cleanGeneratedTitle 清洗规则", () => {
    expect(cleanGeneratedTitle("\"移动端桥接项目架构分析\"。")).toBe("移动端桥接项目架构分析")
    expect(cleanGeneratedTitle("标题：会话自动命名机制调查")).toBe("会话自动命名机制调查")
    expect(cleanGeneratedTitle("「多行标题\n第二行不要」")).toBe("多行标题")
    expect(cleanGeneratedTitle("   ")).toBe("")
  })
})

// ─── 消息记录形态归一化（Bridge 隔离职责） ────────────────────────────────

describe("消息记录形态归一化：v2 投影形态 → 规范 {info, parts}", () => {
  // 模拟真实 v2 投影记录（字段名与 v1 完全不同）
  const v2Assistant = {
    id: "msg_v2_a",
    time: { created: 2000 },
    type: "assistant",
    agent: "build",
    model: { id: "deepseek-v4-flash", providerID: "opencode-go" },
    content: [
      { type: "tool", id: "call_1", name: "bash", state: { status: "completed", input: { command: "ls" } } },
      { type: "text", text: "回答文本" },
    ],
    snapshot: {},
  }
  const v2User = { id: "msg_v2_u", time: { created: 1000 }, type: "user", text: "用户提问" }

  it("v2 记录输出为规范 {info,parts}：type→role、content→parts、顶层 text 包装成 text part", async () => {
    const ctx = await startMockServer((_channel, _url, res) => {
      json(res, { data: [v2Assistant, v2User] }) // 故意乱序，验证排序+归一化同时生效
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages("sess_x", {})
      const msgs = result.messages as any[]
      expect(msgs.map((m) => m.info.id)).toEqual(["msg_v2_u", "msg_v2_a"]) // 升序
      expect(msgs[0].info.role).toBe("user")          // type 映射为 role
      expect(msgs[0].parts[0].text).toBe("用户提问")   // 顶层 text → text part
      expect(msgs[1].info.role).toBe("assistant")
      expect(msgs[1].parts[0].type).toBe("tool")       // content[] → parts[]
      expect(msgs[1].parts[0].name).toBe("bash")
      expect(msgs[1].parts[1]).toEqual({ type: "text", text: "回答文本" })
    } finally {
      await ctx.close()
    }
  })

  it("v1 形态记录原样保留（不二次包装）", async () => {
    const ctx = await startMockServer((_channel, _url, res) => {
      json(res, [{ info: { id: "m1", role: "user", time: { created: 5 } }, parts: [{ type: "text", text: "hi" }] }])
    })
    try {
      const result = await freshBackend(ctx.port).rawSessionMessages("sess_x", {})
      const m = (result.messages as any[])[0]
      expect(m.info.role).toBe("user")
      expect(m.parts[0].text).toBe("hi")
    } finally {
      await ctx.close()
    }
  })
})

// ─── SSE 长连接空闲超时判定 ──────────────────────────────────

describe("resolveHttpIdleTimeoutMs", () => {
  it("SSE 订阅端点 /event 返回 0（禁用空闲超时，防静默断流丢事件）", async () => {
    const { resolveHttpIdleTimeoutMs } = await import("../src/adapters/OpenCodeAdapter.js")
    expect(resolveHttpIdleTimeoutMs("/event")).toBe(0)
    expect(resolveHttpIdleTimeoutMs("/global/event")).toBe(0)
    expect(resolveHttpIdleTimeoutMs("/event/")).toBe(0)
    expect(resolveHttpIdleTimeoutMs("/EVENT")).toBe(0)
  })

  it("普通 RPC 端点维持 120s 兜底", async () => {
    const { resolveHttpIdleTimeoutMs } = await import("../src/adapters/OpenCodeAdapter.js")
    expect(resolveHttpIdleTimeoutMs("/session/abc/message")).toBe(120000)
    expect(resolveHttpIdleTimeoutMs("/api/session")).toBe(120000)
    expect(resolveHttpIdleTimeoutMs("/events")).toBe(120000)
    expect(resolveHttpIdleTimeoutMs("/globalevent")).toBe(120000)
  })
})
