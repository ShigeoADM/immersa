// Clasificación de una historia: público y contenido adulto.
// Lo usan la pantalla de creación (para elegir) y la ficha de la historia (para mostrar).

export const GENRES = [
  'Fantasía', 'Romance', 'Acción', 'Aventura', 'Misterio',
  'Terror', 'Ciencia Ficción', 'Drama', 'Comedia', 'Thriller',
  'Histórico', 'Sobrenatural', 'Slice of Life', 'Cyberpunk',
];

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

export const audienceLabel = (key?: string) => AUDIENCES.find(a => a.key === key)?.label ?? null;
export const adultContentLabel = (key: string) => ADULT_CONTENT.find(c => c.key === key)?.label ?? key;
