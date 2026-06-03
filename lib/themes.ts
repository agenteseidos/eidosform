import { ThemeConfig, ThemePreset } from './database.types'

export const themes: Record<ThemePreset, ThemeConfig> = {
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    primaryColor: '#8B5CF6',
    backgroundColor: '#0F0F1A',
    textColor: '#FFFFFF',
    accentColor: '#A78BFA',
    fontFamily: "'DM Sans', sans-serif",
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    primaryColor: '#0EA5E9',
    backgroundColor: '#0C1929',
    textColor: '#F0F9FF',
    accentColor: '#38BDF8',
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    primaryColor: '#F97316',
    backgroundColor: '#FFFBEB',
    textColor: '#1C1917',
    accentColor: '#FB923C',
    fontFamily: "'Outfit', sans-serif",
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    primaryColor: '#10B981',
    backgroundColor: '#022C22',
    textColor: '#ECFDF5',
    accentColor: '#34D399',
    fontFamily: "'Space Grotesk', sans-serif",
  },
  lavender: {
    id: 'lavender',
    name: 'Lavender',
    primaryColor: '#A855F7',
    backgroundColor: '#FAF5FF',
    textColor: '#1E1B4B',
    accentColor: '#C084FC',
    fontFamily: "'Sora', sans-serif",
  },
  minimal: {
    id: 'minimal',
    name: 'Minimal',
    primaryColor: '#18181B',
    backgroundColor: '#FFFFFF',
    textColor: '#18181B',
    accentColor: '#3F3F46',
    fontFamily: "'Inter', sans-serif",
  },
  terracota: {
    id: 'terracota',
    name: 'Terracota',
    primaryColor: '#2F5749',
    backgroundColor: '#F1E9DD',
    textColor: '#1C1917',
    accentColor: '#C2674A',
    fontFamily: "'DM Sans', sans-serif",
  },
}

export const themeList = Object.values(themes)

export function getTheme(preset: ThemePreset): ThemeConfig {
  return themes[preset] || themes.minimal
}

// Generate CSS variables from theme
export function getThemeCSSVariables(theme: ThemeConfig): React.CSSProperties {
  return {
    '--theme-primary': theme.primaryColor,
    '--theme-background': theme.backgroundColor,
    '--theme-text': theme.textColor,
    '--theme-accent': theme.accentColor,
    '--theme-font': theme.fontFamily,
  } as React.CSSProperties
}

