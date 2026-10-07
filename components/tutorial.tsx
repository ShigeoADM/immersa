import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Colors } from '@/constants/theme';
import { TEXT_BOX } from '@/constants/reader-layout';

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

// Pasos del tutorial, en orden. Cada uno es un cuadro de texto; el texto va en trozos
// para poder poner alguno en cursiva.
type Piece = { t: string; italic?: boolean };
const STEPS: Piece[][] = [
  [
    { t: 'Bienvenid@ al tutorial de Immersa. En este pequeño recorrido aprenderás las nociones básicas de la creación de ' },
    { t: 'Novela Moderna', italic: true },
    { t: '.' },
  ],
];

// Ritmo de la entrada: se llega a la pantalla, un momento después se oscurece, el cuadro
// se abre desde el centro y entonces el texto se escribe letra a letra.
const ARRIVE_MS = 900;
const DIM_MS = 450;
const OPEN_MS = 420;
const LETTER_MS = 22;

const BOX_MAX_WIDTH = 440;
// Alrededor del cuadro queda una franja sin oscurecer: se ve la página con su luz normal,
// y la oscuridad empieza poco a poco a partir de ahí. Es lo que hace destacar el cuadro.
const GLOW = 16;        // anchura de la franja iluminada
const GLOW_FADE = 22;   // cuánto tarda la oscuridad en llegar a su tope, hacia fuera
const DIM = 'rgba(0,0,0,0.74)';

// Tipografía del tutorial. En la web se pide a Google Fonts; en la app, la del sistema.
const FONT = Platform.OS === 'web' ? 'Outfit, "Segoe UI", system-ui, sans-serif' : undefined;
let fontRequested = false;
function ensureFont() {
  if (Platform.OS !== 'web' || fontRequested) return;
  fontRequested = true;
  const doc = (globalThis as any).document;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500&display=swap';
  doc.head.appendChild(link);
}

export function TutorialOverlay() {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  const pieces = current ? STEPS[current.step] : undefined;
  const total = pieces ? pieces.reduce((n, p) => n + p.t.length, 0) : 0;
  const win = useWindowDimensions();
  const boxWidth = Math.min(BOX_MAX_WIDTH, win.width - 32);

  const dim = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(0)).current;   // 0 = cerrado, 1 = abierto del todo
  const arrow = useRef(new Animated.Value(0)).current;
  const layer = useRef(new Animated.Value(1)).current;  // toda la capa (para desvanecerla al salir)
  const [shown, setShown] = useState(false);            // ya se llegó a la pantalla
  const [typed, setTyped] = useState(0);                // letras escritas
  const [boxHeight, setBoxHeight] = useState(0);        // altura del cuadro abierto
  const typingRef = useRef<any>(null);
  const done = typed >= total;

  const active = !!pieces;
  useEffect(() => { if (active) ensureFont(); }, [active]);

  // Al empezar: esperar a que se vea la pantalla y oscurecerla
  useEffect(() => {
    if (!active) { setShown(false); return; }
    dim.setValue(0); layer.setValue(1);
    const t = setTimeout(() => {
      setShown(true);
      Animated.timing(dim, { toValue: 1, duration: DIM_MS, useNativeDriver: Platform.OS !== 'web' }).start();
    }, ARRIVE_MS);
    return () => clearTimeout(t);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cada paso: el cuadro se abre desde el centro y después se escribe el texto
  useEffect(() => {
    if (!current || !shown) return;
    open.setValue(0); arrow.setValue(0);
    setTyped(0);
    let cancelled = false;
    const startTyping = () => {
      if (cancelled) return;
      typingRef.current = setInterval(() => setTyped(n => n + 1), LETTER_MS);
    };
    // (la altura no se puede animar con el motor nativo)
    Animated.timing(open, {
      toValue: 1, duration: OPEN_MS, delay: current.step === 0 ? DIM_MS - 100 : 0,
      easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start(startTyping);
    return () => { cancelled = true; clearInterval(typingRef.current); };
  }, [current?.step, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // Texto completo: se deja de escribir y aparece, parpadeando, el icono de continuar
  // (el mismo ↵ que marca en el lector que se puede pasar al párrafo siguiente)
  useEffect(() => {
    if (!active || !done || total === 0) return;
    clearInterval(typingRef.current);
    const native = Platform.OS !== 'web';
    arrow.setValue(1);
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(arrow, { toValue: 0.15, duration: 550, useNativeDriver: native }),
      Animated.timing(arrow, { toValue: 1, duration: 550, useNativeDriver: native }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [done, active, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avanzar, como en el lector: si el texto aún se está escribiendo, lo completa; si ya
  // está entero, pasa al siguiente cuadro (o termina).
  const advance = () => {
    if (!current || !shown) return;
    if (!done) { setTyped(total); return; }
    if (current.step + 1 < STEPS.length) setState({ step: current.step + 1 });
    else close();
  };
  // Final (o salida): todo se desvanece antes de quitarse
  const close = () => {
    Animated.timing(layer, { toValue: 0, duration: 300, useNativeDriver: Platform.OS !== 'web' }).start(() => stopTutorial());
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active || Platform.OS !== 'web') return;
    const win = globalThis as any;
    const onKey = (e: any) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advanceRef.current(); }
      else if (e.key === 'Escape') closeRef.current();
    };
    win.addEventListener('keydown', onKey);
    return () => win.removeEventListener('keydown', onKey);
  }, [active]);

  if (!current || !pieces || !shown) return null;

  // Los trozos del texto hasta la letra `count`
  const renderPieces = (count: number) => {
    let left = count;
    return pieces.map((p, i) => {
      const part = p.t.slice(0, Math.max(0, left));
      left -= p.t.length;
      return part ? <Text key={i} style={p.italic ? styles.italic : undefined}>{part}</Text> : null;
    });
  };

  return (
    <Animated.View style={[styles.layer, { opacity: layer }]}>
      {/* App: oscuridad lisa. En la web la oscuridad la pinta el halo de más abajo. */}
      {Platform.OS !== 'web' && <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: DIM, opacity: dim }]} />}
      <TouchableOpacity
        style={[styles.center, Platform.OS === 'web' ? ({ outlineStyle: 'none', cursor: 'default' } as any) : null]}
        activeOpacity={1}
        onPress={advance}
      >
        <View style={{ width: boxWidth }}>
          {/* Web: la oscuridad es la sombra enorme de este recuadro invisible, algo mayor que
              el cuadro. Dentro de él no hay sombra: esa es la franja iluminada. */}
          {Platform.OS === 'web' && (
            <Animated.View
              pointerEvents="none"
              style={[styles.glow, { opacity: dim }, ({ boxShadow: `0 0 ${GLOW_FADE}px 9999px ${DIM}` } as any)]}
            />
          )}
          {/* El cuadro se abre desde el centro hacia arriba y hacia abajo: una ventana que
              crece sobre un contenido de altura fija */}
          <Animated.View
            style={{
              justifyContent: 'center', overflow: 'hidden', borderRadius: TEXT_BOX.radius,
              height: boxHeight ? open.interpolate({ inputRange: [0, 1], outputRange: [0, boxHeight] }) : undefined,
              opacity: boxHeight ? 1 : 0,
            }}
          >
            <View
              style={[styles.box, { width: boxWidth }]}
              onLayout={e => setBoxHeight(e.nativeEvent.layout.height)}
            >
              {/* El texto entero, invisible, reserva el sitio: el cuadro no crece al escribirse */}
              <View>
                <Text style={[styles.text, { opacity: 0 }]}>{renderPieces(total)}</Text>
                <Text style={[styles.text, StyleSheet.absoluteFill]}>{renderPieces(typed)}</Text>
              </View>
              {done && (
                <Animated.View style={[styles.hint, { opacity: arrow }]}>
                  <MaterialIcons name="keyboard-return" size={16} color={Colors.emerald} />
                </Animated.View>
              )}
            </View>
          </Animated.View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 900, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  glow: {
    position: 'absolute', left: -GLOW, right: -GLOW, top: -GLOW, bottom: -GLOW,
    borderRadius: TEXT_BOX.radius + GLOW,
    // Un velo muy leve de luz: así la franja se nota también donde la página es negra
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  // Como el cuadro de texto del lector Moderno: oscuro y algo transparente
  box: {
    backgroundColor: 'rgba(22,24,30,0.82)', borderRadius: TEXT_BOX.radius,
    paddingHorizontal: 26, paddingTop: 22, paddingBottom: 26,
  },
  text: { fontFamily: FONT, fontSize: 16, lineHeight: 25, letterSpacing: 0.2, color: Colors.textPrimary },
  italic: { fontStyle: 'italic' },
  // Icono de continuar, en la esquina del cuadro como en el lector
  hint: { position: 'absolute', bottom: 10, right: 14 },
});
