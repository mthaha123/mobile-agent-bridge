import React, { createContext, useContext } from 'react'
import { useColorScheme } from 'react-native'
import { ThemeColors, ThemeMode, getThemeColors } from './colors'

const ThemeContext = createContext<ThemeColors>(getThemeColors('dark'))
const ThemeModeContext = createContext<ThemeMode>('dark')

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const scheme = useColorScheme()
  const mode: ThemeMode = scheme === 'light' ? 'light' : 'dark'
  const theme = getThemeColors(mode)

  return (
    <ThemeModeContext.Provider value={mode}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemeModeContext.Provider>
  )
}

export const useThemeColors = (): ThemeColors => useContext(ThemeContext)
export const useThemeMode = (): ThemeMode => useContext(ThemeModeContext)
