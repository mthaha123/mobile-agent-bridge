/**
 * serveStore tests — 有服务器（serve 已注册）项目清单与启动/停止状态流转
 *
 * serveStore 不依赖 authStore：调用方把 client.call 作为参数注入。
 */
import { useServeStore, type ServeEntry, type ServeCall } from '../src/stores/serveStore'

function makeEntry(over: Partial<ServeEntry> = {}): ServeEntry {
  return {
    id: 'sv-1',
    name: 'alpha',
    directory: '/repo/alpha',
    port: 4100,
    status: 'stopped',
    createdAt: 1,
    ...over,
  }
}

/** 记录每次调用的 method/params/options，并按 handler 表返回结果 */
function makeCall(
  handlers: Record<string, (params?: any, options?: any) => any>,
  log: Array<{ method: string; params?: any; options?: any }> = [],
) {
  const call = jest.fn(async (method: string, params?: any, options?: any) => {
    log.push({ method, params, options })
    const h = handlers[method]
    if (!h) throw new Error(`Unhandled method: ${method}`)
    return h(params, options)
  }) as unknown as ServeCall & jest.Mock
  return { call, log }
}

beforeEach(() => {
  useServeStore.setState({ serves: [], loading: false })
})

// ─── fetchServes ────────────────────────────────────────

describe('serveStore — fetchServes', () => {
  it('writes the serve list from serve.list', async () => {
    const serves = [makeEntry(), makeEntry({ id: 'sv-2', name: 'beta', directory: '/repo/beta', status: 'running' })]
    const { call } = makeCall({ 'serve.list': () => serves })

    await useServeStore.getState().fetchServes(call)

    expect(useServeStore.getState().serves).toHaveLength(2)
    expect(useServeStore.getState().serves[1].name).toBe('beta')
  })

  it('normalizes a non-array response to []', async () => {
    const { call } = makeCall({ 'serve.list': () => ({ projects: [] }) })
    await useServeStore.getState().fetchServes(call)
    expect(useServeStore.getState().serves).toEqual([])
  })

  it('keeps the previous list when serve.list fails', async () => {
    useServeStore.setState({ serves: [makeEntry()] })
    const { call } = makeCall({})
    await useServeStore.getState().fetchServes(call)
    expect(useServeStore.getState().serves).toHaveLength(1)
  })
})

// ─── addServe / removeServe ─────────────────────────────

describe('serveStore — add / remove', () => {
  it('addServe returns the created entry and refreshes the list', async () => {
    const created = makeEntry({ id: 'sv-new' })
    const { call, log } = makeCall({
      'serve.add': () => created,
      'serve.list': () => [created],
    })

    const result = await useServeStore.getState().addServe(call, 'alpha', '/repo/alpha')

    expect(result).toEqual(created)
    expect(log.map((l) => l.method)).toEqual(['serve.add', 'serve.list'])
    expect(log[0].params).toEqual({ name: 'alpha', directory: '/repo/alpha' })
    expect(useServeStore.getState().serves.map((s) => s.id)).toEqual(['sv-new'])
  })

  it('removeServe drops the entry locally', async () => {
    useServeStore.setState({ serves: [makeEntry(), makeEntry({ id: 'sv-2' })] })
    const { call } = makeCall({ 'serve.remove': () => ({ ok: true }) })

    await useServeStore.getState().removeServe(call, 'sv-1')

    expect(useServeStore.getState().serves.map((s) => s.id)).toEqual(['sv-2'])
  })
})

// ─── startServe（切到 stopped serve 项目前的前置动作）──

describe('serveStore — startServe', () => {
  it('marks the serve running and returns true on success', async () => {
    useServeStore.setState({ serves: [makeEntry({ status: 'stopped' })] })
    const { call, log } = makeCall({ 'serve.start': () => true })

    const ok = await useServeStore.getState().startServe(call, 'sv-1')

    expect(ok).toBe(true)
    expect(useServeStore.getState().serves[0].status).toBe('running')
    expect(log[0]).toEqual({
      method: 'serve.start',
      params: { id: 'sv-1' },
      options: { timeoutMs: 60_000 },
    })
  })

  it('uses a 60s timeout: server spawnAndVerify can block up to 30s (default client timeout)', async () => {
    const { call, log } = makeCall({ 'serve.start': () => true })
    await useServeStore.getState().startServe(call, 'sv-1')
    expect(log[0].options?.timeoutMs).toBeGreaterThan(30_000)
  })

  it('returns false and re-syncs state when the server fails to start', async () => {
    useServeStore.setState({ serves: [makeEntry({ status: 'stopped' })] })
    // serve.start 返回 false（端口耗尽 / opencode.exe 缺失）→ 回读 serve.list 仍是 stopped
    const { call, log } = makeCall({
      'serve.start': () => false,
      'serve.list': () => [makeEntry({ status: 'stopped' })],
    })

    const ok = await useServeStore.getState().startServe(call, 'sv-1')

    expect(ok).toBe(false)
    expect(useServeStore.getState().serves[0].status).toBe('stopped')
    expect(log.map((l) => l.method)).toEqual(['serve.start', 'serve.list'])
  })

  it('propagates RPC errors (caller shows an Alert)', async () => {
    const { call } = makeCall({})
    await expect(useServeStore.getState().startServe(call, 'sv-1')).rejects.toThrow('Unhandled method')
  })
})

// ─── stopServe ──────────────────────────────────────────

describe('serveStore — stopServe', () => {
  it('marks the serve stopped', async () => {
    useServeStore.setState({ serves: [makeEntry({ status: 'running' })] })
    const { call } = makeCall({ 'serve.stop': () => ({ ok: true }) })

    await useServeStore.getState().stopServe(call, 'sv-1')

    expect(useServeStore.getState().serves[0].status).toBe('stopped')
  })
})
