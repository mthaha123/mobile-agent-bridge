/**
 * configStore tests
 *
 * Tests config fetch methods: config, providers, agents, commands.
 * Each method takes a clientCall function and follows loading/error patterns.
 */

import { useConfigStore } from '../src/stores/configStore'

function resetConfigStore() {
  useConfigStore.setState({
    config: null,
    providers: [],
    agents: [],
    commands: [],
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
// fetchConfig
// ---------------------------------------------------------------------------

describe('fetchConfig', () => {
  it('calls config.get and unwraps config field', async () => {
    const configData = { theme: 'dark', logLevel: 'debug' }
    const clientCall = jest.fn().mockResolvedValue({ config: configData })

    await useConfigStore.getState().fetchConfig(clientCall)

    expect(clientCall).toHaveBeenCalledWith('config.get')
    expect(useConfigStore.getState().config).toEqual(configData)
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBeNull()
  })

  it('falls back to raw result when no config field', async () => {
    const configData = { theme: 'dark' }
    const clientCall = jest.fn().mockResolvedValue(configData)

    await useConfigStore.getState().fetchConfig(clientCall)

    expect(useConfigStore.getState().config).toEqual(configData)
  })

  it('handles fetch failure gracefully', async () => {
    const clientCall = jest.fn().mockRejectedValue(new Error('config error'))

    await useConfigStore.getState().fetchConfig(clientCall)

    expect(useConfigStore.getState().config).toBeNull()
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBe('config error')
  })
})

// ---------------------------------------------------------------------------
// fetchProviders
// ---------------------------------------------------------------------------

describe('fetchProviders', () => {
  it('calls config.providers and updates providers state on success', async () => {
    const providersData = [{ name: 'openai' }, { name: 'anthropic' }]
    const clientCall = jest.fn().mockResolvedValue(providersData)

    await useConfigStore.getState().fetchProviders(clientCall)

    expect(clientCall).toHaveBeenCalledWith('config.providers')
    expect(useConfigStore.getState().providers).toEqual(providersData)
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBeNull()
  })

  it('handles fetch failure gracefully', async () => {
    const clientCall = jest.fn().mockRejectedValue(new Error('providers error'))

    await useConfigStore.getState().fetchProviders(clientCall)

    expect(useConfigStore.getState().providers).toEqual([])
    expect(useConfigStore.getState().loading).toBe(false)
    expect(useConfigStore.getState().error).toBe('providers error')
  })
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
// updateConfig
// ---------------------------------------------------------------------------

describe('updateConfig', () => {
  beforeEach(() => {
    resetConfigStore()
  })

  it('calls config.update with updates and refreshes config', async () => {
    const updatedConfig = { theme: 'light', language: 'en' }
    const clientCall = jest.fn()
    clientCall.mockResolvedValueOnce({})            // config.update
    clientCall.mockResolvedValueOnce(updatedConfig) // config.get (re-fetch)

    await useConfigStore.getState().updateConfig({ theme: 'light' }, clientCall)

    expect(clientCall).toHaveBeenCalledWith('config.update', { theme: 'light' })
    expect(useConfigStore.getState().config).toEqual(updatedConfig)
  })

  it('catches errors silently', async () => {
    const clientCall = jest.fn().mockRejectedValue(new Error('update failed'))
    useConfigStore.setState({ config: { existing: true } })

    await useConfigStore.getState().updateConfig({ theme: 'light' }, clientCall)

    // config should remain unchanged
    expect(useConfigStore.getState().config).toEqual({ existing: true })
  })
})
