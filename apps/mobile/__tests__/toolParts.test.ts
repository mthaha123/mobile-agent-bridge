/**
 * toolParts util tests — 服务端 tool part 形态归一化（唯一转换层契约）
 *
 * 锁定三个真实 bug 的回归：
 *   1. bash 输出在 state.metadata.output，缺失该分支导致重载后输出丢失
 *   2. pending/running 状态原样透传进 UI，渲染成无图标未完成卡片
 *   3. prt_* id 当 part 身份导致 live 更新按 callID 匹配失败（卡片重复/永不结算）
 */
import {
  normalizeToolStatus,
  extractToolStateOutput,
  buildToolPartFromRaw,
  isOpenToolStatus,
  isTerminalToolStatus,
} from '../src/utils/toolParts'

describe('normalizeToolStatus', () => {
  it('SDK 持久化状态映射：completed→success、error→failed、pending→called、running→progress', () => {
    expect(normalizeToolStatus('completed')).toBe('success')
    expect(normalizeToolStatus('error')).toBe('failed')
    expect(normalizeToolStatus('pending')).toBe('called')
    expect(normalizeToolStatus('running')).toBe('progress')
  })

  it('App 内部状态原样保留；未知值兜底 called（绝不透传未知值）', () => {
    expect(normalizeToolStatus('called')).toBe('called')
    expect(normalizeToolStatus('progress')).toBe('progress')
    expect(normalizeToolStatus('success')).toBe('success')
    expect(normalizeToolStatus('failed')).toBe('failed')
    expect(normalizeToolStatus('cancelled')).toBe('cancelled')
    expect(normalizeToolStatus('rejected')).toBe('rejected')
    expect(normalizeToolStatus(undefined)).toBe('called')
    expect(normalizeToolStatus('weird-status')).toBe('called')
  })
})

describe('extractToolStateOutput', () => {
  it('metadata.output 是 bash 类工具输出的真实位置（回归：此前只读 state.output 丢失输出）', () => {
    expect(extractToolStateOutput({
      status: 'completed',
      metadata: { output: 'git push origin main\n', exit: 0 },
    })).toBe('git push origin main\n')
  })

  it('content 数组优先拼接 text；state.output 兜底', () => {
    expect(extractToolStateOutput({
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
    })).toBe('ab')
    expect(extractToolStateOutput({ output: 'plain' })).toBe('plain')
    expect(extractToolStateOutput({ output: { k: 1 } })).toBe('{"k":1}')
    expect(extractToolStateOutput(null)).toBe('')
    expect(extractToolStateOutput({})).toBe('')
  })
})

describe('buildToolPartFromRaw', () => {
  it('身份优先 callID（live 流以 callID 更新；prt_* 只会破坏匹配）', () => {
    const built = buildToolPartFromRaw({
      id: 'prt_abc',
      callID: 'call_xyz',
      tool: 'bash',
      state: { status: 'completed', input: { command: 'ls' }, metadata: { output: 'file.ts' } },
    })
    expect(built).not.toBeNull()
    expect(built!.id).toBe('call_xyz')
    expect(built!.data).toMatchObject({
      tool: 'bash',
      status: 'success',
      result: 'file.ts',
    })
  })

  it('无 callID 时回退 id；两者皆缺返回 null（无法建立身份）', () => {
    expect(buildToolPartFromRaw({ id: 'prt_only', tool: 'read', state: { status: 'completed' } })?.id).toBe('prt_only')
    expect(buildToolPartFromRaw({ tool: 'read', state: {} })).toBeNull()
    expect(buildToolPartFromRaw(null)).toBeNull()
  })

  it('卡死在 running 的持久化 part 归一化为 progress（可被后续对账识别为非终态）', () => {
    const built = buildToolPartFromRaw({
      callID: 'call_stuck',
      tool: 'bash',
      state: { status: 'running', input: { command: 'npm test' }, time: { start: 123 } },
    })
    expect(built!.data.status).toBe('progress')
  })
})

describe('status 分类器', () => {
  it('open/terminal 判定', () => {
    expect(isOpenToolStatus('called')).toBe(true)
    expect(isOpenToolStatus('progress')).toBe(true)
    expect(isOpenToolStatus('success')).toBe(false)
    expect(isTerminalToolStatus('success')).toBe(true)
    expect(isTerminalToolStatus('failed')).toBe(true)
    expect(isTerminalToolStatus('cancelled')).toBe(true)
    expect(isTerminalToolStatus('rejected')).toBe(true)
    expect(isTerminalToolStatus('progress')).toBe(false)
  })
})
