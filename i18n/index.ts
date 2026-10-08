import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { es, type TKey } from './es';
import { en } from './en';
import { ja } from './ja';

// Idiomas de la web.
//
// Los textos están en es.ts (la referencia), en.ts y ja.ts. En una pantalla:
//
//   const t = useT();
//   <Text>{t('home.popular')}</Text>
//
// useT hace que la pantalla se repinte al cambiar de idioma. Fuera de un componente
// (un aviso lanzado desde una función, por ejemplo) se usa t() directamente.
//
// El idioma se elige solo la primera vez, por el idioma del navegador (no por el país:
// alguien en Japón puede tener el navegador en inglés, y es su idioma el que cuenta).
// Después se respeta lo que el usuario escoja, que se guarda en el dispositivo.
//
// Lo que se traduce es la web. Las novelas están en el idioma en que las escribió su autor.

export type Lang = 'es' | 'en' | 'ja';
export type { TKey };

export const LANGUAGES: { key: Lang; label: string; short: string }[] = [
  { key: 'es', label: 'Español', short: 'ES' },
  { key: 'en', label: 'English', short: 'EN' },
  { key: 'ja', label: '日本語', short: 'JA' },
];

const DICTS: Record<Lang, Record<TKey, string>> = { es, en, ja };
const STORAGE_KEY = 'immersa_lang';
const isLang = (v: unknown): v is Lang => v === 'es' || v === 'en' || v === 'ja';

// Idioma del navegador (o del sistema): el primero de sus preferidos que tengamos
function detect(): Lang {
  const nav = (globalThis as any).navigator;
  const wanted: string[] = [...(nav?.languages ?? []), nav?.language].filter(Boolean);
  for (const w of wanted) {
    const code = String(w).toLowerCase().split('-')[0];
    if (isLang(code)) return code;
  }
  // Ninguno de los nuestros: en la web, inglés (es lo que más gente entiende)
  return wanted.length > 0 ? 'en' : 'es';
}

function initial(): Lang {
  if (Platform.OS !== 'web') return 'es';
  try {
    const saved = (globalThis as any).localStorage?.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* sin acceso al almacenamiento */ }
  return detect();
}

let lang: Lang = initial();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const applyToDocument = () => {
  if (Platform.OS === 'web') { try { (globalThis as any).document.documentElement.lang = lang; } catch { /* nada */ } }
};
applyToDocument();

// En la app el idioma guardado se lee con retraso (el almacenamiento no es inmediato)
if (Platform.OS !== 'web') {
  AsyncStorage.getItem(STORAGE_KEY).then(saved => {
    if (isLang(saved) && saved !== lang) { lang = saved; listeners.forEach(l => l()); }
  }).catch(() => {});
}

export const getLang = () => lang;

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  applyToDocument();
  AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  listeners.forEach(l => l());
}

// El texto en el idioma actual. Si a un idioma le faltara alguno, sale en español.
export function t(key: TKey, params?: Record<string, string | number>): string {
  let text = DICTS[lang][key] ?? es[key] ?? key;
  if (params) for (const k in params) text = text.split(`{${k}}`).join(String(params[k]));
  return text;
}

// En un componente: devuelve t y repinta al cambiar de idioma
export function useT() {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

// Estado de una historia ('ongoing', 'completed'…) en el idioma actual
const STATUSES = ['ongoing', 'completed', 'hiatus', 'upcoming'];
export function statusLabel(status?: string | null): string {
  return t(`status.${STATUSES.includes(status ?? '') ? status : 'ongoing'}` as TKey);
}
