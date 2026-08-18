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
  FlatList: React.forwardRef((props, ref) => {
    const { children, data, renderItem, ...rest } = props
    const items = data && renderItem
      ? data.map(function(item, index) {
          return React.createElement('FlatList-Item', { key: item.id ?? index },
            renderItem({ item, index, separators: {} }),
          )
        })
      : children
    return React.createElement('FlatList', { ...rest, ref }, items)
  }),
  Modal: mockComponent('Modal'),
  ActivityIndicator: mockComponent('ActivityIndicator'),
  KeyboardAvoidingView: mockComponent('KeyboardAvoidingView'),
  SafeAreaView: mockComponent('SafeAreaView'),
  StatusBar: mockComponent('StatusBar'),
  Image: mockComponent('Image'),
  Pressable: mockComponent('Pressable'),

  // Utilities
  Clipboard: { setString: jest.fn(), getString: jest.fn().mockResolvedValue('') },
  StyleSheet: { create: (s) => s },
  Platform: { OS: 'ios', select: (obj) => (obj ? obj.ios ?? obj.default ?? null : null) },
  Alert: { alert: jest.fn() },
  Dimensions: { get: () => ({ width: 375, height: 812 }) },
  Share: { share: jest.fn().mockResolvedValue({ action: 'sharedAction' }), sharedAction: 'sharedAction', dismissedAction: 'dismissedAction' },

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
  LayoutAnimation: {
    configureNext: jest.fn(),
    easeInEaseOut: jest.fn(),
    Presets: { easeInEaseOut: { duration: 300, update: { type: 2 } } },
    Types: { easeInEaseOut: 2 },
    Properties: { opacity: 1 },
  },
  UIManager: {},

  // LogBox
  LogBox: { ignoreLogs: jest.fn() },

  // I18n
  I18nManager: { isRTL: false, allowRTL: () => {}, forceRTL: () => {} },
}
