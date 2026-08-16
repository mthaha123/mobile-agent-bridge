# Theme System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a theme system that follows system color scheme (light/dark mode) while maintaining good contrast across all components.

**Architecture:** Create a React Context-based theme provider that detects system color scheme and provides theme colors to all components. Update all hardcoded colors to use theme tokens.

**Tech Stack:** React Native, Zustand (existing), React Context

---

## Current State

- All colors are hardcoded (`#1a1a2e`, `#16213e`, `#0f3460`, etc.)
- Only dark theme exists
- No `useColorScheme` hook usage
- Markdown renderer has hardcoded dark theme

## Target State

- System-aware theme (light/dark)
- Consistent contrast ratios (WCAG AA: 4.5:1 for normal text)
- Easy to extend with custom themes later

---

## Task 1: Create Theme Types and Colors

**Files:**
- Create: `apps/mobile/src/theme/colors.ts`
- Create: `apps/mobile/src/theme/index.ts`

**Step 1: Create color palette file**

```typescript
// apps/mobile/src/theme/colors.ts
export type ThemeMode = 'light' | 'dark'

export interface ThemeColors {
  // Backgrounds
  background: string
  surface: string
  surfaceVariant: string
  card: string
  
  // Text
  text: string
  textSecondary: string
  textTertiary: string
  textInverse: string
  
  // Borders
  border: string
  borderVariant: string
  
  // Interactive
  primary: string
  primaryText: string
  destructive: string
  
  // Markdown
  markdownText: string
  markdownLink: string
  markdownCode: string
  markdownCodeBg: string
  markdownBorder: string
  
  // Tool cards
  toolCardBg: string
  toolCardBorder: string
  toolCardTitle: string
  toolCardPath: string
  
  // Reasoning
  reasoningBg: string
  reasoningText: string
  
  // Status
  success: string
  warning: string
  error: string
}

export const lightColors: ThemeColors = {
  // Backgrounds
  background: '#ffffff',
  surface: '#f5f5f5',
  surfaceVariant: '#e8e8e8',
  card: '#ffffff',
  
  // Text
  text: '#1a1a1a',
  textSecondary: '#666666',
  textTertiary: '#999999',
  textInverse: '#ffffff',
  
  // Borders
  border: '#e0e0e0',
  borderVariant: '#d0d0d0',
  
  // Interactive
  primary: '#007AFF',
  primaryText: '#ffffff',
  destructive: '#ff3b30',
  
  // Markdown
  markdownText: '#1a1a1a',
  markdownLink: '#007AFF',
  markdownCode: '#d4d4d4',
  markdownCodeBg: '#f0f0f0',
  markdownBorder: '#d0d0d0',
  
  // Tool cards
  toolCardBg: '#f8f9fa',
  toolCardBorder: '#e0e0e0',
  toolCardTitle: '#1a1a1a',
  toolCardPath: '#666666',
  
  // Reasoning
  reasoningBg: '#f0f4f8',
  reasoningText: '#666666',
  
  // Status
  success: '#34c759',
  warning: '#ff9500',
  error: '#ff3b30',
}

export const darkColors: ThemeColors = {
  // Backgrounds
  background: '#1a1a2e',
  surface: '#16213e',
  surfaceVariant: '#1f3056',
  card: '#0f3460',
  
  // Text
  text: '#e6edf3',
  textSecondary: '#aaaaaa',
  textTertiary: '#888888',
  textInverse: '#1a1a1a',
  
  // Borders
  border: '#30363d',
  borderVariant: '#21262d',
  
  // Interactive
  primary: '#4a9eff',
  primaryText: '#ffffff',
  destructive: '#ff6b6b',
  
  // Markdown
  markdownText: '#e6edf3',
  markdownLink: '#58a6ff',
  markdownCode: '#e06c75',
  markdownCodeBg: '#0d1117',
  markdownBorder: '#30363d',
  
  // Tool cards
  toolCardBg: '#16213e',
  toolCardBorder: '#30363d',
  toolCardTitle: '#ffffff',
  toolCardPath: '#aaaaaa',
  
  // Reasoning
  reasoningBg: '#16213e',
  reasoningText: '#aaaaaa',
  
  // Status
  success: '#3fb950',
  warning: '#d29922',
  error: '#f85149',
}
```

**Step 2: Create theme index file**

```typescript
// apps/mobile/src/theme/index.ts
import { useColorScheme } from 'react-native'
import { ThemeColors, lightColors, darkColors } from './colors'

export type { ThemeColors }
export { lightColors, darkColors }

export function getThemeColors(colorScheme: 'light' | 'dark' | null | undefined): ThemeColors {
  return colorScheme === 'dark' ? darkColors : lightColors
}

export function useThemeColors(): ThemeColors {
  const colorScheme = useColorScheme()
  return getThemeColors(colorScheme)
}
```

**Step 3: Verify file structure**

Run: `ls apps/mobile/src/theme/`
Expected: `colors.ts index.ts`

---

## Task 2: Create Theme Context Provider

**Files:**
- Create: `apps/mobile/src/theme/ThemeContext.tsx`
- Modify: `apps/mobile/src/App.tsx` (wrap with provider)

**Step 1: Create ThemeContext**

```tsx
// apps/mobile/src/theme/ThemeContext.tsx
import React, { createContext, useContext } from 'react'
import { useColorScheme } from 'react-native'
import { ThemeColors, getThemeColors } from './colors'

const ThemeContext = createContext<ThemeColors>(getThemeColors('dark'))

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const colorScheme = useColorScheme()
  const colors = getThemeColors(colorScheme)
  
  return (
    <ThemeContext.Provider value={colors}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
```

**Step 2: Wrap app with ThemeProvider**

Find the root component in `App.tsx` and wrap it:

```tsx
import { ThemeProvider } from './theme/ThemeContext'

// In the root component:
<ThemeProvider>
  {/* existing app content */}
</ThemeProvider>
```

**Step 3: Verify provider works**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

---

## Task 3: Update MarkdownRenderer to Use Theme

**Files:**
- Modify: `apps/mobile/src/components/chat/MarkdownRenderer.tsx`

**Step 1: Update MarkdownRenderer**

```tsx
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useMarkdown } from 'react-native-marked'
import { useTheme } from '../../theme/ThemeContext'

interface MarkdownRendererProps {
  content: string
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const colors = useTheme()
  
  const MARKDOWN_THEME = {
    colors: {
      code: colors.markdownCodeBg,
      link: colors.markdownLink,
      text: colors.markdownText,
      border: colors.markdownBorder,
    },
    spacing: {},
  }

  let elements
  try {
    elements = useMarkdown(content, { 
      theme: MARKDOWN_THEME as any, 
      colorScheme: colors === darkColors ? 'dark' : 'light' as any 
    })
  } catch {
    return <Text style={[styles.fallback, { color: colors.markdownText }]}>{content}</Text>
  }

  return <View>{elements}</View>
}

const styles = StyleSheet.create({
  fallback: { fontSize: 14, lineHeight: 22 },
})
```

**Step 2: Verify no import errors**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

---

## Task 4: Update ChatScreen Colors

**Files:**
- Modify: `apps/mobile/src/screens/ChatScreen.tsx`

**Step 1: Add theme import and update styles**

```tsx
import { useTheme } from '../theme/ThemeContext'

// In the component:
const colors = useTheme()

// Update styles to use colors:
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBackText: {
    color: colors.primary,
    fontSize: 15,
  },
  // ... etc
})
```

**Step 2: Update all hardcoded colors**

Replace:
- `#1a1a2e` → `colors.background`
- `#16213e` → `colors.surface`
- `#0f3460` → `colors.card`
- `#e6edf3` → `colors.text`
- `#aaaaaa` → `colors.textSecondary`
- `#888888` → `colors.textTertiary`
- `#4a9eff` → `colors.primary`

**Step 3: Verify no TypeScript errors**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

---

## Task 5: Update PartBlock Colors

**Files:**
- Modify: `apps/mobile/src/components/chat/PartBlock.tsx`

**Step 1: Add theme import and update styles**

```tsx
import { useTheme } from '../../theme/ThemeContext'

// In the component:
const colors = useTheme()

// Update styles:
const styles = StyleSheet.create({
  reasoningBlock: {
    backgroundColor: colors.reasoningBg,
    borderRadius: 8,
    marginVertical: 4,
    overflow: 'hidden',
  },
  reasoningLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  reasoningText: {
    color: colors.reasoningText,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  // ... etc
})
```

**Step 2: Verify**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

---

## Task 6: Update Tool Components Colors

**Files:**
- Modify: `apps/mobile/src/components/chat/BasicTool.tsx`
- Modify: `apps/mobile/src/components/chat/ContextToolGroup.tsx`
- Modify: `apps/mobile/src/components/ToolProgressCard.tsx`

**Step 1: Update BasicTool.tsx**

```tsx
import { useTheme } from '../../theme/ThemeContext'

const colors = useTheme()

// Update styles:
const styles = StyleSheet.create({
  toolCard: {
    backgroundColor: colors.toolCardBg,
    borderRadius: 8,
    marginVertical: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.toolCardBorder,
  },
  // ... etc
})
```

**Step 2: Update ContextToolGroup.tsx**

Same pattern as BasicTool.

**Step 3: Update ToolProgressCard.tsx**

Same pattern.

**Step 4: Verify**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

---

## Task 7: Update Remaining Screens

**Files:**
- Modify: `apps/mobile/src/screens/SessionsScreen.tsx`
- Modify: `apps/mobile/src/screens/SettingsScreen.tsx`
- Modify: `apps/mobile/src/screens/ConnectScreen.tsx`
- Modify: `apps/mobile/src/screens/FileBrowserScreen.tsx`
- Modify: `apps/mobile/src/screens/FileViewerScreen.tsx`

**Step 1: Update each screen**

For each screen:
1. Add `import { useTheme } from '../theme/ThemeContext'`
2. Add `const colors = useTheme()` in component
3. Replace hardcoded colors with theme tokens

**Step 2: Verify**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

---

## Task 8: Update Remaining Components

**Files:**
- Modify: `apps/mobile/src/components/MainLayout.tsx`
- Modify: `apps/mobile/src/components/ToolRenderer.tsx`
- Modify: `apps/mobile/src/components/ReasoningCollapsible.tsx`
- Modify: `apps/mobile/src/components/chat/ShellOutput.tsx`
- Modify: `apps/mobile/src/components/chat/QuestionDock.tsx`
- Modify: `apps/mobile/src/components/chat/PermissionDock.tsx`
- Modify: `apps/mobile/src/components/chat/DiffDisplay.tsx`
- Modify: `apps/mobile/src/components/chat/AttachmentBar.tsx`
- Modify: `apps/mobile/src/screens/QuestionSheet.tsx`
- Modify: `apps/mobile/src/screens/SlashSheet.tsx`
- Modify: `apps/mobile/src/screens/SessionInfoModal.tsx`
- Modify: `apps/mobile/src/screens/ToolApprovalSheet.tsx`

**Step 1: Update each component**

Same pattern as Task 7.

**Step 2: Verify**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

---

## Task 9: Run Tests and Build

**Step 1: Run unit tests**

Run: `cd apps/mobile && npm test`
Expected: All tests pass

**Step 2: Run TypeScript check**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: No errors

**Step 3: Build APK**

Run: `cd apps/mobile/android && .\gradlew assembleRelease --no-daemon`
Expected: Build succeeds

---

## Task 10: Visual Verification

**Step 1: Install on emulator**

```powershell
$adb = "C:\Users\MT\AppData\Local\Android\Sdk\platform-tools\adb.exe"
& $adb -s emulator-5554 install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

**Step 2: Take screenshots in both modes**

1. Open app, take screenshot in dark mode
2. Change system to light mode, take screenshot
3. Verify contrast in both modes

**Step 3: Verify markdown rendering**

1. Open a session with markdown content
2. Verify text is readable in both themes
3. Verify links are visible

---

## Contrast Ratio Checklist

| Element | Light Mode | Dark Mode | Ratio |
|---------|------------|-----------|-------|
| Body text | `#1a1a1a` on `#ffffff` | `#e6edf3` on `#1a1a2e` | >7:1 |
| Secondary text | `#666666` on `#ffffff` | `#aaaaaa` on `#1a1a2e` | >4.5:1 |
| Links | `#007AFF` on `#ffffff` | `#58a6ff` on `#1a1a2e` | >4.5:1 |
| Tool card title | `#1a1a1a` on `#f8f9fa` | `#ffffff` on `#16213e` | >7:1 |
| Tool card path | `#666666` on `#f8f9fa` | `#aaaaaa` on `#16213e` | >4.5:1 |

---

## Commit Strategy

After each task:
```bash
git add -A
git commit -m "feat(theme): task N - description"
```

Final commit:
```bash
git commit -m "feat(theme): implement light/dark theme system with system detection"
```
