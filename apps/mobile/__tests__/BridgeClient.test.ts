import { BridgeClient, BridgeWsFrame } from '../src/services/BridgeClient'

// ─── Mock WebSocket ───────────────────────────────────────

interface MockWebSocketInstance {
  readyState: number
  onopen: (() => void) | null
  onclose: ((event: { code: number }) => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: any) => void) | null
  send: jest.Mock
  close: jest.Mock
  _triggerOpen: () => void
  _triggerClose: (code?: number) => void
  _triggerMessage: (frame: BridgeWsFrame) => void
  _triggerError: (err: any) => void
}

const wsInstances: MockWebSocketInstance[] = []
const origWebSocket = globalThis.WebSocket

beforeEach(() => {
  wsInstances.length = 0

  const MockWebSocket = jest.fn().mockImplementation(
    (url: string): MockWebSocketInstance => {
      const self: MockWebSocketInstance = {
        readyState: 0,
        onopen: null,
        onclose: null,
        onmessage: null,
        onerror: null,
        send: jest.fn(),
        close: jest.fn().mockImplementation(() => {
          self.readyState = 3
          if (self.onclose) self.onclose({ code: 1000 })
        }),
        _triggerOpen() {
          self.readyState = 1
          if (self.onopen) self.onopen()
        },
        _triggerClose(code = 1000) {
          self.readyState = 3
          if (self.onclose) self.onclose({ code })
        },
        _triggerMessage(frame: BridgeWsFrame) {
          if (self.onmessage) self.onmessage({ data: JSON.stringify(frame) })
        },
        _triggerError(err: any) {
          if (self.onerror) self.onerror(err)
        },
      }
      wsInstances.push(self)
      return self
    },
  ) as unknown as new (url: string) => MockWebSocketInstance

  ;(MockWebSocket as any).OPEN = 1
  ;(MockWebSocket as any).CLOSED = 3
  globalThis.WebSocket = MockWebSocket as any
})

afterEach(() => {
  globalThis.WebSocket = origWebSocket
  wsInstances.length = 0
})

function getWs(): MockWebSocketInstance {
  expect(wsInstances.length).toBeGreaterThan(0)
  return wsInstances[0]
}

let client: BridgeClient | null = null

function makeClient(opts?: Partial<{ reconnectInterval: number; requestTimeout: number }>): BridgeClient {
  if (client) { client.destroy(); client = null }
  client = new BridgeClient({ url: 'ws://localhost:8080/ws', reconnectInterval: 0, requestTimeout: 5000, ...opts })
  return client
}

// ─── Tests ────────────────────────────────────────────────

describe('connect', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('connects and emits connected event on open', async () => {
    const c = makeClient()
    const onConnected = jest.fn()
    c.on('connected', onConnected)

    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    expect(onConnected).toHaveBeenCalled()
    expect(c.connected).toBe(true)
  })

  it('rejects on WebSocket error', async () => {
    const c = makeClient({ requestTimeout: 500 })
    c.on('error', () => {}) // prevent EventEmitter throw on unhandled 'error'
    const connectPromise = c.connect('token123')
    getWs()._triggerError(new Error('connection refused'))
    await expect(connectPromise).rejects.toThrow()
  })

  it('accepts undefined token', async () => {
    const c = makeClient()
    const connectPromise = c.connect()
    getWs()._triggerOpen()
    await connectPromise
    expect(c.connected).toBe(true)
  })

  it('rejects on connect timeout', async () => {
    const c = makeClient({ requestTimeout: 50 })
    await expect(c.connect('token123')).rejects.toThrow('连接超时')
  })
})

describe('disconnect', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('closes WebSocket and sets connected=false', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    c.disconnect()
    expect(c.connected).toBe(false)
  })
})

describe('call', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('sends request and resolves on matching response', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.call('session.list', {})
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.type).toBe('req')
    expect(sentFrame.method).toBe('session.list')

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: { sessions: [] } })
    await expect(callPromise).resolves.toEqual({ sessions: [] })
  })

  it('rejects on error response', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.call('session.list', {})
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: false, error: 'not found' })
    await expect(callPromise).rejects.toThrow('not found')
  })

  it('rejects if not connected', async () => {
    const c = makeClient()
    await expect(c.call('session.list', {})).rejects.toThrow('未连接')
    c.destroy()
  })

  it('rejects on timeout', async () => {
    const c = makeClient({ requestTimeout: 100 })
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise
    await expect(c.call('session.list', {})).rejects.toThrow('请求超时')
  })
})

describe('notification handling', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('emits notification event on notify frame', async () => {
    const c = makeClient()
    const onNotification = jest.fn()
    c.on('notification', onNotification)

    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    getWs()._triggerMessage({ type: 'notify', method: 'session.status', payload: { status: 'idle' } })
    expect(onNotification).toHaveBeenCalledWith('session.status', { status: 'idle' })
  })
})

describe('auth_expired handling', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('emits auth_expired on close code 4001', async () => {
    const c = makeClient()
    const onAuthExpired = jest.fn()
    c.on('auth_expired', onAuthExpired)

    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    getWs()._triggerClose(4001)
    expect(onAuthExpired).toHaveBeenCalled()
  })
})

describe('reconnection', () => {
  afterEach(async () => {
    // Resolve any pending connect() on unconsumed WS instances
    for (const ws of wsInstances) {
      if (ws.readyState === 0) ws._triggerOpen()
    }
    client?.destroy()
  })

  it('reconnects on close when reconnectInterval > 0', async () => {
    const c = makeClient({ reconnectInterval: 10 })
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    getWs()._triggerClose(1006)
    await new Promise((r) => setTimeout(r, 50))
    expect(wsInstances.length).toBeGreaterThanOrEqual(2)
  })

  it('does not reconnect on auth_expired (code 4001)', async () => {
    const c = makeClient({ reconnectInterval: 10 })
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    getWs()._triggerClose(4001)
    await new Promise((r) => setTimeout(r, 50))
    expect(wsInstances).toHaveLength(1)
  })
})

describe('destroy', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('rejects pending requests on destroy', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const callPromise = c.call('session.list', {})
    c.destroy()
    // destroy → disconnect → ws.close → onclose rejects with "连接已断开"
    await expect(callPromise).rejects.toThrow('连接已断开')
  })
})

describe('token getter', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('returns the token', () => {
    const c = makeClient()
    c.destroy()
    const c2 = new BridgeClient({ url: 'ws://localhost:8080/ws', token: 'sekret' })
    expect(c2.token).toBe('sekret')
    c2.destroy()
  })

  it('returns undefined when no token', () => {
    const c = new BridgeClient({ url: 'ws://localhost:8080/ws' })
    expect(c.token).toBeUndefined()
    c.destroy()
  })
})

describe('file operations', () => {
  afterEach(async () => {
    client?.destroy()
  })

  it('listFiles calls file.list RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const files = [
      { name: 'test.txt', type: 'file', size: 100, modified: '', permissions: '' },
      { name: 'src', type: 'directory', size: 0, modified: '', permissions: '' },
    ]

    const callPromise = c.listFiles('/home')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.list')
    expect(sentFrame.params).toEqual({ path: '/home' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: files })
    await expect(callPromise).resolves.toEqual(files)
  })

  it('readFile calls file.read RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const fileContent = {
      content: 'Hello World',
      encoding: 'utf-8',
      size: 11,
      path: '/test.txt',
    }

    const callPromise = c.readFile('/test.txt')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.read')
    expect(sentFrame.params).toEqual({ path: '/test.txt' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: fileContent })
    await expect(callPromise).resolves.toEqual(fileContent)
  })

  it('readFile with encoding calls file.read RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const fileContent = {
      content: 'Hello World',
      encoding: 'base64',
      size: 11,
      path: '/test.txt',
    }

    const callPromise = c.readFile('/test.txt', 'base64')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.params).toEqual({ path: '/test.txt', encoding: 'base64' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: fileContent })
    await expect(callPromise).resolves.toEqual(fileContent)
  })

  it('searchFiles calls file.search RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const results = [
      { file: '/test.txt', line: 1, content: 'Hello', match: 'Hello' },
    ]

    const callPromise = c.searchFiles('Hello')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.search')
    expect(sentFrame.params).toEqual({ query: 'Hello' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: results })
    await expect(callPromise).resolves.toEqual(results)
  })

  it('searchFiles with options calls file.search RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const results = [
      { file: '/test.txt', line: 1, content: 'Hello', match: 'Hello' },
    ]

    const callPromise = c.searchFiles('Hello', { dirs: ['/home'], limit: 10 })
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.params).toEqual({ query: 'Hello', dirs: ['/home'], limit: 10 })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: results })
    await expect(callPromise).resolves.toEqual(results)
  })

  it('getFileInfo calls file.info RPC', async () => {
    const c = makeClient()
    const connectPromise = c.connect('token123')
    getWs()._triggerOpen()
    await connectPromise

    const fileInfo = {
      name: 'test.txt',
      type: 'file',
      size: 100,
      modified: '2024-01-01T00:00:00.000Z',
      permissions: '644',
    }

    const callPromise = c.getFileInfo('/test.txt')
    const sentFrame = JSON.parse(getWs().send.mock.calls[0][0])
    expect(sentFrame.method).toBe('file.info')
    expect(sentFrame.params).toEqual({ path: '/test.txt' })

    getWs()._triggerMessage({ type: 'res', id: sentFrame.id, ok: true, payload: fileInfo })
    await expect(callPromise).resolves.toEqual(fileInfo)
  })
})
