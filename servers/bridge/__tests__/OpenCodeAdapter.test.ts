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
      expect(ctx.requests[0]).toContain("order=desc")
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
