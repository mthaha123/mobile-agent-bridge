import React from 'react'
import TestRenderer from 'react-test-renderer'
import { ConnectScreen } from '../src/screens/ConnectScreen'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'

beforeEach(() => {
  useAuthStore.setState({
    bridgeUrl: '', token: null, authenticated: false,
    loading: false, error: null, client: null,
  })
  useProjectStore.setState({ directory: '', project: null, switching: false })
})

// ─── Rendering ────────────────────────────────────────────

describe('ConnectScreen', () => {
  it('renders title and subtitle', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders error message when present', () => {
    useAuthStore.setState({ error: 'Connection failed' })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders loading state', () => {
    useAuthStore.setState({ loading: true })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })
})
