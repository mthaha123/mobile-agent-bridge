import net from "net"
import {
  parseListeningPids,
  candidateOrder,
  probePortFree,
  classifyServePort,
  isProcessAlive,
} from "../src/state/portUtils.js"
import { resolveMaxServes, DEFAULT_SERVE_PORT_POOL, DEFAULT_MAX_SERVES } from "../src/config.js"

/** 在回环随机端口起一个监听，返回 { port, close } */
function listenOnRandomPort(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

describe("portUtils.parseListeningPids", () => {
  const sample = [
    "  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       23204",
    "  TCP    127.0.0.1:4100         0.0.0.0:0              LISTENING       17524",
    "  TCP    [::]:4100              [::]:0                 LISTENING       17524",
    "  TCP    127.0.0.1:41000        0.0.0.0:0              LISTENING       99999",
    "  TCP    127.0.0.1:4100         127.0.0.1:5555         ESTABLISHED     11111",
  ].join("\r\n")

  it("只取 LISTENING 且精确匹配 :port（不误命中 :41000）", () => {
    expect(parseListeningPids(sample, 4100).sort()).toEqual([17524])
  })

  it("支持 IPv6 行并去重", () => {
    const withTwo = sample + "\r\n  TCP    127.0.0.1:4100         0.0.0.0:0              LISTENING       22222"
    expect(parseListeningPids(withTwo, 4100).sort()).toEqual([17524, 22222])
  })

  it("无匹配返回空数组", () => {
    expect(parseListeningPids(sample, 4199)).toEqual([])
  })
})

describe("portUtils.candidateOrder", () => {
  const pool = [4100, 4101, 4102, 4103, 4104]

  it("默认从池首顺序返回", () => {
    expect(candidateOrder(pool)).toEqual(pool)
  })

  it("cursor 轮转起点", () => {
    expect(candidateOrder(pool, { cursor: 3 })).toEqual([4103, 4104, 4100, 4101, 4102])
  })

  it("排除已用与黑名单端口", () => {
    expect(candidateOrder(pool, { used: [4100], exclude: [4102] })).toEqual([4101, 4103, 4104])
  })

  it("cursor 支持越界/负数", () => {
    expect(candidateOrder(pool, { cursor: 5 })).toEqual(pool)
    expect(candidateOrder(pool, { cursor: -1 })).toEqual([4104, 4100, 4101, 4102, 4103])
  })
})

describe("portUtils.probePortFree / classifyServePort", () => {
  it("空闲端口探测为 free", async () => {
    const { port, close } = await listenOnRandomPort()
    await close()
    expect(await probePortFree(port)).toBe(true)
    expect(await classifyServePort(port)).toBe("free")
  })

  it("被占用端口探测为 false，且分类为 ours/foreign", async () => {
    const { port, close } = await listenOnRandomPort()
    try {
      expect(await probePortFree(port)).toBe(false)
      // 监听者就是当前进程 → 指定 ownerPid 时识别为 ours
      expect(await classifyServePort(port, process.pid)).toBe("ours")
      // 不指定 ownerPid → 视作 foreign（活进程占用）
      expect(await classifyServePort(port)).toBe("foreign")
    } finally {
      await close()
    }
  })
})

describe("portUtils.isProcessAlive", () => {
  it("当前进程存活", () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })
  it("不存在的 PID 判定为已死", () => {
    expect(isProcessAlive(999999)).toBe(false)
  })
  it("非法 PID 判定为已死", () => {
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-1)).toBe(false)
  })
})

describe("config.resolveMaxServes", () => {
  it("默认并发上限", () => {
    expect(resolveMaxServes({}, DEFAULT_SERVE_PORT_POOL.length)).toBe(DEFAULT_MAX_SERVES)
  })
  it("BRIDGE_SERVE_MAX 覆盖", () => {
    expect(resolveMaxServes({ BRIDGE_SERVE_MAX: "3" }, 10)).toBe(3)
  })
  it("不超过端口池长度", () => {
    expect(resolveMaxServes({ BRIDGE_SERVE_MAX: "20" }, 4)).toBe(4)
  })
  it("非法值回退默认（再与池长取小）", () => {
    expect(resolveMaxServes({ BRIDGE_SERVE_MAX: "abc" }, 10)).toBe(DEFAULT_MAX_SERVES)
    expect(resolveMaxServes({ BRIDGE_SERVE_MAX: "0" }, 10)).toBe(DEFAULT_MAX_SERVES)
  })
})

describe("config 端口池默认值", () => {
  it("默认池为 4100-4109（10 个，冗余）", () => {
    expect(DEFAULT_SERVE_PORT_POOL).toEqual([4100, 4101, 4102, 4103, 4104, 4105, 4106, 4107, 4108, 4109])
  })
})
