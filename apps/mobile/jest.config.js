/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.{ts,tsx}'],
  moduleNameMapper: {
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
    '^react-native/(.*)$': '<rootDir>/__mocks__/react-native.js',
    '^react-native-blob-util$': '<rootDir>/__mocks__/react-native-blob-util.js',
    '^react-native-markdown-display$': '<rootDir>/__mocks__/react-native-markdown-display.js',
    '^react-native-marked$': '<rootDir>/__mocks__/react-native-marked.js',
    '^react-native-webview$': '<rootDir>/__mocks__/react-native-webview.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          target: 'es2022',
          strict: true,
          esModuleInterop: true,
        },
        diagnostics: {
          ignoreCodes: [151001, 151002, 2307],
        },
      },
    ],
  },
}
