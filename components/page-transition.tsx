import React, { useMemo } from 'react';
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

const SQUARE_COLS = 10;
const SQUARE_ROWS = 5;
const BLINDS = 9;

export function PageTransitionOverlay({ kind, progress, width, height }: Props) {
  // Barridos: un panel negro cruza la pantalla en una dirección
  const wipe = useMemo(() => {
    const axis = kind === 'wipeUp' || kind === 'wipeDown' ? 'translateY' : 'translateX';
    const size = axis === 'translateX' ? width : height;
    // Izquierda / arriba: entra por el lado contrario y sale por ese lado
    const sign = kind === 'wipeLeft' || kind === 'wipeUp' ? 1 : -1;
    return {
      axis,
      value: progress.interpolate({ inputRange: [0, 1, 2], outputRange: [sign * size, 0, -sign * size] }),
    };
  }, [kind, progress, width, height]);

  if (kind === 'wipeLeft' || kind === 'wipeRight' || kind === 'wipeUp' || kind === 'wipeDown') {
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.black, { transform: [{ [wipe.axis]: wipe.value } as any] }]}
        />
      </View>
    );
  }

  if (kind === 'flash') {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: '#fff', opacity: progress.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }) },
        ]}
      />
    );
  }

  if (kind === 'blinds') {
    // Persianas: franjas verticales que se cierran y se abren, una detrás de otra
    const stripW = width / BLINDS;
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip, styles.row]}>
        {Array.from({ length: BLINDS }, (_, i) => {
          const start = (i / (BLINDS - 1)) * 0.45;
          const scaleX = progress.interpolate({
            inputRange: [start, start + 0.55, 1 + start, 1 + start + 0.55],
            outputRange: [0, 1, 1, 0],
            extrapolate: 'clamp',
          });
          // +1 de ancho para que no quede rendija entre franjas
          return <Animated.View key={i} style={[styles.black, { width: stripW + 1, height, transform: [{ scaleX }] }]} />;
        })}
      </View>
    );
  }

  if (kind === 'squares') {
    // Cuadrados: una cuadrícula que se va rellenando en diagonal y luego se vacía
    const cellW = width / SQUARE_COLS;
    const cellH = height / SQUARE_ROWS;
    const cells: React.ReactNode[] = [];
    for (let r = 0; r < SQUARE_ROWS; r++) {
      for (let c = 0; c < SQUARE_COLS; c++) {
        const start = ((c + r) / (SQUARE_COLS + SQUARE_ROWS - 2)) * 0.6;
        const scale = progress.interpolate({
          inputRange: [start, start + 0.4, 1 + start, 1 + start + 0.4],
          outputRange: [0, 1.02, 1.02, 0],
          extrapolate: 'clamp',
        });
        cells.push(
          <Animated.View
            key={`${r}-${c}`}
            style={[styles.black, {
              position: 'absolute', left: c * cellW, top: r * cellH, width: cellW + 1, height: cellH + 1,
              transform: [{ scale }],
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
  if (kind === 'squares' || kind === 'blinds') return 480;
  if (kind === 'flash') return 220;
  return 340;
}

const styles = StyleSheet.create({
  clip:  { overflow: 'hidden' },
  row:   { flexDirection: 'row' },
  black: { backgroundColor: '#000' },
});
