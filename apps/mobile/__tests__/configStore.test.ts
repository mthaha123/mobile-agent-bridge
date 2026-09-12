/**
 * configStore tests
 *
 * Tests config fetch methods: agents, commands, models.
 * Each method takes a clientCall function and follows loading/error patterns.
 *
 * 注：fetchConfig / fetchProviders / updateConfig 已随 Bridge config stub
 * 端点移除（2026-08 设置页重构），对应用例一并删除。
 */

import { useConfigStore, CONFIG_REFRESH_TTL_MS } from '../src/stores/configStore'

function resetConfigStore() {
  useConfigStore.setState({
    agents: [],
    commands: [],
    models: [],
    loading: false,
    error: null,
    lastRefreshedAt: 0,
    refreshing: false,
  })
}

beforeEach(() => {
  resetConfigStore()
})

afterEach(() => {
  resetConfigStore()
})

// ---------------------------------------------------------------------------
// fetchAgents
// ---------------------------------------------------------------------------

describe('fetchAgents', () => {
  it('calls config.agents and updates agents state on success', async () => {
    const agentsData = [{ name: 'coder' }]
    const clientCall = jest.fn().mockResolvedValue(agentsData)

    await useConfigStore.getState().fetchAgents(clientCall)

    expect(clientCall).toHaveBeenCalledWith('config.agents')
    expect(useConfigStore.getState().agents).toEqual(agentsData)
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBeNull()
  })

  it('handles fetch failure gracefully', async () => {
    const clientCall = jest.fn().mockRejectedValue(new Error('agents error'))

    await useConfigStore.getState().fetchAgents(clientCall)

    expect(useConfigStore.getState().agents).toEqual([])
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBe('agents error')
  })
})

// ---------------------------------------------------------------------------
// fetchCommands
// ---------------------------------------------------------------------------

describe('fetchCommands', () => {
  it('calls command.list and updates commands state on success', async () => {
    const commandsData = [{ name: 'build' }]
    const clientCall = jest.fn().mockResolvedValue(commandsData)

    await useConfigStore.getState().fetchCommands(clientCall)

    expect(clientCall).toHaveBeenCalledWith('command.list')
    expect(useConfigStore.getState().commands).toEqual(commandsData)
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBeNull()
  })

  it('handles fetch failure gracefully', async () => {
    const clientCall = jest.fn().mockRejectedValue(new Error('commands error'))

    await useConfigStore.getState().fetchCommands(clientCall)

    expect(useConfigStore.getState().commands).toEqual([])
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBe('commands error')
  })
})

// ---------------------------------------------------------------------------
// fetchModels
// ---------------------------------------------------------------------------

describe('fetchModels', () => {
  it('calls model.list and updates models state on success', async () => {
    const modelsData = [{ id: 'm1', providerID: 'p1' }]
    const clientCall = jest.fn().mockResolvedValue(modelsData)

    await useConfigStore.getState().fetchModels(clientCall)

    expect(clientCall).toHaveBeenCalledWith('model.list')
    expect(useConfigStore.getState().models).toEqual(modelsData)
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBeNull()
  })

  it('handles fetch failure gracefully', async () => {
    const clientCall = jest.fn().mockRejectedValue(new Error('models error'))

    await useConfigStore.getState().fetchModels(clientCall)

    expect(useConfigStore.getState().models).toEqual([])
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBe('models error')
  })
})

// ---------------------------------------------------------------------------
// refreshAll / msUntilRefreshDue
// ---------------------------------------------------------------------------

describe('refreshAll', () => {
  it('并发调用三个配置接口并写入结果，更新 lastRefreshedAt', async () => {
    const clientCall = jest.fn(async (method: string) => {
      if (method === 'config.agents') return [{ id: 'build' }]
      if (method === 'command.list') return [{ command: 'init' }]
      if (method === 'model.list') return [{ id: 'm1' }]
      return []
    })

    await useConfigStore.getState().refreshAll(clientCall)

    expect(clientCall).toHaveBeenCalledWith('config.agents')
    expect(clientCall).toHaveBeenCalledWith('command.list')
    expect(clientCall).toHaveBeenCalledWith('model.list')
    expect(useConfigStore.getState().agents).toEqual([{ id: 'build' }])
    expect(useConfigStore.getState().commands).toEqual([{ command: 'init' }])
    expect(useConfigStore.getState().models).toEqual([{ id: 'm1' }])
    expect(useConfigStore.getState().lastRefreshedAt).toBeGreaterThan(0)
  })

  it('TTL 内重复调用不请求，force 强制请求', async () => {
    const clientCall = jest.fn().mockResolvedValue([])
    useConfigStore.setState({ lastRefreshedAt: Date.now() })

    await useConfigStore.getState().refreshAll(clientCall)
    expect(clientCall).not.toHaveBeenCalled()

    await useConfigStore.getState().refreshAll(clientCall, { force: true })
    expect(clientCall).toHaveBeenCalledTimes(3)
  })

  it('部分失败保留旧值，其余更新，error 记录失败信息', async () => {
    useConfigStore.setState({ models: [{ id: 'old' }] })
    const clientCall = jest.fn(async (method: string) => {
      if (method === 'model.list') throw new Error('models down')
      if (method === 'config.agents') return [{ id: 'build' }]
      return []
    })

    await useConfigStore.getState().refreshAll(clientCall, { force: true })

    expect(useConfigStore.getState().models).toEqual([{ id: 'old' }])
    expect(useConfigStore.getState().agents).toEqual([{ id: 'build' }])
    expect(useConfigStore.getState().error).toBe('models down')
  })

  it('并发调用只请求一次（refreshing 重入保护）', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const clientCall = jest.fn(async () => { await gate; return [] })

    const p1 = useConfigStore.getState().refreshAll(clientCall, { force: true })
    const p2 = useConfigStore.getState().refreshAll(clientCall, { force: true })
    release()
    await Promise.all([p1, p2])

    expect(clientCall).toHaveBeenCalledTimes(3)
  })
})

describe('msUntilRefreshDue', () => {
  it('未刷新过返回 TTL', () => {
    expect(useConfigStore.getState().msUntilRefreshDue()).toBe(CONFIG_REFRESH_TTL_MS)
  })

  it('已刷新过返回剩余毫秒', () => {
    useConfigStore.setState({ lastRefreshedAt: Date.now() - 60_000 })
    const due = useConfigStore.getState().msUntilRefreshDue()
    expect(due).toBeGreaterThan(0)
    expect(due).toBeLessThanOrEqual(CONFIG_REFRESH_TTL_MS - 60_000 + 50)
  })
})
