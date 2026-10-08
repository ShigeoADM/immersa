import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Audio } from 'expo-av';
import { Colors } from '@/constants/theme';
import { TEXT_BOX } from '@/constants/reader-layout';
import { router } from 'expo-router';
import { deleteStoryWithCascade } from '@/services/stories';

// Tutorial de Immersa: un recorrido guiado, como el de un juego. La pantalla se oscurece
// y van apareciendo cuadros de texto que explican cada cosa; la parte de la página de la
// que se habla queda iluminada.
//
// EN PRUEBAS: por ahora solo se puede abrir desde la sección Desarrollo (app/dev.tsx).
//
// El estado vive fuera de React para poder arrancarlo desde cualquier pantalla y que la
// capa (montada una sola vez, en la raíz) lo siga aunque se cambie de pantalla.

// nag: en un paso libre, se está enseñando el aviso de "termina esto antes de salir"
type TutorialState = { step: number; nag?: boolean } | null;

let state: TutorialState = null;
const listeners = new Set<() => void>();
const setState = (next: TutorialState) => { state = next; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// La historia de práctica que se crea durante el tutorial (para poder borrarla al final)
let practiceStoryId: string | null = null;

export const startTutorial = () => { practiceStoryId = null; setState({ step: 0 }); };
export const stopTutorial = () => setState(null);
// Solo en el servidor local de desarrollo: poder arrancarlo desde la consola del navegador
if (__DEV__) (globalThis as any).__startTutorial = (step = 0) => setState({ step });

// ── Lo que las pantallas le cuentan al tutorial ─────────────────────────────
// Hay pasos "libres": el tutorial se aparta y deja hacer algo (rellenar un formulario,
// por ejemplo) hasta que la pantalla avisa de que ya está hecho.

// La pantalla avisa de que ha pasado algo ('storyCreated'…). Si el paso libre actual
// esperaba justo eso, el tutorial sigue.
export function tutorialEvent(name: string, data?: { storyId?: string }) {
  if (!state) return;
  if (data?.storyId) practiceStoryId = data.storyId;
  const step = STEPS[state.step];
  if (!step?.free || step.until !== name) return;
  if (state.step + 1 < STEPS.length) setState({ step: state.step + 1 });
  else stopTutorial();
}

// La pantalla pregunta antes de dejar salir (flecha de volver). En un paso libre el
// tutorial no deja: devuelve true y enseña su aviso.
export function tutorialIntercept(): boolean {
  if (!state || !STEPS[state.step]?.free) return false;
  if (!state.nag) setState({ step: state.step, nag: true });
  return true;
}

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
//   · arrives: el target está en una pantalla a la que se acaba de llegar; se le da un
//     momento para aparecer antes de darlo por ausente.
//   · unless: si esa otra zona está a la vista, el paso no procede y se salta sin esperar
//     (por ejemplo: quien no tiene libros no ve "Mis libros", ve ya los formatos).
//   · free: paso libre. No hay cuadro ni oscuridad: se deja usar la pantalla hasta que
//     esta avise con tutorialEvent(until). Si se intenta salir antes, sale el aviso `nag`.
//   · boxAt: en zonas sin título, dónde va el cuadro: encima, debajo o al lado de la zona.
//   · shape 'rect': el botón que hay que pulsar es grande (una tarjeta): se ilumina su
//     rectángulo en vez de rodearlo con un círculo.
//   · morph: la luz no se apaga y se vuelve a encender; se encoge desde la zona anterior.
type Step = {
  pieces: Piece[]; target?: string; sameBox?: boolean; action?: boolean; arrives?: boolean; unless?: string;
  boxAt?: 'above' | 'below' | 'side'; shape?: 'rect'; morph?: boolean;
  free?: boolean; until?: string; nag?: Piece[];
  // Último cuadro: en vez de continuar, se elige entre quedarse la historia de práctica o borrarla
  choice?: boolean;
};
const T = (t: string): Piece[] => [{ t }];
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
  {
    target: 'myBooks', arrives: true, unless: 'formats',
    pieces: [{ t: 'Aquí están todas tus novelas.' }],
  },
  { target: 'newBook', action: true, unless: 'formats', pieces: [{ t: 'Aquí podrás crear un nuevo libro.' }] },
  {
    target: 'import', arrives: true, boxAt: 'below',
    pieces: [{ t: 'Aquí podrás importar las novelas que hayas exportado. Sirve para tener una copia de seguridad de tu historia fuera de la web.' }],
  },
  {
    target: 'formats', boxAt: 'above',
    pieces: [
      { t: 'Aquí puedes crear novelas con dos formatos diferentes:\n\n' },
      { t: 'Webnovel', italic: true },
      { t: ', el estilo clásico de las novelas web, con scroll continuo.\n\nY ' },
      { t: 'Novela Moderna', italic: true },
      { t: ', más parecida a una novela visual, en la que se centrará este tutorial.' },
    ],
  },
  {
    target: 'formatModerno', action: true, shape: 'rect', morph: true,
    pieces: [{ t: 'Crea una nueva historia, por favor. Puede ir en serio o no: luego decidirás si borras esta prueba o la aprovechas.' }],
  },
  // ── Ficha de la novela ──
  {
    arrives: true,
    pieces: [{ t: 'Aquí podrás crear la ficha de tu novela: título, géneros, sinopsis, etc. Asegúrate de rellenarla correctamente.' }],
  },
  {
    target: 'adult', boxAt: 'above',
    pieces: [{
      t: 'Marca esta casilla si tu novela tiene contenido para adultos: sexo explícito, gore, agresiones sexuales o violencia extrema.\n\n'
        + 'Eso vale para el texto. Las imágenes no pueden mostrar desnudos, actos sexuales ni violencia real, ni siquiera con la casilla marcada. '
        + 'La violencia en ilustraciones que son claramente ficción sí está permitida.',
    }],
  },
  {
    free: true, until: 'storyCreated', pieces: [],
    nag: [{ t: 'Rellena lo básico de la ficha, por favor. No tiene por qué ir en serio: esto es solo una prueba. Si quieres salir del tutorial, pulsa la tecla Escape.' }],
  },

  // ── Pantalla de la historia (lista de capítulos) ──
  { arrives: true, pieces: T('¡Historia creada! Esta es su pantalla principal: desde aquí gestionas sus capítulos.') },
  {
    target: 'storyTools', boxAt: 'below',
    pieces: T('Aquí arriba están las herramientas de la historia: sus archivos (imágenes y audios), exportar una copia de seguridad, editar la ficha, borrarla y publicarla.'),
  },
  {
    target: 'addChapter', action: true, shape: 'rect',
    pieces: T('Una novela se divide en capítulos. Crea el primero y ponle el título que quieras.'),
  },
  {
    free: true, until: 'chapterCreated', pieces: [],
    nag: T('Crea un capítulo para seguir, por favor. Si quieres salir del tutorial, pulsa la tecla Escape.'),
  },

  // ── Pantalla del capítulo (lista de páginas) ──
  { arrives: true, pieces: T('Este es tu capítulo. Se compone de páginas: cada página es una escena, con su texto, su fondo y su música.') },
  {
    target: 'chapterCover', boxAt: 'below',
    pieces: T('Aquí puedes ponerle una ilustración al capítulo. Sale en la ficha de la novela y, si quieres, a pantalla completa al empezar el capítulo.'),
  },
  { target: 'addPage', action: true, shape: 'rect', pieces: T('Vamos a ver cómo es una página. Añade la primera.') },

  // ── Editor de páginas: solo se explica, no hay que rellenar nada ──
  { arrives: true, pieces: T('Este es el editor de páginas. No hace falta que rellenes nada ahora: te enseño para qué sirve cada cosa.') },
  {
    target: 'pePreview', arrives: true, boxAt: 'below',
    pieces: T('Esta es la vista previa: así verá la página el lector. El texto se escribe directamente en el cuadro. Cada línea en blanco separa un párrafo, y el lector los va pasando de uno en uno. El cuadro se puede mover y cambiar de tamaño arrastrándolo.'),
  },
  { target: 'peType', boxAt: 'side', pieces: T('Tipo de página: con texto, o solo ilustración, que enseña una imagen a pantalla completa sin cuadro de texto.') },
  { target: 'peTextBox', boxAt: 'side', pieces: T('La forma y la posición del cuadro de texto se pueden copiar de una página y pegar en otra.') },
  { target: 'peTransition', boxAt: 'side', pieces: T('La animación con la que se pasa de esta página a la siguiente: fundido, barridos, cuadrados…') },
  { target: 'peTextSize', boxAt: 'side', pieces: T('El tamaño del texto. Si no lo cambias, la página usa el mismo que la anterior.') },
  { target: 'peBackground', boxAt: 'side', pieces: T('La imagen de fondo. Una página sin imagen propia sigue con la de la página anterior; también puedes dejar el fondo en negro.') },
  { target: 'peMusic', boxAt: 'side', pieces: T('La música. Sigue sonando en las páginas siguientes hasta que otra la cambie o la silencie. Puedes elegir su volumen y en qué párrafo empieza.') },
  { target: 'peQuiet', boxAt: 'side', pieces: T('Silencio momentáneo: calla la música durante algunos párrafos y después vuelve sola.') },
  { target: 'peSfx', boxAt: 'side', pieces: T('Efectos de sonido: suenan una vez, al aparecer el párrafo que elijas. Puedes poner varios.') },
  { target: 'peExtra', boxAt: 'side', pieces: T('Cuadros de texto extra: carteles, pensamientos o notas que colocas donde quieras, con su giro y su animación.') },
  { target: 'peCharacters', boxAt: 'side', pieces: T('Personajes: las etiquetas con el nombre de quién habla en esta página.') },
  { target: 'peLinks', boxAt: 'side', pieces: T('Palabras enlazadas: una palabra del texto puede llevar a otra página. Sirve para que el lector elija.') },
  { target: 'peNext', boxAt: 'side', pieces: T('Al pasar la página se va a la siguiente, pero puedes mandarla a cualquier otra para crear caminos distintos.') },
  { target: 'peSave', boxAt: 'below', pieces: T('Cuando termines una página, guárdala aquí. Una vez guardada, el botón de reproducir te deja probarla en el lector.') },
  { choice: true, pieces: T('Eso sería todo. ¿Vas a querer continuar con esta historia o vas a borrarla?') },
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
const RING_MAX = 64;      // radio máximo del círculo
const ARRIVE_WAIT_MS = 2500; // lo que se espera a que aparezca una zona al llegar a una pantalla
const SETTLE_MS = 450;    // y a que termine su animación de entrada antes de medirla
const MORPH_MS = 520;     // la luz se encoge de una zona a otra más pequeña

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
  // Parte de la pantalla que se deja libre para pulsar el botón (el botón, dentro del círculo)
  hole?: { left: number; top: number; right: number; bottom: number };
  // La luz viene encogiéndose desde este otro rectángulo (la zona anterior)
  from?: { x: number; y: number; w: number; h: number };
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

function measureTarget(step: Step, winWidth: number): Placement | null {
  const target = step.target as string;
  const zone = visibleElement(tutorialZone(target))?.getBoundingClientRect();
  if (!zone) return null;
  if (step.action && step.shape === 'rect') {
    // Una tarjeta entera: se ilumina su rectángulo y solo ella se puede pulsar
    const light = { x: zone.left - 6, y: zone.top - 6, w: zone.width + 12, h: zone.height + 12 };
    const hole = { left: zone.left, top: zone.top, right: zone.right, bottom: zone.bottom };
    const maxWidth = Math.min(520, light.w);
    const vertical = light.y > 150 ? { bottomY: light.y - 12 } : { top: light.y + light.h + 12 };
    return { light, hole, box: { left: light.x, maxWidth, ...vertical } };
  }
  if (step.action) {
    const winHeight = (globalThis as any).innerHeight as number;
    const cx = zone.left + zone.width / 2, cy = zone.top + zone.height / 2;
    // El círculo rodea lo que el botón enseña (su icono o su texto), no todo su tamaño:
    // una pestaña puede ser mucho más ancha que su rótulo.
    const short = Math.min(zone.width, zone.height);
    let content = zone;
    try {
      const range = (globalThis as any).document.createRange();
      range.selectNodeContents(visibleElement(tutorialZone(target)));
      const c = range.getBoundingClientRect();
      if (c.width > 0) content = c;
    } catch { /* se usa el tamaño del botón */ }
    const focusW = Math.min(zone.width, Math.max(content.width, short));
    const focusH = Math.min(zone.height, Math.max(content.height, short));
    const r = Math.min(RING_MAX, Math.max(focusW, focusH) / 2 + RING_GAP);
    const light = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    // Solo se puede pulsar el botón: del círculo, la parte que cae sobre él
    const hole = {
      left: Math.max(cx - r, zone.left), top: Math.max(cy - r, zone.top),
      right: Math.min(cx + r, zone.right), bottom: Math.min(cy + r, zone.bottom),
    };
    const maxWidth = Math.min(360, winWidth - 24);
    const side = cx > winWidth / 2
      ? { right: Math.max(12, winWidth - (cx + r)) }
      : { left: Math.max(12, cx - r) };
    const vertical = cy > winHeight / 2 ? { bottomY: cy - r - 14 } : { top: cy + r + 14 };
    return { light, circle: { cx, cy, r }, hole, box: { ...side, ...vertical, maxWidth } };
  }
  // Una zona que va de lado a lado deja un pequeño margen con los bordes de la pantalla;
  // una más pequeña (un grupo de botones, una columna) se ilumina con algo de aire alrededor
  const wide = zone.width > winWidth * 0.8;
  const x = wide ? Math.max(ZONE_MARGIN, zone.left + ZONE_MARGIN) : Math.max(4, zone.left - ZONE_PAD);
  const right = wide ? Math.min(winWidth - ZONE_MARGIN, zone.right - ZONE_MARGIN) : Math.min(winWidth - 4, zone.right + ZONE_PAD);
  const light = { x, y: zone.top - ZONE_PAD, w: right - x, h: zone.height + ZONE_PAD * 2 };
  if (step.boxAt === 'side') {
    // A la derecha de la zona (en escritorio las opciones van en una columna a la izquierda)
    const left = light.x + light.w + 18;
    const room = winWidth - left - 16;
    const winHeight = (globalThis as any).innerHeight as number;
    if (room >= 280) {
      const centerY = Math.min(winHeight - 90, Math.max(110, light.y + Math.min(light.h / 2, 110)));
      return { light, box: { left, maxWidth: Math.min(440, room), centerY } };
    }
  }
  if (step.boxAt) {
    const maxWidth = Math.min(560, light.w);
    const left = light.x + Math.max(0, (light.w - maxWidth) / 2);
    return {
      light,
      box: step.boxAt === 'below' ? { left, maxWidth, top: light.y + light.h + 12 } : { left, maxWidth, bottomY: light.y - 12 },
    };
  }
  // El cuadro va a lo largo, en la línea del título y a su derecha: así no tapa las
  // novelas de esa zona ni las de las zonas vecinas
  const title = visibleElement(tutorialTitle(target))?.getBoundingClientRect();
  if (title) {
    const left = title.right + 18;
    const room = right - left - 12;
    if (room >= 280) return { light, box: { left, maxWidth: Math.min(620, room), centerY: title.top + title.height / 2 } };
  } else if (light.w >= 600) {
    // Zona sin título (una lista, por ejemplo): el cuadro va dentro, a un lado
    return {
      light,
      box: { left: light.x + light.w * 0.5, maxWidth: Math.min(440, light.w * 0.5 - 24), centerY: light.y + Math.min(light.h / 2, 150) },
    };
  } else {
    return { light, box: { left: light.x + 12, maxWidth: light.w - 24, centerY: light.y + light.h * 0.6 } };
  }
  return { light, box: { left: x, maxWidth: light.w, bottomY: light.y - 8 } };
}

export function TutorialOverlay() {
  const current = useSyncExternalStore(subscribe, () => state, () => state);
  const step = current ? STEPS[current.step] : undefined;
  const nagging = !!step?.free && !!current?.nag;
  const pieces = step?.free ? (nagging ? step.nag : []) : step?.pieces;
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
  const [idle, setIdle] = useState(false);               // paso libre: el tutorial está apartado
  const idleRef = useRef(false);
  idleRef.current = idle;
  // Tras un paso libre la pantalla quedó clara: el siguiente paso tiene que oscurecerla
  const dimmedRef = useRef(true);
  if (idle) dimmedRef.current = false;
  const [place, setPlace] = useState<Placement | null>(null);
  const [ringOn, setRingOn] = useState(false);           // círculo dibujado
  const morph = useRef(new Animated.Value(1)).current;   // luz encogiéndose de una zona a otra
  const placeRef = useRef<Placement | null>(null);
  placeRef.current = place;
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
      // Paso libre: la pantalla se aclara y el tutorial se aparta; o, si se intentó salir,
      // se oscurece otra vez y sale el aviso
      if (s.free) {
        setPlace(null);
        setBoxHeight(0);
        if (!state?.nag) {
          setTyping(false);
          open.setValue(0);
          await run(dim, 0, DIM_MS, true);
          if (!cancelled) setIdle(true);
          return;
        }
        setIdle(false);
        setTyping(false);
        await run(dim, 1, DIM_MS, true);
        if (cancelled) return;
        await run(open, 1, OPEN_MS);
        startTyping();
        return;
      }
      setIdle(false);
      if (dimmedRef.current === false) { run(dim, 1, DIM_MS, true); }
      dimmedRef.current = true;

      // Mismo cuadro: solo se escribe el texto nuevo
      if (s.sameBox) { startTyping(); return; }

      setTyping(false);
      setBoxHeight(0);
      if (s.target && WEB) {
        const skips = () => !!s.unless && !!visibleElement(tutorialZone(s.unless));
        let el = skips() ? null : visibleElement(tutorialZone(s.target));
        // Recién llegados a la pantalla: puede tardar un momento en pintarse
        for (let waited = 0; !el && s.arrives && !skips() && waited < ARRIVE_WAIT_MS && !cancelled; waited += 100) {
          await wait(100);
          el = skips() ? null : visibleElement(tutorialZone(s.target));
        }
        if (cancelled) return;
        if (!el) {
          // Esa zona no está en la página (por ejemplo, aún no hay novelas populares): se salta
          if (stepIndex + 1 < STEPS.length) setState({ step: stepIndex + 1 }); else closeRef.current();
          return;
        }
        if (s.arrives) { await wait(SETTLE_MS); if (cancelled) return; }
        const winWidth = (globalThis as any).innerWidth as number;
        const previous = s.morph ? placeRef.current?.light : undefined;
        if (previous) {
          // La zona iluminada se encoge hasta quedarse solo con lo que ahora se señala
          const next = measureTarget(s, winWidth);
          morph.setValue(0);
          setPlace(next ? { ...next, from: previous } : null);
          await wait(40);
          if (cancelled) return;
          await run(morph, 1, MORPH_MS);
        } else if (s.action && s.shape === 'rect') {
          sweep.setValue(0);
          setPlace(measureTarget(s, winWidth));
          await wait(40);
          await run(sweep, 1, SWEEP_MS);
        } else if (s.action) {
          sweep.setValue(0);
          // Un botón: se dibuja un círculo a su alrededor y su interior se ilumina
          setRingOn(false);
          setPlace(measureTarget(s, winWidth));
          await wait(60);
          if (cancelled) return;
          setRingOn(true);
          await run(sweep, 1, RING_MS);
        } else {
          // La página se desplaza hasta dejar la zona a la vista
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await wait(SCROLL_MS);
          if (cancelled) return;
          sweep.setValue(0);
          setPlace(measureTarget(s, (globalThis as any).innerWidth));
          await wait(40);
          // La luz recorre la zona de izquierda a derecha y, poco después, sale el cuadro
          await run(sweep, 1, SWEEP_MS);
        }
        await wait(AFTER_SWEEP_MS);
      } else {
        setPlace(null);
        if (stepIndex === 0) await wait(DIM_MS - 100);
        // Cuadro en el centro de una pantalla a la que se acaba de llegar: se le da tiempo a abrirse
        else if (s.arrives) await wait(SETTLE_MS + 250);
      }
      if (cancelled) return;
      await run(open, 1, OPEN_MS);
      startTyping();
    })();
    return () => { cancelled = true; clearInterval(typingRef.current); };
  }, [stepIndex, shown, nagging]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si cambia el tamaño de la ventana, la luz y el cuadro se recolocan
  useEffect(() => {
    if (!WEB || !step?.target || !place) return;
    setPlace(measureTarget(step, win.width));
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
    if (step?.action || step?.choice) return; // aquí no se avanza tocando: hay que pulsar el botón
    if (step?.free) {
      // Aviso leído: el cuadro se cierra y se vuelve al formulario
      play(sfxBoxRef);
      busyRef.current = true;
      await run(open, 0, CLOSE_MS);
      busyRef.current = false;
      if (state?.step === current.step) setState({ step: current.step });
      return;
    }
    const next = current.step + 1;
    if (next < STEPS.length && STEPS[next].sameBox) { play(sfxTextRef); setState({ step: next }); return; }
    play(sfxBoxRef);
    // El cuadro se cierra como se abrió, al revés, y la luz de la zona se retira
    busyRef.current = true;
    await run(open, 0, CLOSE_MS);
    if (place && !(next < STEPS.length && STEPS[next].morph)) await run(sweep, 0, CLOSE_MS);
    busyRef.current = false;
    if (state?.step !== current.step) return; // se salió entretanto
    if (next < STEPS.length) setState({ step: next });
    else close();
  };
  // ── Paso con botón: se espera a que se pulse de verdad ─────────────────────
  // El botón hace lo suyo (navegar, abrir…); aquí solo se retira el círculo, se cierra
  // el cuadro y se sigue. La pantalla se queda a oscuras.
  const actionTarget = step?.action && place?.hole ? step.target : undefined;
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
      await run(open, 0, CLOSE_MS);
      await run(sweep, 0, RING_MS);
      morph.setValue(1);
      busyRef.current = false;
      if (state?.step !== stepIndex) return;
      if (stepIndex + 1 < STEPS.length) setState({ step: stepIndex + 1 });
      else { await wait(900); closeRef.current(); } // (aún no hay más pasos: se queda un momento a oscuras y termina)
    };
    doc.addEventListener('click', onClick, true);
    return () => doc.removeEventListener('click', onClick, true);
  }, [actionTarget, stepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Final: quedarse la historia de práctica o borrarla
  const [deleting, setDeleting] = useState(false);
  const keepStory = () => { play(sfxBoxRef); closeRef.current(); };
  const deleteStory = async () => {
    if (deleting) return;
    play(sfxBoxRef);
    setDeleting(true);
    try {
      if (practiceStoryId) await deleteStoryWithCascade(practiceStoryId);
      // Fuera de sus pantallas (ya no existen) y de vuelta a Escribir
      if (router.canDismiss()) router.dismissAll();
      router.replace('/(tabs)/write' as any);
    } catch (e) {
      console.error('Error borrando la historia de práctica:', e);
    } finally {
      setDeleting(false);
      practiceStoryId = null;
      closeRef.current();
    }
  };

  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active || !WEB) return;
    const w = globalThis as any;
    const onKey = (e: any) => {
      // Paso libre: el teclado es del formulario (solo Escape sigue cerrando el tutorial)
      if (idleRef.current) { if (e.key === 'Escape') stopTutorial(); return; }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); advanceRef.current(); }
      else if (e.key === 'Escape') closeRef.current();
    };
    w.addEventListener('keydown', onKey);
    return () => w.removeEventListener('keydown', onKey);
  }, [active]);

  if (!current || !step || !pieces || !shown || idle) return null;

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
        {step.choice && (
          // (siempre ocupan su sitio, para que el cuadro se abra ya con su altura final)
          <View style={[styles.choices, { opacity: done ? 1 : 0 }]} pointerEvents={done ? 'auto' : 'none'}>
            <TouchableOpacity style={styles.choiceDelete} onPress={deleteStory} disabled={deleting} activeOpacity={0.8}>
              <Text style={styles.choiceDeleteText}>{deleting ? 'Borrando…' : 'Borrarla'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.choiceKeep} onPress={keepStory} disabled={deleting} activeOpacity={0.85}>
              <Text style={styles.choiceKeepText}>Continuar con ella</Text>
            </TouchableOpacity>
          </View>
        )}
        {done && !step.action && !step.choice && (
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
    const hole = place.hole ?? { left: cx - r, top: cy - r, right: cx + r, bottom: cy + r };
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
        {blocker({ left: 0, width: Math.max(0, hole.left), top: hole.top, height: hole.bottom - hole.top })}
        {blocker({ left: hole.right, right: 0, top: hole.top, height: hole.bottom - hole.top })}
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

  const outside = WEB ? ({ outlineStyle: 'none', cursor: 'default' } as any) : null;
  // Zona de la página iluminada: un recuadro invisible cuya sombra enorme es la oscuridad
  // de todo lo demás. Crece de izquierda a derecha, o se encoge desde la zona anterior.
  const zone = place && (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.zoneLight, { opacity: dim }, place.from ? {
          left: morph.interpolate({ inputRange: [0, 1], outputRange: [place.from.x, place.light.x] }),
          top: morph.interpolate({ inputRange: [0, 1], outputRange: [place.from.y, place.light.y] }),
          width: Animated.multiply(sweep, morph.interpolate({ inputRange: [0, 1], outputRange: [place.from.w, place.light.w] })),
          height: morph.interpolate({ inputRange: [0, 1], outputRange: [place.from.h, place.light.h] }),
        } : {
          left: place.light.x, top: place.light.y, height: place.light.h,
          width: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, place.light.w] }),
        }, ({ boxShadow: `0 0 ${GLOW_FADE}px 9999px ${DIM}` } as any)]}
      />
      <View
        pointerEvents={place.hole ? 'none' : undefined}
        style={{
          position: 'absolute', left: place.box.left, right: place.box.right, maxWidth: place.box.maxWidth,
          // Hasta saber cuánto mide el cuadro no se puede colocar del todo
          top: place.box.centerY !== undefined
            // (si el texto ocupa dos líneas, el cuadro crece hacia arriba, no sobre las novelas)
            ? Math.min(place.box.centerY - boxHeight / 2, place.box.centerY + 22 - boxHeight)
            : place.box.top !== undefined
              ? Math.max(8, Math.min(place.box.top, win.height - boxHeight - 12))
              : Math.max(8, (place.box.bottomY ?? 0) - boxHeight),
        }}
      >
        {box}
      </View>
    </>
  );

  // Tarjeta que hay que pulsar: la capa deja libre justo su rectángulo
  if (place?.hole) {
    const hole = place.hole;
    const blocker = (style: any) => (
      <TouchableOpacity activeOpacity={1} onPress={advance} style={[{ position: 'absolute' }, style, outside]} />
    );
    return (
      <Animated.View style={[styles.layer, { opacity: layer }]} pointerEvents="box-none">
        {!WEB && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: DIM, opacity: dim }]} />}
        {blocker({ left: 0, right: 0, top: 0, height: Math.max(0, hole.top) })}
        {blocker({ left: 0, right: 0, top: hole.bottom, bottom: 0 })}
        {blocker({ left: 0, width: Math.max(0, hole.left), top: hole.top, height: hole.bottom - hole.top })}
        {blocker({ left: hole.right, right: 0, top: hole.top, height: hole.bottom - hole.top })}
        {zone}
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.layer, { opacity: layer }]}>
      {/* App: oscuridad lisa. En la web la oscuridad la pinta la sombra de la zona iluminada. */}
      {!WEB && <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: DIM, opacity: dim }]} />}
      <TouchableOpacity style={[StyleSheet.absoluteFill, outside]} activeOpacity={1} onPress={advance}>
        {place ? zone : (
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
  choices: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  choiceDelete: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#FF6B6B66' },
  choiceDeleteText: { fontFamily: FONT, fontSize: 14, color: '#FF6B6B' },
  choiceKeep: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, backgroundColor: Colors.emerald },
  choiceKeepText: { fontFamily: FONT, fontSize: 14, fontWeight: '600', color: '#000' },
  // Icono de continuar, en la esquina del cuadro como en el lector
  hint: { position: 'absolute', bottom: 10, right: 14 },
  hintCompact: { position: 'absolute', right: 14, top: '50%', marginTop: -8 },
});
