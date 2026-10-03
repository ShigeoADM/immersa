// Formato Webnovel: lectura vertical con scroll continuo (tipo Wattpad).
// Un capítulo es un texto largo (chapters/{id}.content) con negrita y cursiva.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Temas de lectura (los elige el lector en sus ajustes) ────────────────────
export type WebnovelTheme = 'dark' | 'sepia' | 'light';

export const WEBNOVEL_THEMES: Record<WebnovelTheme, {
  label: string;
  background: string;
  text: string;
  muted: string;      // texto secundario (título de capítulo, contador)
  bar: string;        // cabecera y botones
  border: string;
  statusBar: 'light-content' | 'dark-content';
}> = {
  dark:  { label: 'Oscuro', background: '#121212', text: '#E4E4E4', muted: '#8A8A8A', bar: '#1A1A1A', border: '#2A2A2A', statusBar: 'light-content' },
  sepia: { label: 'Sepia',  background: '#F4ECD8', text: '#5B4636', muted: '#9A8468', bar: '#EDE3CB', border: '#DCCFB0', statusBar: 'dark-content' },
  light: { label: 'Claro',  background: '#FFFFFF', text: '#1F1F1F', muted: '#7A7A7A', bar: '#F5F5F5', border: '#E2E2E2', statusBar: 'dark-content' },
};

export const WEBNOVEL_THEME_ORDER: WebnovelTheme[] = ['dark', 'sepia', 'light'];
export const WEBNOVEL_THEME_DEFAULT: WebnovelTheme = 'dark';

// ── Letra ────────────────────────────────────────────────────────────────────
// Serif clásica de lectura web (Georgia en iOS; la serif del sistema en Android),
// sin descargar fuentes.
export const WEBNOVEL_FONT = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, serif' }) as string;

export const WEBNOVEL_FONT_SIZES = [14, 16, 18, 20, 22, 24, 28];
export const WEBNOVEL_FONT_SIZE_DEFAULT = 18;

// ── Preferencias del lector (se guardan en el móvil) ─────────────────────────
const THEME_KEY = 'immersa_webnovel_theme';
const FONT_SIZE_KEY = 'immersa_webnovel_font_size';

export async function getWebnovelTheme(): Promise<WebnovelTheme> {
  try {
    const v = await AsyncStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'sepia' || v === 'light' ? v : WEBNOVEL_THEME_DEFAULT;
  } catch { return WEBNOVEL_THEME_DEFAULT; }
}
export const setWebnovelTheme = (theme: WebnovelTheme) =>
  AsyncStorage.setItem(THEME_KEY, theme).catch(() => {});

export async function getWebnovelFontSize(): Promise<number> {
  try {
    const v = Number(await AsyncStorage.getItem(FONT_SIZE_KEY));
    return WEBNOVEL_FONT_SIZES.includes(v) ? v : WEBNOVEL_FONT_SIZE_DEFAULT;
  } catch { return WEBNOVEL_FONT_SIZE_DEFAULT; }
}
export const setWebnovelFontSize = (size: number) =>
  AsyncStorage.setItem(FONT_SIZE_KEY, String(size)).catch(() => {});

// ── Texto con formato ────────────────────────────────────────────────────────
// Se guarda como texto plano con marcas: **negrita**, *cursiva*, ***ambas***.
export type RichSegment = { text: string; bold: boolean; italic: boolean };

const MARK_RE = /(\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

export function parseRichText(line: string): RichSegment[] {
  return line.split(MARK_RE).filter(part => part.length > 0).map(part => {
    if (part.length > 6 && part.startsWith('***') && part.endsWith('***')) {
      return { text: part.slice(3, -3), bold: true, italic: true };
    }
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return { text: part.slice(2, -2), bold: true, italic: false };
    }
    if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
      return { text: part.slice(1, -1), bold: false, italic: true };
    }
    return { text: part, bold: false, italic: false };
  });
}

// Tramos con formato dentro de un texto completo, con su posición:
//   start/end → el tramo entero, marcas incluidas · n → longitud de cada marca (1, 2 o 3)
export type RichMark = { start: number; end: number; n: number };

export function findRichMarks(text: string): RichMark[] {
  const marks: RichMark[] = [];
  const re = new RegExp(MARK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = m[0].startsWith('***') ? 3 : m[0].startsWith('**') ? 2 : 1;
    marks.push({ start: m.index, end: m.index + m[0].length, n });
  }
  return marks;
}

// Texto sin marcas (para contar palabras)
export const stripRichText = (content: string) =>
  content.split('\n').map(line => parseRichText(line).map(s => s.text).join('')).join('\n');
