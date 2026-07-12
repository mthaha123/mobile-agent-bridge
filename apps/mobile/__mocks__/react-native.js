/**
 * Auto-mock for react-native — used by Jest before test files load.
 * Provides proper React elements with real props for interaction testing.
 */
const React = require('react')

function mockComponent(name) {
  const Comp = (props) => {
    const { children, ...rest } = props
    return React.createElement(name, rest, children)
  }
  Comp.displayName = name
  return Comp
}

function mockRefComponent(name) {
  const Comp = React.forwardRef((props, ref) => {
    const { children, ...rest } = props
    return React.createElement(name, { ...rest, ref }, children)
  })
  Comp.displayName = name
  return Comp
}

module.exports = {
  // Core components
  View: mockComponent('View'),
  Text: mockComponent('Text'),
  TextInput: mockRefComponent('TextInput'),
  TouchableOpacity: mockComponent('TouchableOpacity'),
  ScrollView: mockRefComponent('ScrollView'),
  FlatList: mockRefComponent('FlatList'),
  Modal: mockComponent('Modal'),
  ActivityIndicator: mockComponent('ActivityIndicator'),
  KeyboardAvoidingView: mockComponent('KeyboardAvoidingView'),
  SafeAreaView: mockComponent('SafeAreaView'),
  StatusBar: mockComponent('StatusBar'),
  Image: mockComponent('Image'),
  Pressable: mockComponent('Pressable'),

  // Utilities
  StyleSheet: { create: (s) => s },
  Platform: { OS: 'ios', select: (obj) => (obj ? obj.ios ?? obj.default ?? null : null) },
  Alert: { alert: jest.fn() },
  Dimensions: { get: () => ({ width: 375, height: 812 }) },

  // Hooks
  useWindowDimensions: () => ({ width: 375, height: 812 }),
  useColorScheme: () => 'dark',

  // Native modules (stubs)
  NativeModules: {},
  NativeEventEmitter: class {
    constructor() {}
    addListener() {}
    removeAllListeners() {}
  },

  // Animated
  Animated: {
    View: mockComponent('Animated.View'),
    Text: mockComponent('Animated.Text'),
    Image: mockComponent('Animated.Image'),
    createAnimatedComponent: (comp) => comp,
    timing: () => ({ start: jest.fn() }),
    spring: () => ({ start: jest.fn() }),
    Value: class {
      constructor(v) { this._value = v }
      setValue(v) { this._value = v }
      interpolate() { return { __getValue: () => 0 } }
    },
  },

  // Layout
  LayoutAnimation: { configureNext: jest.fn(), easeInEaseOut: jest.fn() },
  UIManager: {},

  // LogBox
  LogBox: { ignoreLogs: jest.fn() },

  // I18n
  I18nManager: { isRTL: false, allowRTL: () => {}, forceRTL: () => {} },
}
