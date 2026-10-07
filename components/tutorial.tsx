import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Audio } from 'expo-av';
import { Colors } from '@/constants/theme';
import { TEXT_BOX } from '@/constants/reader-layout';

// Tutorial de Immersa: un recorrido guiado, como el de un juego. La pantalla se oscurece
// y van apareciendo cuadros de texto que explican cada cosa; la parte de la página de la
// que se habla queda iluminada.
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
if (__DEV__) (globalThis as any).__startTutorial = (step = 0) => setState({ step });

// Las pantallas marcan las zonas que el tutorial señala con estos identificadores
// (nativeID): `tutorialZone(x)` en la zona entera y `tutorialTitle(x)` en su título.
export const tutorialZone = (id: string) => `tut-${id}`;
export const tutorialTitle = (id: string) => `tut-title-${id}`;

// ── Pasos, en orden ──────────────────────────────────────────────────────────
// Cada paso es un cuadro de texto (el texto va en trozos para poder poner alguno en cursiva).
//   · target: zona de la página que se ilumina; el cuadro sale junto a su título.
//     Sin target, el cuadro va en el centro de la pantalla.
//   · sameBox: no se abre un cuadro nuevo; solo cambia el texto del que ya está.
type Piece = { t: string; italic?: boolean };
//   · action: el target es un botón que hay que pulsar. Se rodea con un círculo y el
//     tutorial no sigue hasta que se pulsa (el botón hace lo suyo de verdad).
type Step = { pieces: Piece[]; target?: string; sameBox?: boolean; action?: boolean };
const STEPS: Step[] = [
  {
    pieces: [
      { t: 'Bienvenid@ al tutorial de Immersa. En este pequeño recorrido aprenderás las nociones básicas de la creación de ' },
      { t: 'Novela Moderna', italic: true },
      { t: '.' },
    ],
  },
  { sameBox: true, pieces: [{ t: 'Si quieres cerrar el tutorial, puedes hacerlo pulsando la tecla Escape en cualquier momento.' }] },
  { target: 'moderno',     pieces: [{ t: 'Aquí podrás encontrar las Novelas Modernas.' }] },
  { target: 'webnovel',    pieces: [{ t: 'Aquí podrás encontrar los Webnovels.' }] },
  { target: 'modernoNew',  pieces: [{ t: 'Aquí podrás encontrar las últimas Novelas Modernas publicadas.' }] },
  { target: 'webnovelNew', pieces: [{ t: 'Aquí podrás encontrar los últimos Webnovels publicados.' }] },
  { target: 'popular',     pieces: [{ t: 'Aquí encontrarás las novelas más populares, independientemente de su estilo.' }] },
  { target: 'write', action: true, pieces: [{ t: 'Aquí podrás crear las novelas. Selecciónalo, por favor.' }] },
];
// Los pasos encadenados con sameBox comparten cuadro: este es el primero de su cadena
const groupOf = (i: number) => { let g = i; while (g > 0 && STEPS[g].sameBox) g--; return g; };

// ── Ritmo ────────────────────────────────────────────────────────────────────
const ARRIVE_MS = 900;    // se llega a la pantalla y, un momento después, se oscurece
const DIM_MS = 450;
const OPEN_MS = 420;      // el cuadro se abre desde el centro, hacia arriba y hacia abajo
const CLOSE_MS = 300;     // y se cierra igual, al revés
const SCROLL_MS = 650;    // lo que se espera a que la página se desplace hasta la zona
const SWEEP_MS = 550;     // la luz recorre la zona de izquierda a derecha
const AFTER_SWEEP_MS = 280;
const LETTER_MS = 22;
const RING_MS = 650;      // el círculo alrededor de un botón se dibuja (y se desdibuja)
const RING_WIDTH = 4;
const RING_GAP = 9;       // aire entre el botón y el círculo

const BOX_MAX_WIDTH = 440;
// Alrededor del cuadro del centro queda una franja sin oscurecer: se ve la página con su
// luz normal, y la oscuridad empieza poco a poco a partir de ahí.
const GLOW = 16;
const GLOW_FADE = 22;     // cuánto tarda la oscuridad en llegar a su tope, hacia fuera
const DIM = 'rgba(0,0,0,0.74)';
// La zona iluminada deja un pequeño margen con los bordes de la pantalla y de la zona
const ZONE_MARGIN = 10;
const ZONE_PAD = 8;

const WEB = Platform.OS === 'web';
const NATIVE_DRIVER = !WEB;

// Tipografía del tutorial. En la web se pide a Google Fonts; en la app, la del sistema.
const FONT = WEB ? 'Outfit, "Segoe UI", system-ui, sans-serif' : undefined;
let fontRequested = false;
function ensureFont() {
  if (!WEB || fontRequested) return;
  fontRequested = true;
  const doc = (globalThis as any).document;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500&display=swap';
  doc.head.appendChild(link);
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const run = (value: Animated.Value, toValue: number, duration: number, native = false) =>
  new Promise<void>(resolve => {
    Animated.timing(value, { toValue, duration, easing: Easing.out(Easing.cubic), useNativeDriver: native && NATIVE_DRIVER })
      .start(() => resolve());
  });

// Dónde van la luz y el cuadro cuando el paso señala una zona de la página
type Placement = {
  light: { x: number; y: number; w: number; h: number };
  // Botón que hay que pulsar: la luz es un círculo a su alrededor
  circle?: { cx: number; cy: number; r: number };
  // El cuadro va en la línea del título, a su derecha (centerY). Si ahí no cabe (pantallas
  // estrechas), va justo encima de la zona, a todo lo ancho (bottomY). Con un botón, va
  // debajo o encima de él (top / bottomY), pegado a su mismo lado de la pantalla.
  box: { left?: number; right?: number; maxWidth: number; centerY?: number; bottomY?: number; top?: number };
};

// El elemento de la página con ese identificador QUE SE ESTÁ VIENDO. Puede haber varios:
// si la pantalla de inicio está abierta dos veces (una, tapada por otra pantalla), la
// tapada sigue en la página pero sin tamaño, y no es la que hay que señalar.
function visibleElement(id: string): any {
  if (!WEB) return null;
  // (los botones de la barra de pestañas no admiten id: llevan el mismo nombre en data-testid)
  const all = [...(globalThis as any).document.querySelectorAll(`[id="${id}"], [data-testid="${id}"]`)];
  return all.find((el: any) => el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0) ?? null;
}

function measureTarget(target: string, winWidth: number, action?: boolean): Placement | null {
  const zone = visibleElement(tutorialZone(target))?.getBoundingClientRect();
  if (!zone) return null;
  if (action) {
    const winHeight = (globalThis as any).innerHeight as number;
    const cx = zone.left + zone.width / 2, cy = zone.top + zone.height / 2;
    // (un botón muy alargado, como los de la barra de pestañas, se rodea por su centro:
    // el círculo no puede ser tan grande como su lado largo)
    const short = Math.min(zone.width, zone.height);
    const r = Math.min(Math.max(zone.width, zone.height), short * 1.3) / 2 + RING_GAP;
    const light = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    const maxWidth = Math.min(360, winWidth - 24);
    const side = cx > winWidth / 2
      ? { right: Math.max(12, winWidth - (cx + r)) }
      : { left: Math.max(12, cx - r) };
    const vertical = cy > winHeight / 2 ? { bottomY: cy - r - 14 } : { top: cy + r + 14 };
    return { light, circle: { cx, cy, r }, box: { ...side, ...vertical, maxWidth } };
  }
  const x = Math.max(ZONE_MARGIN, zone.left + ZONE_MARGIN);
  const right = Math.min(winWidth - ZONE_MARGIN, zone.right - ZONE_MARGIN);
  const light = { x, y: zone.top - ZONE_PAD, w: right - x, h: zone.height + ZONE_PAD * 2 };
  // El cuadro va a lo largo, en la línea del título y a su derecha: así no tapa las
  // novelas de esa zona ni las de las zonas vecinas
  const title = visibleElement(tutorialTitle(target))?.getBoundingClientRect();
  if (title) {
    const left = title.right + 18;
    const room = right - left - 12;
    if (room >= 280) return { light, box: { left, maxWidth: Math.min(620, room), centerY: title.top + title.height / 2 } };
  }
  return { light, box: { left: x, maxWidth: light.w, bottomY: light.y - 8 } };
}

export function TutorialOverlay() {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  const step = current ? STEPS[current.step] : undefined;
  const pieces = step?.pieces;
  const total = pieces ? pieces.reduce((n, p) => n + p.t.length, 0) : 0;
  const win = useWindowDimensions();

  const dim = useRef(new Animated.Value(0)).current;     // oscuridad de la pantalla
  const open = useRef(new Animated.Value(0)).current;    // cuadro: 0 = cerrado, 1 = abierto
  const sweep = useRef(new Animated.Value(0)).current;   // luz de la zona: 0 = nada, 1 = entera
  const pulse = useRef(new Animated.Value(0)).current;   // parpadeo del icono de continuar
  const layer = useRef(new Animated.Value(1)).current;   // toda la capa (para desvanecerla al salir)
  const [shown, setShown] = useState(false);             // ya se llegó a la pantalla
  const [typed, setTyped] = useState(0);                 // letras escritas
  const [typing, setTyping] = useState(false);           // el cuadro está abierto y escribiendo (o ya escrito)
  const [boxHeight, setBoxHeight] = useState(0);         // altura del cuadro abierto
  const [place, setPlace] = useState<Placement | null>(null);
  const [ringOn, setRingOn] = useState(false);           // círculo dibujado
  const typingRef = useRef<any>(null);
  const busyRef = useRef(false);                         // en plena animación entre pasos
  const lastHeightRef = useRef(0);
  const done = typing && typed >= total;

  const active = !!step;
  useEffect(() => { if (active) ensureFont(); }, [active]);

  // Sonidos al avanzar: los mismos del lector (uno al pasar de texto, otro al pasar de cuadro)
  const sfxTextRef = useRef<Audio.Sound | null>(null);
  const sfxBoxRef = useRef<Audio.Sound | null>(null);
  useEffect(() => {
    if (!active) return;
    let gone = false;
    (async () => {
      try {
        const [{ sound: text }, { sound: box }] = await Promise.all([
          Audio.Sound.createAsync(require('@/assets/sounds/sfx_para.wav'), { volume: 0.55 }),
          Audio.Sound.createAsync(require('@/assets/sounds/sfx_page.wav'), { volume: 0.5 }),
        ]);
        if (gone) { text.unloadAsync().catch(() => {}); box.unloadAsync().catch(() => {}); return; }
        sfxTextRef.current = text; sfxBoxRef.current = box;
      } catch { /* sin sonido: el tutorial funciona igual */ }
    })();
    return () => {
      gone = true;
      sfxTextRef.current?.unloadAsync().catch(() => {});
      sfxBoxRef.current?.unloadAsync().catch(() => {});
      sfxTextRef.current = null; sfxBoxRef.current = null;
    };
  }, [active]);
  const play = (ref: { current: Audio.Sound | null }) => { ref.current?.replayAsync().catch(() => {}); };

  // Al empezar: esperar a que se vea la pantalla y oscurecerla
  useEffect(() => {
    if (!active) { setShown(false); setPlace(null); setRingOn(false); return; }
    dim.setValue(0); layer.setValue(1); open.setValue(0); sweep.setValue(0);
    const t = setTimeout(() => {
      setShown(true);
      run(dim, 1, DIM_MS, true);
    }, ARRIVE_MS);
    return () => clearTimeout(t);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Entrada de cada paso ───────────────────────────────────────────────────
  const stepIndex = current?.step;
  useEffect(() => {
    if (stepIndex === undefined || !shown) return;
    const s = STEPS[stepIndex];
    let cancelled = false;
    const startTyping = () => {
      if (cancelled) return;
      setTyping(true);
      typingRef.current = setInterval(() => setTyped(n => n + 1), LETTER_MS);
    };
    setTyped(0);
    (async () => {
      // Mismo cuadro: solo se escribe el texto nuevo
      if (s.sameBox) { startTyping(); return; }

      setTyping(false);
      setBoxHeight(0);
      if (s.target && WEB) {
        const el = visibleElement(tutorialZone(s.target));
        if (!el) {
          // Esa zona no está en la página (por ejemplo, aún no hay novelas populares): se salta
          if (stepIndex + 1 < STEPS.length) setState({ step: stepIndex + 1 }); else stopTutorial();
          return;
        }
        sweep.setValue(0);
        if (s.action) {
          // Un botón: se dibuja un círculo a su alrededor y su interior se ilumina
          setRingOn(false);
          setPlace(measureTarget(s.target, (globalThis as any).innerWidth, true));
          await wait(60);
          if (cancelled) return;
          setRingOn(true);
          await run(sweep, 1, RING_MS);
        } else {
          // La página se desplaza hasta dejar la zona a la vista
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await wait(SCROLL_MS);
          if (cancelled) return;
          setPlace(measureTarget(s.target, (globalThis as any).innerWidth));
          await wait(40);
          // La luz recorre la zona de izquierda a derecha y, poco después, sale el cuadro
          await run(sweep, 1, SWEEP_MS);
        }
        await wait(AFTER_SWEEP_MS);
      } else {
        setPlace(null);
        if (stepIndex === 0) await wait(DIM_MS - 100);
      }
      if (cancelled) return;
      await run(open, 1, OPEN_MS);
      startTyping();
    })();
    return () => { cancelled = true; clearInterval(typingRef.current); };
  }, [stepIndex, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si cambia el tamaño de la ventana, la luz y el cuadro se recolocan
  useEffect(() => {
    if (!WEB || !step?.target || !place) return;
    setPlace(measureTarget(step.target, win.width, step.action));
  }, [win.width, win.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // Texto completo: se deja de escribir y aparece, parpadeando, el icono de continuar
  // (el mismo ↵ que marca en el lector que se puede pasar al párrafo siguiente)
  useEffect(() => {
    if (!done) return;
    clearInterval(typingRef.current);
    pulse.setValue(1);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.15, duration: 550, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: NATIVE_DRIVER }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // Final (o salida con Escape): todo se desvanece antes de quitarse
  const close = () => { run(layer, 0, 300, true).then(stopTutorial); };

  // Avanzar, como en el lector: si el texto aún se está escribiendo, lo completa; si ya
  // está entero, pasa al cuadro siguiente (o termina).
  const advance = async () => {
    if (!current || !shown || !typing || busyRef.current) return;
    if (!done) { play(sfxTextRef); setTyped(total); return; }
    if (step?.action) return; // aquí no se avanza tocando: hay que pulsar el botón señalado
    const next = current.step + 1;
    if (next < STEPS.length && STEPS[next].sameBox) { play(sfxTextRef); setState({ step: next }); return; }
    play(sfxBoxRef);
    // El cuadro se cierra como se abrió, al revés, y la luz de la zona se retira
    busyRef.current = true;
    await run(open, 0, CLOSE_MS);
    if (place) await run(sweep, 0, CLOSE_MS);
    busyRef.current = false;
    if (state?.step !== current.step) return; // se salió entretanto
    if (next < STEPS.length) setState({ step: next });
    else close();
  };
  // ── Paso con botón: se espera a que se pulse de verdad ─────────────────────
  // El botón hace lo suyo (navegar, abrir…); aquí solo se retira el círculo, se cierra
  // el cuadro y se sigue. La pantalla se queda a oscuras.
  const actionTarget = step?.action && place?.circle ? step.target : undefined;
  useEffect(() => {
    if (!WEB || !actionTarget || stepIndex === undefined) return;
    const doc = (globalThis as any).document;
    const onClick = async (e: any) => {
      const el = visibleElement(tutorialZone(actionTarget));
      if (!el || !el.contains(e.target) || busyRef.current) return;
      busyRef.current = true;
      play(sfxBoxRef);
      clearInterval(typingRef.current);
      setRingOn(false);                       // el círculo se desdibuja
      await Promise.all([run(open, 0, CLOSE_MS), run(sweep, 0, RING_MS)]);
      busyRef.current = false;
      if (state?.step !== stepIndex) return;
      if (stepIndex + 1 < STEPS.length) setState({ step: stepIndex + 1 });
      else { await wait(900); closeRef.current(); } // (aún no hay más pasos: se queda un momento a oscuras y termina)
    };
    doc.addEventListener('click', onClick, true);
    return () => doc.removeEventListener('click', onClick, true);
  }, [actionTarget, stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active || !WEB) return;
    const w = globalThis as any;
    const onKey = (e: any) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advanceRef.current(); }
      else if (e.key === 'Escape') closeRef.current();
    };
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener('keydown', onKey);
  }, [active]);

  if (!current || !step || !pieces || !shown) return null;

  // Los trozos del texto hasta la letra `count`
  const renderPieces = (count: number) => {
    let left = count;
    return pieces.map((p, i) => {
      const part = p.t.slice(0, Math.max(0, left));
      left -= p.t.length;
      return part ? <Text key={i} style={p.italic ? styles.italic : undefined}>{part}</Text> : null;
    });
  };

  const compact = !!place; // junto a un título: cuadro bajo y alargado
  const boxWidth = Math.min(BOX_MAX_WIDTH, win.width - 32);
  // El cuadro se abre desde el centro hacia arriba y hacia abajo: una ventana que crece
  // sobre un contenido de altura fija
  const box = (
    <Animated.View
      style={{
        justifyContent: 'center', overflow: 'hidden', borderRadius: TEXT_BOX.radius,
        height: boxHeight ? open.interpolate({ inputRange: [0, 1], outputRange: [0, boxHeight] }) : undefined,
        opacity: boxHeight ? 1 : 0,
      }}
    >
      <View
        key={groupOf(current.step)}
        style={[
          styles.box, compact ? styles.boxCompact : { width: boxWidth },
          // Al cambiar solo el texto, el cuadro no encoge
          step.sameBox ? { minHeight: lastHeightRef.current } : null,
        ]}
        onLayout={e => { lastHeightRef.current = e.nativeEvent.layout.height; setBoxHeight(e.nativeEvent.layout.height); }}
      >
        {/* El texto entero, invisible, reserva el sitio: el cuadro no crece al escribirse */}
        <View>
          <Text style={[styles.text, compact && styles.textCompact, { opacity: 0 }]}>{renderPieces(total)}</Text>
          <Text style={[styles.text, compact && styles.textCompact, StyleSheet.absoluteFill]}>{renderPieces(typed)}</Text>
        </View>
        {done && !step.action && (
          <Animated.View style={[compact ? styles.hintCompact : styles.hint, { opacity: pulse }]}>
            <MaterialIcons name="keyboard-return" size={16} color={Colors.emerald} />
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );

  // Paso con botón: la capa deja un hueco justo sobre el botón para que se pueda pulsar;
  // el resto sigue tapado (tocar fuera solo completa el texto).
  if (place?.circle) {
    const { cx, cy, r } = place.circle;
    const hole = { left: cx - r, top: cy - r, right: cx + r, bottom: cy + r };
    const blocker = (style: any) => (
      <TouchableOpacity
        activeOpacity={1} onPress={advance}
        style={[{ position: 'absolute' }, style, WEB ? ({ outlineStyle: 'none', cursor: 'default' } as any) : null]}
      />
    );
    const length = 2 * Math.PI * r;
    return (
      <Animated.View style={[styles.layer, { opacity: layer }]} pointerEvents="box-none">
        {!WEB && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DIM, opacity: dim }]} />}
        {blocker({ left: 0, right: 0, top: 0, height: Math.max(0, hole.top) })}
        {blocker({ left: 0, right: 0, top: hole.bottom, bottom: 0 })}
        {blocker({ left: 0, width: Math.max(0, hole.left), top: hole.top, height: r * 2 })}
        {blocker({ left: hole.right, right: 0, top: hole.top, height: r * 2 })}
        {/* Interior iluminado: crece desde el centro del botón. Su sombra es la oscuridad. */}
        <Animated.View
          pointerEvents="none"
          style={[{
            position: 'absolute', opacity: dim, borderRadius: r,
            left: sweep.interpolate({ inputRange: [0, 1], outputRange: [cx, cx - r] }),
            top: sweep.interpolate({ inputRange: [0, 1], outputRange: [cy, cy - r] }),
            width: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, r * 2] }),
            height: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, r * 2] }),
          }, ({ boxShadow: `0 0 10px 9999px ${DIM}` } as any)]}
        />
        {/* El círculo: un trazo que se dibuja dando la vuelta (y se desdibuja al revés) */}
        {WEB ? React.createElement('svg', {
          width: r * 2 + RING_WIDTH * 2, height: r * 2 + RING_WIDTH * 2,
          style: {
            position: 'absolute', left: cx - r - RING_WIDTH, top: cy - r - RING_WIDTH,
            pointerEvents: 'none', transform: 'rotate(-90deg)', overflow: 'visible',
          },
        }, React.createElement('circle', {
          cx: r + RING_WIDTH, cy: r + RING_WIDTH, r, fill: 'none',
          stroke: Colors.emerald, strokeWidth: RING_WIDTH, strokeLinecap: 'round',
          strokeDasharray: length, strokeDashoffset: ringOn ? 0 : length,
          style: { transition: `stroke-dashoffset ${RING_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`, filter: `drop-shadow(0 0 6px ${Colors.emerald}90)` },
        })) : (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: r,
              borderWidth: RING_WIDTH, borderColor: Colors.emerald, opacity: ringOn ? 1 : 0,
            }}
          />
        )}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', left: place.box.left, right: place.box.right, maxWidth: place.box.maxWidth,
            top: place.box.top !== undefined ? place.box.top : Math.max(8, (place.box.bottomY ?? 0) - boxHeight),
          }}
        >
          {box}
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.layer, { opacity: layer }]}>
      {/* App: oscuridad lisa. En la web la oscuridad la pinta la sombra de la zona iluminada. */}
      {!WEB && <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: DIM, opacity: dim }]} />}
      <TouchableOpacity
        style={[StyleSheet.absoluteFill, WEB ? ({ outlineStyle: 'none', cursor: 'default' } as any) : null]}
        activeOpacity={1}
        onPress={advance}
      >
        {place ? (
          <>
            {/* Zona de la página iluminada: un recuadro invisible cuya sombra enorme es la
                oscuridad de todo lo demás. Crece de izquierda a derecha. */}
            <Animated.View
              pointerEvents="none"
              style={[styles.zoneLight, {
                left: place.light.x, top: place.light.y, height: place.light.h, opacity: dim,
                width: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, place.light.w] }),
              }, ({ boxShadow: `0 0 ${GLOW_FADE}px 9999px ${DIM}` } as any)]}
            />
            <View
              style={{
                position: 'absolute', left: place.box.left, maxWidth: place.box.maxWidth,
                // Hasta saber cuánto mide el cuadro no se puede colocar del todo
                top: place.box.centerY !== undefined
                  // (si el texto ocupa dos líneas, el cuadro crece hacia arriba, no sobre las novelas)
                  ? Math.min(place.box.centerY - boxHeight / 2, place.box.centerY + 22 - boxHeight)
                  : Math.max(8, (place.box.bottomY ?? 0) - boxHeight),
              }}
            >
              {box}
            </View>
          </>
        ) : (
          <View style={styles.center}>
            <View style={{ width: boxWidth }}>
              {/* Franja iluminada alrededor del cuadro: aparece y desaparece con él */}
              {WEB && (
                <Animated.View
                  pointerEvents="none"
                  style={[styles.glow, {
                    opacity: dim,
                    left: open.interpolate({ inputRange: [0, 1], outputRange: [0, -GLOW] }),
                    right: open.interpolate({ inputRange: [0, 1], outputRange: [0, -GLOW] }),
                    top: open.interpolate({ inputRange: [0, 1], outputRange: [0, -GLOW] }),
                    bottom: open.interpolate({ inputRange: [0, 1], outputRange: [0, -GLOW] }),
                  }, ({ boxShadow: `0 0 ${GLOW_FADE}px 9999px ${DIM}` } as any)]}
                />
              )}
              {box}
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 900, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  glow: {
    position: 'absolute', borderRadius: TEXT_BOX.radius + GLOW,
    // Un velo muy leve de luz: así la franja se nota también donde la página es negra
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  zoneLight: { position: 'absolute', borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)' },
  // Como el cuadro de texto del lector Moderno: oscuro y algo transparente
  box: {
    backgroundColor: 'rgba(22,24,30,0.82)', borderRadius: TEXT_BOX.radius,
    paddingHorizontal: 26, paddingTop: 22, paddingBottom: 26,
  },
  boxCompact: { paddingLeft: 18, paddingRight: 44, paddingTop: 9, paddingBottom: 9, backgroundColor: 'rgba(22,24,30,0.92)' },
  text: { fontFamily: FONT, fontSize: 16, lineHeight: 25, letterSpacing: 0.2, color: Colors.textPrimary },
  textCompact: { fontSize: 14.5, lineHeight: 21 },
  italic: { fontStyle: 'italic' },
  // Icono de continuar, en la esquina del cuadro como en el lector
  hint: { position: 'absolute', bottom: 10, right: 14 },
  hintCompact: { position: 'absolute', right: 14, top: '50%', marginTop: -8 },
});
