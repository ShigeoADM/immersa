import { t, type TKey } from '@/i18n';

// Clasificación de una historia: público y contenido adulto.
// Lo usan la pantalla de creación (para elegir) y la ficha de la historia (para mostrar).

export const GENRES = [
  'Fantasía', 'Romance', 'Acción', 'Aventura', 'Misterio',
  'Terror', 'Ciencia Ficción', 'Drama', 'Comedia', 'Thriller',
  'Histórico', 'Sobrenatural', 'Slice of Life', 'Cyberpunk',
];

// Idioma en que está escrita la historia (se guarda tal cual; 'Otro' se enseña traducido)
export const STORY_LANGUAGES = ['Español', 'English', '日本語', 'Português', 'Français', 'Deutsch', 'Otro'];

export const AUDIENCES = [
  { key: 'u15',   label: 'Menores de 15 años' },
  { key: '15-18', label: 'Entre 15 y 18 años' },
  { key: '18-25', label: 'Entre 18 y 25 años' },
  { key: 'o25',   label: 'Más de 25 años' },
];

// Con contenido +18 solo se permite público adulto
export const ADULT_AUDIENCES = ['18-25', 'o25'];

export const ADULT_CONTENT = [
  { key: 'sexual',    label: 'Contenido sexual' },
  { key: 'gore',      label: 'Gore' },
  { key: 'violence',  label: 'Violencia extrema' },
  { key: 'nudity',    label: 'Desnudo parcial en ilustraciones' },
];

// (en el idioma actual de la web; las etiquetas de arriba son la referencia en español)
export const audienceLabel = (key?: string) =>
  AUDIENCES.some(a => a.key === key) ? t(`audience.${key}` as TKey) : null;
export const adultContentLabel = (key: string) =>
  ADULT_CONTENT.some(c => c.key === key) ? t(`adult.${key}` as TKey) : key;
