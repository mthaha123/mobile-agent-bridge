// React Native test environment setup
global.IS_REACT_ACT_ENVIRONMENT = true
global.IS_REACT_NATIVE_TEST_ENVIRONMENT = true

global.__DEV__ = true

global.cancelAnimationFrame = (id) => clearTimeout(id)

// Mock native fabric UI manager
if (!global.nativeFabricUIManager) {
  global.nativeFabricUIManager = {}
}
