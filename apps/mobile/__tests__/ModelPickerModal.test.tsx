import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { TouchableOpacity, TextInput } from 'react-native'
import { ModelPickerModal } from '../src/components/ModelPickerModal'
import { textOf } from './test-utils'

const onClose = jest.fn()
const onSelect = jest.fn()

const MODELS = [
  { id: 'deepseek-v4-flash', providerID: 'opencode-go', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-flash', providerID: 'opencode', name: 'DeepSeek V4 Flash' },
  { id: 'claude-sonnet-4-5', providerID: 'anthropic', name: 'Claude Sonnet 4.5' },
]

it('兼容嵌套 provider.id 形状（旧内嵌实现的行为回退）', () => {
  const tree = render({
    models: [{ id: 'm1', provider: { id: 'nested-prov' }, name: 'Nested Model' }],
  })
  expect(textOf(tree)).toContain('nested-prov')
})

const render = (props: Partial<Parameters<typeof ModelPickerModal>[0]> = {}) => {
  // create 必须包 act：组件挂载时有 useEffect（打开时清空搜索词），
  // 裸 create 会把效应推迟到下一次 act 作用域执行，覆盖该作用域内的输入
  let tree!: TestRenderer.ReactTestRenderer
  act(() => {
    tree = TestRenderer.create(
      <ModelPickerModal
        visible
        onClose={onClose}
        onSelect={onSelect}
        models={MODELS}
        currentModel={{ id: 'deepseek-v4-flash', providerID: 'opencode' }}
        {...props}
      />,
    )
  })
  return tree
}

beforeEach(() => jest.clearAllMocks())

describe('ModelPickerModal', () => {
  it('渲染模型名与服务商名（两段独立文本）', () => {
    const tree = render()
    const text = textOf(tree)
    expect(text).toContain('DeepSeek V4 Flash')
    expect(text).toContain('opencode-go')
    expect(text).toContain('Claude Sonnet 4.5')
    // 当前选中项恰好标一个 ✓（同名跨 provider 只匹配一个）
    expect((text.match(/✓/g) || []).length).toBe(1)
  })

  it('按名称过滤（大小写不敏感）', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('claude') })
    const text = textOf(tree)
    expect(text).toContain('Claude Sonnet 4.5')
    expect(text).not.toContain('DeepSeek V4 Flash')
  })

  it('按服务商名过滤', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('opencode') })
    const text = textOf(tree)
    // opencode 与 opencode-go 都命中
    expect((text.match(/DeepSeek V4 Flash/g) || []).length).toBe(2)
    expect(text).not.toContain('Claude Sonnet 4.5')
  })

  it('搜索无结果显示空态文案', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('不存在') })
    expect(textOf(tree)).toContain('无匹配模型')
  })

  it('models 为空显示 No models loaded', () => {
    const tree = render({ models: [] })
    expect(textOf(tree)).toContain('No models loaded')
  })

  it('点选条目回调完整 model 对象并关闭', async () => {
    const tree = render()
    // 定位条目：找文本节点向上找最近可点击祖先
    const node = tree.root.findAll(
      (n: any) => n.type && n.props?.children === 'Claude Sonnet 4.5',
    )[0]
    expect(node).toBeTruthy()
    let item: any = node
    while (item && typeof item.props?.onPress !== 'function') item = item.parent
    await act(async () => { await item.props.onPress() })
    expect(onSelect).toHaveBeenCalledWith(MODELS[2])
    expect(onClose).toHaveBeenCalled()
  })

  it('清除按钮清空搜索词恢复全列表', () => {
    const tree = render()
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('claude') })
    expect(textOf(tree)).not.toContain('DeepSeek V4 Flash')
    // 用 accessibilityLabel 精确找 ✕ 清除按钮（外层 overlay 的子树同样包含 ✕ 文本，
    // 不能按文本向上找可点击祖先，否则会误中 overlay）
    const clearBtn = tree.root.find(
      (n: any) => n.props?.accessibilityLabel === 'Clear search',
    )
    expect(clearBtn).toBeTruthy()
    act(() => { clearBtn!.props.onPress() })
    expect(textOf(tree)).toContain('DeepSeek V4 Flash')
  })

  it('visible 从 false 变 true 时清空上次搜索词', () => {
    const tree = render({ visible: false })
    const input = tree.root.findByType(TextInput)
    act(() => { input.props.onChangeText('claude') })
    act(() => { tree.update(<ModelPickerModal visible onClose={onClose} onSelect={onSelect} models={MODELS} />) })
    expect(textOf(tree)).toContain('DeepSeek V4 Flash')
  })

  it('overlay 点击触发 onClose', () => {
    const tree = render()
    // 第一个 TouchableOpacity 是 overlay
    const overlay = tree.root.findAllByType(TouchableOpacity)[0]
    act(() => { overlay.props.onPress() })
    expect(onClose).toHaveBeenCalled()
  })
})
