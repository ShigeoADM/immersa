// Medidas del lector "moderno" compartidas con el editor de páginas.
// El editor escala estos valores para que su preview sea fiel a lo que se ve al leer.

export type TextSize = 'xs' | 'sm' | 'md' | 'lg';

// Pantalla de referencia: móvil medio en horizontal (≈ 19,5:9, en dp).
// El lector ocupa la pantalla completa en landscape.
export const REF_SCREEN = { width: 844, height: 390 };

export const FONT_SIZES: Record<TextSize, number> = { xs: 11, sm: 13, md: 15, lg: 19 };

// Desenfoque de la imagen de fondo (radio en dp, con el Image de React Native).
// No se usa el blurRadius de expo-image: en Android reduce la imagen ×4 antes de
// desenfocar y solo acepta enteros, así que hasta 1 ya desenfocaba demasiado.
// Por defecto uno suave: el formato Moderno está pensado sobre todo para webnovel.
// Las páginas sin el campo bgBlur usan el valor por defecto.
export const BG_BLUR_DEFAULT = 3;
export const BG_BLUR_MAX = 25;
export const BG_BLUR_PRESETS: { value: number; label: string }[] = [
  { value: 0,  label: 'Sin' },
  { value: 3,  label: 'Suave' },
  { value: 6,  label: 'Medio' },
  { value: 12, label: 'Fuerte' },
  { value: 20, label: 'Máximo' },
];

// Volumen de la música. Cada pista tiene un ajuste del autor (musicVolume, 1 = 100 %)
// que multiplica el volumen base del lector.
export const MUSIC_BASE_VOLUME = 0.65;
export const MUSIC_VOLUME_MIN  = 0.1;
export const MUSIC_VOLUME_MAX  = 1.5;   // 0,65 × 1,5 ≈ 1 (máximo del reproductor)
export const MUSIC_VOLUME_STEP = 0.1;
export const musicPlaybackVolume = (musicVolume = 1) =>
  Math.min(1, MUSIC_BASE_VOLUME * musicVolume);

// Volumen de los efectos de sonido de página (mismo esquema: sfxVolume, 1 = 100 %)
export const SFX_BASE_VOLUME = 0.8;
export const SFX_VOLUME_MAX  = 1.2;     // 0,8 × 1,2 ≈ 1
export const sfxPlaybackVolume = (sfxVolume = 1) =>
  Math.min(1, SFX_BASE_VOLUME * sfxVolume);

// Efectos de sonido de una página. Cada uno suena al aparecer un párrafo concreto
// (1 = el primero, es decir, al llegar a la página). Puede haber varios.
// Las páginas antiguas tienen un único efecto (sfxUrl / sfxVolume), que equivale a un
// efecto en el párrafo 1; se sigue guardando para los lectores que no conocen la lista.
export type SfxCue = { paragraph: number; url: string; volume?: number };
export function pageSfxCues(page?: { sfxCues?: SfxCue[]; sfxUrl?: string; sfxVolume?: number } | null): SfxCue[] {
  if (!page) return [];
  if (Array.isArray(page.sfxCues)) return page.sfxCues.filter(c => c && !!c.url);
  return page.sfxUrl ? [{ paragraph: 1, url: page.sfxUrl, volume: page.sfxVolume }] : [];
}
// Los párrafos se separan con una línea en blanco (igual en el editor y en el lector)
export function splitParagraphs(text: string): string[] {
  return text.split(/\n\n+/).map(p => p.replace(/^\n+|\n+$/g, '')).filter(p => p.length > 0);
}

// Animación con la que se PASA una página (al salir de ella hacia otra). Si la página
// no define ninguna, la hereda de la página de la que se vino; por defecto, fundido.
export type PageTransition =
  | 'none' | 'fade' | 'fadeBlack' | 'flash'
  | 'wipeLeft' | 'wipeRight' | 'wipeUp' | 'wipeDown'
  | 'curtain' | 'eyelid'
  | 'blinds' | 'blindsH'
  | 'squares' | 'squaresCenter' | 'mosaic' | 'diamonds';
export const DEFAULT_PAGE_TRANSITION: PageTransition = 'fade';
export const PAGE_TRANSITIONS: { value: PageTransition; label: string; icon: string }[] = [
  { value: 'none',          label: 'Sin animación',        icon: 'block' },
  { value: 'fade',          label: 'Desvanecer',           icon: 'gradient' },
  { value: 'fadeBlack',     label: 'Fundido a negro',      icon: 'brightness-2' },
  { value: 'flash',         label: 'Destello',             icon: 'flash-on' },
  { value: 'wipeLeft',      label: 'Barrido',              icon: 'arrow-back' },
  { value: 'wipeRight',     label: 'Barrido',              icon: 'arrow-forward' },
  { value: 'wipeUp',        label: 'Barrido',              icon: 'arrow-upward' },
  { value: 'wipeDown',      label: 'Barrido',              icon: 'arrow-downward' },
  { value: 'curtain',       label: 'Telón',                icon: 'compare-arrows' },
  { value: 'eyelid',        label: 'Parpadeo',             icon: 'unfold-less' },
  { value: 'blinds',        label: 'Persianas verticales', icon: 'view-week' },
  { value: 'blindsH',       label: 'Persianas horizontales', icon: 'view-stream' },
  { value: 'squares',       label: 'Cuadrados en diagonal', icon: 'grid-view' },
  { value: 'squaresCenter', label: 'Cuadrados desde el centro', icon: 'filter-center-focus' },
  { value: 'mosaic',        label: 'Mosaico',              icon: 'apps' },
  { value: 'diamonds',      label: 'Rombos',               icon: 'grid-4x4' },
];

// Duración del fundido de la música al entrar, salir o cambiar de pista
export const MUSIC_FADE_MS = 450;

// Cuadro de texto del lector
export const TEXT_BOX = {
  radius: 14,
  paddingHorizontal: 28,
  paddingTop: 16,
  paddingBottom: 14,
  letterSpacing: 0.8,
};

// Etiqueta de nombre de personaje del lector
export const CHAR_LABEL = {
  fontSize: 11,
  paddingHorizontal: 10,
  paddingVertical: 4,
  letterSpacing: 0.8,
  radius: 6,
};

// Posición (px, esquina superior izquierda del layout SIN rotar) de una etiqueta de personaje.
// side: 0 = libre, 1 = arriba, 2 = abajo, 3 = izquierda (−90°), 4 = derecha (+90°).
// Si está pegada, el eje pegado se deriva del bloque y el eje libre se limita para que la
// etiqueta no sobresalga del bloque. Las laterales giran sobre su centro, así que su ancho
// visual es lH y su alto visual es lW.
export function charLabelPos(
  side: number,
  freeX: number, freeY: number,
  lW: number, lH: number,
  tbL: number, tbT: number, tbR: number, tbB: number,
): { left: number; top: number } {
  'worklet';
  if (side === 1 || side === 2) {
    const left = Math.max(tbL, Math.min(tbR - lW, freeX));
    return { left, top: side === 1 ? tbT - lH : tbB };
  }
  if (side === 3 || side === 4) {
    const cx = side === 3 ? tbL - lH / 2 : tbR + lH / 2;
    const top = Math.max(tbT + lW / 2 - lH / 2, Math.min(tbB - lW / 2 - lH / 2, freeY));
    return { left: cx - lW / 2, top };
  }
  return { left: freeX, top: freeY };
}

// Bordes, radios y rotación de la etiqueta según el lado al que está pegada.
// Los bordes se expresan en espacio de LAYOUT (antes de rotar): con −90° (izq) y +90° (der)
// el borde inferior del layout es el que queda tocando el bloque.
export function charLabelSideStyle(side: number, radius: number) {
  'worklet';
  const flatBottom = side === 1 || side === 3 || side === 4;
  return {
    borderTopWidth:          side === 2 ? 0 : 1,
    borderBottomWidth:       flatBottom ? 0 : 1,
    borderLeftWidth:         1,
    borderRightWidth:        1,
    borderTopLeftRadius:     side === 2 ? 0 : radius,
    borderTopRightRadius:    side === 2 ? 0 : radius,
    borderBottomLeftRadius:  flatBottom ? 0 : radius,
    borderBottomRightRadius: flatBottom ? 0 : radius,
    transform: [{ rotate: side === 3 ? '-90deg' : side === 4 ? '90deg' : '0deg' }],
  };
}
