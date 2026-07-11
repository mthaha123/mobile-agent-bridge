/**
 * AppProvider tests — project.changed event handler
 */

jest.mock('react-native', () => {
  const mockComponent = (name: string) => {
    const Comp: React.FC<{ children?: React.ReactNode }> = (props) =>
      props.children ?? null
    Comp.displayName = name
    return Comp
  }

  return {
    View: mockComponent('View'),
    Text: mockComponent('Text'),
    TextInput: mockComponent('TextInput'),
    TouchableOpacity: mockComponent('TouchableOpacity'),
    StyleSheet: { create: (s: any) => s },
    ActivityIndicator: mockComponent('ActivityIndicator'),
    Modal: mockComponent('Modal'),
    Alert: { alert: jest.fn() },
    KeyboardAvoidingView: mockComponent('KeyboardAvoidingView'),
    ScrollView: mockComponent('ScrollView'),
    Platform: { OS: 'ios', select: () => {} },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
  }
})

jest.mock('../src/screens/ToolApprovalSheet', () => ({
  setToolReplyCall: jest.fn(),
}))

import React from 'react'
import TestRenderer from 'react-test-renderer'
import { AppProvider } from '../src/components/AppProvider'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useChatStore } from '../src/stores/chatStore'
import { useToolStore } from '../src/stores/toolStore'

function resetStores() {
  useAuthStore.setState({
    bridgeUrl: '',
    token: null,
    authenticated: false,
    loading: false,
    error: null,
    client: null,
  })
  useProjectStore.setState({
    directory: '',
    project: null,
    switching: false,
  })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  resetStores()
})

describe('project.changed handler', () => {
  it('updates project store when project.changed notification arrives', () => {
    let notifyHandler: ((method: string, payload: any) => void) | null = null
    const mockClient = {
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'notification') {
          notifyHandler = handler
        }
      }),
      call: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      destroy: jest.fn(),
      connected: true,
      token: 'mock-token',
    }

    TestRenderer.act(() => {
      TestRenderer.create(<AppProvider>{null}</AppProvider>)
    })
    TestRenderer.act(() => {
      useAuthStore.setState({ client: mockClient as any })
    })

    expect(mockClient.on).toHaveBeenCalledWith(
      'notification',
      expect.any(Function),
    )

    TestRenderer.act(() => {
      notifyHandler!('project.changed', {
        directory: '/new/project',
        project: { name: 'new-project' },
      })
    })

    const state = useProjectStore.getState()
    expect(state.directory).toBe('/new/project')
    expect(state.project).toEqual({ name: 'new-project' })
  })

  it('feeds text delta into chat store on session.next.text.delta', () => {
    let notifyHandler: ((method: string, payload: any) => void) | null = null
    const mockClient = {
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'notification') {
          notifyHandler = handler
        }
      }),
      call: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      destroy: jest.fn(),
      connected: true,
      token: 'mock-token',
    }

    TestRenderer.act(() => {
      TestRenderer.create(<AppProvider>{null}</AppProvider>)
    })
    TestRenderer.act(() => {
      useAuthStore.setState({ client: mockClient as any })
    })

    const updateLastAssistant = jest.spyOn(
      useChatStore.getState(),
      'updateLastAssistant',
    )

    TestRenderer.act(() => {
      notifyHandler!('session.next.text.delta', {
        sessionID: 'sess-1',
        assistantMessageID: 'msg-1',
        textID: 'txt-1',
        delta: 'Hello ',
      })
    })

    expect(updateLastAssistant).toHaveBeenCalledWith('Hello ')
  })

  it('updates waiting status on session.status idle/busy', () => {
    let notifyHandler: ((method: string, payload: any) => void) | null = null
    const mockClient = {
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'notification') {
          notifyHandler = handler
        }
      }),
      call: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      destroy: jest.fn(),
      connected: true,
      token: 'mock-token',
    }

    TestRenderer.act(() => {
      TestRenderer.create(<AppProvider>{null}</AppProvider>)
    })
    TestRenderer.act(() => {
      useAuthStore.setState({ client: mockClient as any })
    })

    // Busy
    TestRenderer.act(() => {
      notifyHandler!('session.status', {
        sessionID: 'sess-1',
        status: { type: 'busy' },
      })
    })
    expect(useChatStore.getState().waiting).toBe(true)

    // Idle
    TestRenderer.act(() => {
      notifyHandler!('session.status', {
        sessionID: 'sess-1',
        status: { type: 'idle' },
      })
    })
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('enqueues tool approval on permission.v2.asked', () => {
    let notifyHandler: ((method: string, payload: any) => void) | null = null
    const mockClient = {
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'notification') {
          notifyHandler = handler
        }
      }),
      call: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      destroy: jest.fn(),
      connected: true,
      token: 'mock-token',
    }

    TestRenderer.act(() => {
      TestRenderer.create(<AppProvider>{null}</AppProvider>)
    })
    TestRenderer.act(() => {
      useAuthStore.setState({ client: mockClient as any })
    })

    const enqueue = jest.spyOn(useToolStore.getState(), 'enqueue')

    TestRenderer.act(() => {
      notifyHandler!('permission.v2.asked', {
        id: 'req-1',
        sessionID: 'sess-1',
        action: 'read',
        resources: ['src/**', 'config.ts'],
      })
    })

    expect(enqueue).toHaveBeenCalledWith({
      id: 'req-1',
      tool: 'read',
      args: { resources: ['src/**', 'config.ts'] },
      sessionId: 'sess-1',
      requestedAt: expect.any(Number),
    })
  })

  it('handles project.changed without optional project field', () => {
    let notifyHandler: ((method: string, payload: any) => void) | null = null
    const mockClient = {
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'notification') {
          notifyHandler = handler
        }
      }),
      call: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      destroy: jest.fn(),
      connected: true,
      token: 'mock-token',
    }

    TestRenderer.act(() => {
      TestRenderer.create(<AppProvider>{null}</AppProvider>)
    })
    TestRenderer.act(() => {
      useAuthStore.setState({ client: mockClient as any })
    })

    TestRenderer.act(() => {
      notifyHandler!('project.changed', { directory: '/minimal' })
    })

    const state = useProjectStore.getState()
    expect(state.directory).toBe('/minimal')
    expect(state.project).toBeNull()
  })
})
