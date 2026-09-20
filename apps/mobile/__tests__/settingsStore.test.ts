/**
 * settingsStore — 本地偏好持久化
 *
 * react-native-blob-util 走 jest.config.js 的 moduleNameMapper mock，
 * writeFile/readFile/exists 为可控 jest.fn（见 __mocks__/react-native-blob-util.js）。
 */
import { useSettingsStore } from '../src/stores/settingsStore'

const RNBlob = require('react-native-blob-util')
const fs = ((RNBlob.default ?? RNBlob) as {
  fs: {
    writeFile: jest.Mock
    readFile: jest.Mock
    exists: jest.Mock
    dirs: Record<string, string>
  }
}).fs

const SETTINGS_PATH = '/mock/documents/mobile-agent-bridge-settings.json'

describe('settingsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    useSettingsStore.setState({
      defaultAgent: null,
      defaultModel: null,
      chatDisplayMode: 'flat',
      bridgeUrl: null,
      bridgePassword: null,
      projectDirectory: null,
      loaded: false,
    })
  })

  it('load 从 DocumentDir 恢复持久化设置', async () => {
    fs.exists.mockResolvedValue(true)
    fs.readFile.mockResolvedValue(JSON.stringify({
      defaultAgent: 'plan',
      defaultModel: { id: 'm1', providerID: 'p1' },
    }))
    await useSettingsStore.getState().load()

    expect(fs.exists).toHaveBeenCalledWith(SETTINGS_PATH)
    expect(fs.readFile).toHaveBeenCalledWith(SETTINGS_PATH, 'utf8')
    expect(useSettingsStore.getState().defaultAgent).toBe('plan')
    expect(useSettingsStore.getState().defaultModel).toEqual({ id: 'm1', providerID: 'p1' })
    expect(useSettingsStore.getState().loaded).toBe(true)
  })

  it('load 容忍文件不存在', async () => {
    fs.exists.mockResolvedValue(false)
    await useSettingsStore.getState().load()

    expect(fs.readFile).not.toHaveBeenCalled()
    expect(useSettingsStore.getState().defaultAgent).toBeNull()
    expect(useSettingsStore.getState().loaded).toBe(true)
  })

  it('load 对损坏/读取失败文件静默降级为内存默认值', async () => {
    fs.exists.mockResolvedValue(true)
    fs.readFile.mockRejectedValue(new Error('boom'))
    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().loaded).toBe(true)
    expect(useSettingsStore.getState().defaultAgent).toBeNull()
  })

  it('setDefaultAgent 更新状态并持久化', async () => {
    await useSettingsStore.getState().setDefaultAgent('build')

    expect(useSettingsStore.getState().defaultAgent).toBe('build')
    expect(fs.writeFile).toHaveBeenCalledWith(
      SETTINGS_PATH,
      expect.stringContaining('"defaultAgent":"build"'),
      'utf8',
    )
  })

  it('setDefaultModel(null) 清除并持久化', async () => {
    useSettingsStore.setState({ defaultModel: { id: 'm', providerID: 'p' } })
    await useSettingsStore.getState().setDefaultModel(null)

    expect(useSettingsStore.getState().defaultModel).toBeNull()
    expect(fs.writeFile).toHaveBeenCalled()
  })

  it('持久化失败不阻断状态更新', async () => {
    fs.writeFile.mockRejectedValue(new Error('disk full'))

    await expect(useSettingsStore.getState().setDefaultAgent('x')).resolves.not.toThrow()
    expect(useSettingsStore.getState().defaultAgent).toBe('x')
  })

  it('load 恢复 chatDisplayMode', async () => {
    fs.exists.mockResolvedValue(true)
    fs.readFile.mockResolvedValue(JSON.stringify({
      defaultAgent: null,
      defaultModel: null,
      chatDisplayMode: 'grouped',
    }))
    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().chatDisplayMode).toBe('grouped')
  })

  it('load 容忍旧格式（无 chatDisplayMode 字段）默认 flat', async () => {
    fs.exists.mockResolvedValue(true)
    fs.readFile.mockResolvedValue(JSON.stringify({
      defaultAgent: 'plan',
      defaultModel: { id: 'm1', providerID: 'p1' },
    }))
    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().chatDisplayMode).toBe('flat')
  })

  it('setChatDisplayMode 更新状态并持久化', async () => {
    await useSettingsStore.getState().setChatDisplayMode('grouped')

    expect(useSettingsStore.getState().chatDisplayMode).toBe('grouped')
    expect(fs.writeFile).toHaveBeenCalledWith(
      SETTINGS_PATH,
      expect.stringContaining('"chatDisplayMode":"grouped"'),
      'utf8',
    )
  })

  // ─── 连接参数持久化（联调不再误连默认地址）───────────────

  it('load 恢复上次使用的连接参数', async () => {
    fs.exists.mockResolvedValue(true)
    fs.readFile.mockResolvedValue(JSON.stringify({
      bridgeUrl: 'ws://10.0.2.2:8081/ws',
      bridgePassword: 'pw',
      projectDirectory: '/mock-project',
    }))
    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().bridgeUrl).toBe('ws://10.0.2.2:8081/ws')
    expect(useSettingsStore.getState().bridgePassword).toBe('pw')
    expect(useSettingsStore.getState().projectDirectory).toBe('/mock-project')
  })

  it('load 容忍旧格式（无连接参数字段）默认 null', async () => {
    fs.exists.mockResolvedValue(true)
    fs.readFile.mockResolvedValue(JSON.stringify({ defaultAgent: 'plan' }))
    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().bridgeUrl).toBeNull()
    expect(useSettingsStore.getState().bridgePassword).toBeNull()
    expect(useSettingsStore.getState().projectDirectory).toBeNull()
  })

  it('saveConnection 更新状态并持久化', async () => {
    await useSettingsStore.getState().saveConnection({
      url: 'ws://10.0.2.2:8081/ws',
      password: 'pw',
      directory: '/mock-project',
    })

    expect(useSettingsStore.getState().bridgeUrl).toBe('ws://10.0.2.2:8081/ws')
    expect(useSettingsStore.getState().bridgePassword).toBe('pw')
    expect(useSettingsStore.getState().projectDirectory).toBe('/mock-project')
    expect(fs.writeFile).toHaveBeenCalledWith(
      SETTINGS_PATH,
      expect.stringContaining('"bridgeUrl":"ws://10.0.2.2:8081/ws"'),
      'utf8',
    )
  })

  it('saveConnection 只传部分字段时其余沿用当前值', async () => {
    await useSettingsStore.getState().saveConnection({ url: 'ws://a/ws' })
    await useSettingsStore.getState().saveConnection({ password: 'pw2' })

    expect(useSettingsStore.getState().bridgeUrl).toBe('ws://a/ws')
    expect(useSettingsStore.getState().bridgePassword).toBe('pw2')
  })

  it('保存其它设置时不会丢掉已保存的连接参数（共用整份落盘）', async () => {
    await useSettingsStore.getState().saveConnection({ url: 'ws://a/ws' })
    fs.writeFile.mockClear()

    await useSettingsStore.getState().setChatDisplayMode('grouped')

    expect(fs.writeFile).toHaveBeenCalledWith(
      SETTINGS_PATH,
      expect.stringContaining('"bridgeUrl":"ws://a/ws"'),
      'utf8',
    )
  })

  it('saveConnection 持久化失败不阻断状态更新', async () => {
    fs.writeFile.mockRejectedValue(new Error('disk full'))

    await expect(
      useSettingsStore.getState().saveConnection({ url: 'ws://b/ws' }),
    ).resolves.not.toThrow()
    expect(useSettingsStore.getState().bridgeUrl).toBe('ws://b/ws')
  })
})
