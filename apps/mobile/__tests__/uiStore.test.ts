import { useUiStore } from '../src/stores/uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({
      screen: 'connect',
      activeTab: 'chat',
      chatSubScreen: 'sessions',
    })
  })

  it('has correct initial state', () => {
    const s = useUiStore.getState()
    expect(s.screen).toBe('connect')
    expect(s.activeTab).toBe('chat')
    expect(s.chatSubScreen).toBe('sessions')
  })

  it('setScreen changes screen and resets tab/subscreen', () => {
    useUiStore.getState().setActiveTab('files')
    useUiStore.getState().pushChat()
    expect(useUiStore.getState().activeTab).toBe('files')
    expect(useUiStore.getState().chatSubScreen).toBe('chat')

    useUiStore.getState().setScreen('connect')
    const s = useUiStore.getState()
    expect(s.screen).toBe('connect')
    expect(s.activeTab).toBe('chat')
    expect(s.chatSubScreen).toBe('sessions')
  })

  it('setActiveTab changes active tab', () => {
    useUiStore.getState().setActiveTab('files')
    expect(useUiStore.getState().activeTab).toBe('files')

    useUiStore.getState().setActiveTab('settings')
    expect(useUiStore.getState().activeTab).toBe('settings')

    useUiStore.getState().setActiveTab('chat')
    expect(useUiStore.getState().activeTab).toBe('chat')
  })

  it('pushChat changes chatSubScreen to chat', () => {
    useUiStore.getState().pushChat()
    expect(useUiStore.getState().chatSubScreen).toBe('chat')
  })

  it('popChat changes chatSubScreen to sessions', () => {
    useUiStore.getState().pushChat()
    useUiStore.getState().popChat()
    expect(useUiStore.getState().chatSubScreen).toBe('sessions')
  })

  it('pushChat does not affect active tab', () => {
    useUiStore.getState().setActiveTab('files')
    useUiStore.getState().pushChat()
    expect(useUiStore.getState().activeTab).toBe('files')
  })
})
