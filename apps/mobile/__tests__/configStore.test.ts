/**
 * configStore tests
 *
 * Tests config fetch methods: agents, commands, models.
 * Each method takes a clientCall function and follows loading/error patterns.
 *
 * 注：fetchConfig / fetchProviders / updateConfig 已随 Bridge config stub
 * 端点移除（2026-08 设置页重构），对应用例一并删除。
 */

import { useConfigStore } from '../src/stores/configStore'

function resetConfigStore() {
  useConfigStore.setState({
    agents: [],
    commands: [],
    models: [],
    loading: false,
    error: null,
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
