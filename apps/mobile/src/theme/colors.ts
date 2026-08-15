import { Appearance } from 'react-native'

export type ThemeMode = 'light' | 'dark'

export interface ThemeColors {
  // Backgrounds
  background: string
  surface: string
  surfaceVariant: string
  tabBar: string

  // Text
  text: string
  textSecondary: string
  textTertiary: string
  textOnPrimary: string

  // Borders
  border: string
  borderStrong: string

  // Interactive
  primary: string
  link: string
  destructive: string

  // Markdown
  markdownText: string
  markdownLink: string
  markdownCodeText: string
  markdownCodeBg: string
  markdownInlineCodeText: string
  markdownBorder: string

  // Status
  success: string
  warning: string
  error: string
  errorBg: string
}

const DARK: ThemeColors = {
  background: '#1a1a2e',
  surface: '#16213e',
  surfaceVariant: '#0f3460',
  tabBar: '#0f0f23',

  text: '#e6edf3',
  textSecondary: '#aaa',
  textTertiary: '#888',
  textOnPrimary: '#fff',

  border: '#16213e',
  borderStrong: '#30363d',

  primary: '#4a9eff',
  link: '#58a6ff',
  destructive: '#ff6b6b',

  markdownText: '#e6edf3',
  markdownLink: '#58a6ff',
  markdownCodeText: '#e6edf3',
  markdownCodeBg: '#0d1117',
  markdownInlineCodeText: '#e06c75',
  markdownBorder: '#30363d',

  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
  errorBg: '#c0392b',
}

const LIGHT: ThemeColors = {
  background: '#ffffff',
  surface: '#f5f5f7',
  surfaceVariant: '#e9e9eb',
  tabBar: '#f5f5f7',

  text: '#1a1a1a',
  textSecondary: '#555555',
  textTertiary: '#757575',
  textOnPrimary: '#ffffff',

  border: '#dcdce0',
  borderStrong: '#b8b8bc',

  primary: '#0066cc',
  link: '#0066cc',
  destructive: '#d93025',

  markdownText: '#1a1a1a',
  markdownLink: '#0066cc',
  markdownCodeText: '#24292e',
  markdownCodeBg: '#f0f0f0',
  markdownInlineCodeText: '#c7254e',
  markdownBorder: '#d0d0d0',

  success: '#1a7f37',
  warning: '#9a6700',
  error: '#cf222e',
  errorBg: '#dc2626',
}

export function getThemeColors(mode: ThemeMode): ThemeColors {
  return mode === 'light' ? LIGHT : DARK
}

export function getSystemThemeMode(): ThemeMode {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark'
}
