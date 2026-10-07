import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '@/constants/theme';

// Tutorial de Immersa: un recorrido guiado, como el de un juego. La pantalla se oscurece
// y van apareciendo cuadros de texto que explican cada cosa mientras se hace.
//
// EN PRUEBAS: por ahora solo se puede abrir desde la sección Desarrollo (app/dev.tsx).
//
// El estado vive fuera de React para poder arrancarlo desde cualquier pantalla y que la
// capa (montada una sola vez, en la raíz) lo siga aunque se cambie de pantalla.

type TutorialState = { step: number } | null;

let state: TutorialState = null;
const listeners = new Set<() => void>();
const setState = (next: TutorialState) => { state = next; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const startTutorial = () => setState({ step: 0 });
export const stopTutorial = () => setState(null);
// Solo en el servidor local de desarrollo: poder arrancarlo desde la consola del navegador
if (__DEV__) (globalThis as any).__startTutorial = startTutorial;

// Pasos del tutorial, en orden. Cada uno es un cuadro de texto.
const STEPS: { body: React.ReactNode; next: string }[] = [
  {
    body: (
      <>
        Bienvenid@ al tutorial de Immersa. En este pequeño recorrido aprenderás las nociones básicas de la
        creación de <Text style={{ fontStyle: 'italic' }}>Novela Moderna</Text>.
      </>
    ),
    next: 'Empezar',
  },
];

export function TutorialOverlay() {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  const step = current ? STEPS[current.step] : undefined;

  // Entrada: la pantalla se oscurece y el cuadro aparece creciendo un poco
  const dim = useRef(new Animated.Value(0)).current;
  const box = useRef(new Animated.Value(0)).current;
  const active = !!step;
  useEffect(() => {
    if (!active) return;
    const native = Platform.OS !== 'web';
    dim.setValue(0);
    Animated.timing(dim, { toValue: 1, duration: 350, useNativeDriver: native }).start();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!current) return;
    const native = Platform.OS !== 'web';
    box.setValue(0);
    Animated.timing(box, { toValue: 1, duration: 320, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [current?.step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current || !step) return null;

  const goNext = () => {
    if (current.step + 1 < STEPS.length) setState({ step: current.step + 1 });
    else stopTutorial();
  };

  return (
    <Animated.View style={[styles.dim, { opacity: dim }]}>
      <Animated.View
        style={[styles.box, {
          opacity: box,
          transform: [{ scale: box.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        }]}
      >
        <Text style={styles.text}>{step.body}</Text>
        <View style={styles.actions}>
          <TouchableOpacity onPress={stopTutorial} activeOpacity={0.7} hitSlop={8}>
            <Text style={styles.skip}>Salir del tutorial</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.next} onPress={goNext} activeOpacity={0.85}>
            <Text style={styles.nextText}>{step.next}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject, zIndex: 900, backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  box: {
    width: '100%', maxWidth: 420, padding: 22, gap: 18, borderRadius: 12,
    backgroundColor: '#141414', borderWidth: 1, borderColor: Colors.emerald + '70',
  },
  text: { fontSize: 15, lineHeight: 23, color: Colors.textPrimary, textAlign: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  skip: { fontSize: 12, color: Colors.textMuted, textDecorationLine: 'underline' },
  next: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 8, backgroundColor: Colors.emerald },
  nextText: { fontSize: 14, fontWeight: '700', color: '#000' },
});
