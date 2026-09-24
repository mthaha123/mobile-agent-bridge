import { join } from "path"
import {
  DEFAULT_SERVE_PORT_POOL,
  parseServePortPool,
  resolveDataDir,
  resolveBridgePort,
  resolveOpenCodeUrl,
  DEFAULT_MAX_UPLOAD_BYTES,
  resolveMaxUploadBytes,
} from "../src/config.js"

describe("config.parseServePortPool", () => {
  it("未设置时回退默认端口池", () => {
    expect(parseServePortPool(undefined)).toEqual(DEFAULT_SERVE_PORT_POOL)
    expect(parseServePortPool("")).toEqual(DEFAULT_SERVE_PORT_POOL)
    expect(parseServePortPool("   ")).toEqual(DEFAULT_SERVE_PORT_POOL)
  })

  it("解析逗号分隔端口列表", () => {
    expect(parseServePortPool("4210,4211,4212")).toEqual([4210, 4211, 4212])
  })

  it("容忍空白与重复项", () => {
    expect(parseServePortPool(" 4210 , 4210,4211 ")).toEqual([4210, 4211])
  })

  it("过滤非法/越界端口", () => {
    expect(parseServePortPool("4210,abc,-1,0,70000,4211")).toEqual([4210, 4211])
  })

  it("全部非法时回退默认池", () => {
    expect(parseServePortPool("abc,70000")).toEqual(DEFAULT_SERVE_PORT_POOL)
  })
})

describe("config.resolveDataDir", () => {
  const root = process.platform === "win32" ? "D:\\srv\\mobile-agent-bridge" : "/srv/mobile-agent-bridge"

  it("未设置 BRIDGE_DATA_DIR 时用默认数据目录", () => {
    expect(resolveDataDir(root, {})).toBe(join(root, "servers", "bridge", "data"))
  })

  it("BRIDGE_DATA_DIR 绝对路径直接采用", () => {
    const dir = process.platform === "win32" ? "D:\\srv\\mab-data" : "/srv/mab-data"
    expect(resolveDataDir(root, { BRIDGE_DATA_DIR: dir })).toBe(dir)
  })

  it("BRIDGE_DATA_DIR 空白视为未设置", () => {
    expect(resolveDataDir(root, { BRIDGE_DATA_DIR: "   " })).toBe(join(root, "servers", "bridge", "data"))
  })

  it("生产与测试数据目录可区分", () => {
    const prod = resolveDataDir(root, { BRIDGE_DATA_DIR: process.platform === "win32" ? "D:\\srv\\mab-data" : "/srv/mab-data" })
    const test = resolveDataDir(root, {})
    expect(prod).not.toBe(test)
  })
})

describe("config.resolveBridgePort", () => {
  it("默认 8080", () => {
    expect(resolveBridgePort({})).toBe(8080)
  })
  it("读取 BRIDGE_PORT", () => {
    expect(resolveBridgePort({ BRIDGE_PORT: "8443" })).toBe(8443)
  })
  it("非法值回退 8080", () => {
    expect(resolveBridgePort({ BRIDGE_PORT: "abc" })).toBe(8080)
    expect(resolveBridgePort({ BRIDGE_PORT: "70000" })).toBe(8080)
    expect(resolveBridgePort({ BRIDGE_PORT: "0" })).toBe(8080)
  })
})

describe("config.resolveOpenCodeUrl", () => {
  it("默认 http://localhost:4096", () => {
    expect(resolveOpenCodeUrl({})).toBe("http://localhost:4096")
  })
  it("读取 OPENCODE_URL", () => {
    expect(resolveOpenCodeUrl({ OPENCODE_URL: "http://localhost:4200" })).toBe("http://localhost:4200")
  })
  it("空白回退默认", () => {
    expect(resolveOpenCodeUrl({ OPENCODE_URL: "  " })).toBe("http://localhost:4096")
  })
})

describe("config.resolveMaxUploadBytes", () => {
  it("默认 5MB", () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024)
    expect(resolveMaxUploadBytes({})).toBe(5 * 1024 * 1024)
  })

  it("读取 BRIDGE_MAX_UPLOAD_BYTES", () => {
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "1048576" })).toBe(1048576)
  })

  it("非法/非正数回退默认", () => {
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "abc" })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "0" })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "-5" })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
    expect(resolveMaxUploadBytes({ BRIDGE_MAX_UPLOAD_BYTES: "   " })).toBe(DEFAULT_MAX_UPLOAD_BYTES)
  })
})
