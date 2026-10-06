import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import type { PageTransition } from '@/constants/reader-layout';

// Animaciones de cambio de página del lector Moderno (las que no son el fundido).
//
// Todas funcionan igual: una capa tapa la escena (progress 0 → 1), con la escena
// tapada se cambia de página, y la capa se retira (progress 1 → 2). Así basta una
// sola escena en pantalla: no hace falta pintar la página vieja y la nueva a la vez.
type Props = {
  kind: PageTransition;
  progress: Animated.Value; // 0 = escena a la vista, 1 = tapada, 2 = a la vista otra vez
  width: number;
  height: number;
};

const COLS = 10;
const ROWS = 5;
const STRIPS_V = 9;   // persianas verticales
const STRIPS_H = 6;   // persianas horizontales

// Piezas que aparecen y desaparecen escalonadas: cada una empieza en `start` (0…spread)
// y tarda `1 - spread` en completarse, tanto al tapar como al destapar.
function staggered(progress: Animated.Value, start: number, spread: number, full = 1.02) {
  const span = 1 - spread;
  return progress.interpolate({
    inputRange: [start, start + span, 1 + start, 1 + start + span],
    outputRange: [0, full, full, 0],
    extrapolate: 'clamp',
  });
}

// Orden pseudoaleatorio pero fijo para cada casilla (mismo dibujo en cada cambio)
const scatter = (c: number, r: number) => {
  const x = Math.sin((c + 1) * 127.1 + (r + 1) * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

type CellOrder = (c: number, r: number) => number; // 0…1: cuándo empieza cada casilla
const ORDER: Record<string, CellOrder> = {
  // En diagonal, de la esquina superior izquierda a la inferior derecha
  squares: (c, r) => (c + r) / (COLS + ROWS - 2),
  // Del centro hacia fuera
  squaresCenter: (c, r) => {
    const dx = (c - (COLS - 1) / 2) / ((COLS - 1) / 2);
    const dy = (r - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
    return Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.SQRT2);
  },
  // Salteado, como un mosaico que se va rellenando
  mosaic: scatter,
  // Rombos, de izquierda a derecha
  diamonds: (c, r) => (c + (r % 2) * 0.5) / (COLS - 0.5),
};

export function PageTransitionOverlay({ kind, progress, width, height }: Props) {
  const through = (a: number, b: number, c: number) =>
    progress.interpolate({ inputRange: [0, 1, 2], outputRange: [a, b, c] });

  // ── Barridos: un panel negro cruza la pantalla en una dirección ─────────────
  if (kind === 'wipeLeft' || kind === 'wipeRight' || kind === 'wipeUp' || kind === 'wipeDown') {
    const vertical = kind === 'wipeUp' || kind === 'wipeDown';
    const size = vertical ? height : width;
    // Izquierda / arriba: entra por el lado contrario y sale por ese lado
    const sign = kind === 'wipeLeft' || kind === 'wipeUp' ? 1 : -1;
    const value = through(sign * size, 0, -sign * size);
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.black, { transform: [vertical ? { translateY: value } : { translateX: value }] }]}
        />
      </View>
    );
  }

  // ── Fundido a negro y destello blanco ───────────────────────────────────────
  if (kind === 'flash' || kind === 'fadeBlack') {
    return (
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: kind === 'flash' ? '#fff' : '#000', opacity: through(0, 1, 0) }]}
      />
    );
  }

  // ── Telón: dos paneles se cierran desde los lados (o desde arriba y abajo) ──
  if (kind === 'curtain' || kind === 'eyelid') {
    const vertical = kind === 'eyelid';
    const half = (vertical ? height : width) / 2;
    const first  = through(-half, 0, -half);
    const second = through(half, 0, half);
    const panel = vertical
      ? { left: 0, right: 0, height: half + 1 }
      : { top: 0, bottom: 0, width: half + 1 };
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
        <Animated.View
          style={[styles.abs, styles.black, panel, vertical ? { top: 0 } : { left: 0 },
            { transform: [vertical ? { translateY: first } : { translateX: first }] }]}
        />
        <Animated.View
          style={[styles.abs, styles.black, panel, vertical ? { bottom: 0 } : { right: 0 },
            { transform: [vertical ? { translateY: second } : { translateX: second }] }]}
        />
      </View>
    );
  }

  // ── Persianas: franjas que se cierran y se abren, una detrás de otra ────────
  if (kind === 'blinds' || kind === 'blindsH') {
    const horizontal = kind === 'blindsH';
    const count = horizontal ? STRIPS_H : STRIPS_V;
    const stripW = width / STRIPS_V;
    const stripH = height / STRIPS_H;
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, horizontal ? null : styles.row]}>
        {Array.from({ length: count }, (_, i) => {
          const scale = staggered(progress, (i / (count - 1)) * 0.45, 0.45, 1);
          // +1 para que no quede rendija entre franjas
          return horizontal
            ? <Animated.View key={i} style={[styles.black, { width, height: stripH + 1, transform: [{ scaleY: scale }] }]} />
            : <Animated.View key={i} style={[styles.black, { width: stripW + 1, height, transform: [{ scaleX: scale }] }]} />;
        })}
      </View>
    );
  }

  // ── Cuadrícula: cuadrados (o rombos) que se rellenan en distinto orden ──────
  const order = ORDER[kind];
  if (order) {
    const diamond = kind === 'diamonds';
    const cellW = width / COLS;
    const cellH = height / ROWS;
    const cells: React.ReactNode[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // Un rombo (cuadrado girado 45°) tiene que crecer más para cubrir su casilla
        const scale = staggered(progress, order(c, r) * 0.6, 0.6, diamond ? 1.6 : 1.02);
        cells.push(
          <Animated.View
            key={`${r}-${c}`}
            style={[styles.abs, styles.black, {
              left: c * cellW, top: r * cellH, width: cellW + 1, height: cellH + 1,
              transform: diamond ? [{ rotate: '45deg' }, { scale }] : [{ scale }],
            }]}
          />,
        );
      }
    }
    return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>{cells}</View>;
  }

  return null;
}

// Duración de cada mitad (tapar / destapar), en ms
export function transitionHalfMs(kind: PageTransition): number {
  switch (kind) {
    case 'squares': case 'squaresCenter': case 'mosaic': case 'diamonds':
    case 'blinds': case 'blindsH':
      return 480;
    case 'flash':
      return 220;
    case 'fadeBlack':
      return 420;
    case 'curtain': case 'eyelid':
      return 380;
    default:
      return 340;
  }
}

const styles = StyleSheet.create({
  clip:  { overflow: 'hidden' },
  row:   { flexDirection: 'row' },
  abs:   { position: 'absolute' },
  black: { backgroundColor: '#000' },
});
