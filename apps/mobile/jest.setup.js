// React Native test environment setup
global.IS_REACT_ACT_ENVIRONMENT = true
global.IS_REACT_NATIVE_TEST_ENVIRONMENT = true

global.__DEV__ = true

global.cancelAnimationFrame = (id) => clearTimeout(id)

// Mock native fabric UI manager
if (!global.nativeFabricUIManager) {
  global.nativeFabricUIManager = {}
}

// ── React 19 + react-test-renderer@19 升级垫片 ──
// React 19 起，RTR.create() 的初始渲染被推迟到 act() 内：在 act 外 create 得到空树
// （toJSON()===null、.root 抛 "Can't access .root on unmounted test renderer"），
// 全仓 ~100 处 `TestRenderer.create(<X/>)` 与 RNTL 内部的 create 都会中招。
// 这里统一把 create 包一层 act（act 内再 create 是合法嵌套），测试写法保持不变。
// 注：react-test-renderer 在 React 19 已弃用，长期路线是全面迁到 RNTL；本垫片仅升级期适配。
const reactTestRenderer = require('react-test-renderer')
if (
  reactTestRenderer &&
  typeof reactTestRenderer.create === 'function' &&
  !reactTestRenderer.create.__actWrapped
) {
  const originalCreate = reactTestRenderer.create
  const actWrappedCreate = (...args) => {
    let instance
    reactTestRenderer.act(() => {
      instance = originalCreate(...args)
    })
    return instance
  }
  actWrappedCreate.__actWrapped = true
  reactTestRenderer.create = actWrappedCreate
}
