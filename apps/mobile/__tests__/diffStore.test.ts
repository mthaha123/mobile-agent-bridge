import { useDiffStore, FileDiff } from '../src/stores/diffStore'

const sampleDiffs: FileDiff[] = [
  { file: 'src/index.ts', patch: '...', additions: 5, deletions: 2, status: 'modified' },
  { file: 'src/new.ts', patch: '...', additions: 10, deletions: 0, status: 'added' },
]

function resetStore() {
  useDiffStore.setState({ diffs: {} })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  resetStore()
})

describe('setDiffs', () => {
  it('stores diffs keyed by sessionID', () => {
    useDiffStore.getState().setDiffs('sess-1', sampleDiffs)

    const diffs = useDiffStore.getState().diffs
    expect(diffs['sess-1']).toEqual(sampleDiffs)
  })

  it('replaces existing diffs for the same sessionID', () => {
    useDiffStore.getState().setDiffs('sess-1', sampleDiffs)

    const replacement: FileDiff[] = [
      { file: 'src/other.ts', additions: 3, deletions: 1, status: 'modified' },
    ]
    useDiffStore.getState().setDiffs('sess-1', replacement)

    expect(useDiffStore.getState().diffs['sess-1']).toEqual(replacement)
    expect(useDiffStore.getState().diffs['sess-1']).toHaveLength(1)
  })

  it('stores diffs for multiple sessions independently', () => {
    useDiffStore.getState().setDiffs('sess-1', sampleDiffs)
    useDiffStore.getState().setDiffs('sess-2', [{ file: 'a.ts', additions: 1, deletions: 0 }])

    expect(Object.keys(useDiffStore.getState().diffs)).toEqual(['sess-1', 'sess-2'])
  })
})

describe('clearSession', () => {
  it('removes diffs for the given sessionID', () => {
    useDiffStore.getState().setDiffs('sess-1', sampleDiffs)
    useDiffStore.getState().setDiffs('sess-2', [{ file: 'b.ts', additions: 2, deletions: 2 }])

    useDiffStore.getState().clearSession('sess-1')

    expect(useDiffStore.getState().diffs['sess-1']).toBeUndefined()
    expect(useDiffStore.getState().diffs['sess-2']).toBeDefined()
  })

  it('does not affect other sessions', () => {
    useDiffStore.getState().setDiffs('sess-1', sampleDiffs)
    useDiffStore.getState().clearSession('sess-2')

    expect(useDiffStore.getState().diffs['sess-1']).toEqual(sampleDiffs)
  })
})
