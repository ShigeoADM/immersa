import { Platform } from 'react-native';

export const Colors = {
  bg: '#0A0A0A',
  surface: '#121212',
  card: '#161616',
  border: '#1E1E1E',
  emerald: '#00C878',
  aqua: '#00D4B8',
  textPrimary: '#F0F0F0',
  textSecondary: '#888888',
  textMuted: '#444444',
  formatColors: {
    Moderno: '#00C878',
    Webnovel: '#7B68EE',
    Clásico: '#C8A200',
  },
  // Compatibilidad con componentes de Expo que usan light/dark
  light: {
    text: '#F0F0F0',
    background: '#0A0A0A',
    tint: '#00C878',
    icon: '#888888',
    tabIconDefault: '#444444',
    tabIconSelected: '#00C878',
  },
  dark: {
    text: '#F0F0F0',
    background: '#0A0A0A',
    tint: '#00C878',
    icon: '#888888',
    tabIconDefault: '#444444',
    tabIconSelected: '#00C878',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});
