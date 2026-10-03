import React, {
  useEffect, useState, useRef, useCallback, useMemo, forwardRef, useImperativeHandle,
} from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  Modal,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  AppState,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { collection, getDocs, query, orderBy, doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db, auth } from '@/config/firebase';
import { Audio } from 'expo-av';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { AppAlert, AppDialogHost } from '@/components/app-dialog';
import { ReportModal } from '@/components/report-modal';
import type { ReportTarget } from '@/services/reports';
import { sortChapters } from '@/services/stories';
import { useAuth } from '@/context/AuthContext';
import {
  type StoryComment, COMMENT_MAX_LENGTH, addComment, deleteComment, listChapterComments,
} from '@/services/comments';
import { CommentItem } from '@/components/comment-item';
import { getStaffRoles } from '@/services/profiles';
import { enterReading, leaveReading } from '@/services/social';
import type { Role } from '@/constants/permissions';
import {
  FONT_SIZES, TEXT_BOX, CHAR_LABEL, BG_BLUR_DEFAULT, MUSIC_FADE_MS, musicPlaybackVolume, sfxPlaybackVolume,
  charLabelPos, charLabelSideStyle,
  type TextSize,
} from '@/constants/reader-layout';

// ─── Colores de acento del lector ────────────────────────────────────────────
const UI_ACCENT_KEY = 'immersa_ui_color';

export const UI_COLORS: { hex: string; label: string }[] = [
  { hex: '#00C878', label: 'Verde'    },
  { hex: '#4A90D9', label: 'Azul'     },
  { hex: '#9B59B6', label: 'Morado'   },
  { hex: '#FF69B4', label: 'Rosa'     },
  { hex: '#FF4444', label: 'Rojo'     },
  { hex: '#FF6B35', label: 'Naranja'  },
  { hex: '#FFD700', label: 'Amarillo' },
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function darkenHex(hex: string, factor = 0.5): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor));
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor));
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor));
  return `rgb(${r},${g},${b})`;
}

type ImageAnchor   = 'top' | 'center' | 'bottom';
type ImageFit      = 'cover' | 'contain';
type TextBoxLayout = { x: number; y: number; w: number; h: number };

// ─── Enlace de texto ──────────────────────────────────────────────────────────
export type PageLink = {
  word: string;
  color: string;
  targetPageId?: string;     // destino; los enlaces antiguos solo tienen targetPageIndex
  targetPageIndex: number;
  targetChapterId?: string;
  targetChapterTitle?: string;
};

const DEFAULT_TBL: TextBoxLayout = { x: 11, y: 23, w: 78, h: 53 };

interface Page {
  id: string;
  text: string;
  backgroundUrl: string;
  bgBlur?: number;            // desenfoque del fondo (undefined = BG_BLUR_DEFAULT)
  imageAnchor?: ImageAnchor;
  imageFit?: ImageFit;
  musicUrl?: string | null;
  musicVolume?: number;       // ajuste del autor para esta pista (1 = 100 %)
  textSize?: TextSize;
  textBoxLayout?: TextBoxLayout;
  links?: PageLink[];
  nextPageId?: string;              // "Al pasar la página" (por id)
  nextPageIndex?: number | null;    // formato antiguo (por número)
  sfxUrl?: string;                  // efecto de sonido al llegar a la página
  sfxVolume?: number;               // ajuste del autor para el efecto (1 = 100 %)
  order: number;
  // Nombres de personaje — undefined = heredar, '' = ocultar, string = mostrar
  leftChar?: string;
  rightChar?: string;
  leftCharPos?: { x: number; y: number };
  rightCharPos?: { x: number; y: number };
  // side: 0=libre, 1=arriba, 2=abajo, 3=izquierda, 4=derecha del bloque de texto
  leftCharSide?: number;
  rightCharSide?: number;
}

// ─── Parseo de segmentos (texto plano + enlaces) ──────────────────────────────
type Segment = { type: 'plain'; content: string } | { type: 'link'; content: string; link: PageLink };

function parseParagraphSegments(text: string, links: PageLink[]): Segment[] {
  if (!links.length) return [{ type: 'plain', content: text }];

  // Encuentra todas las ocurrencias de cada palabra enlazada
  const ranges: { start: number; end: number; link: PageLink }[] = [];
  for (const link of links) {
    if (!link.word.trim()) continue;
    let pos = 0;
    while (true) {
      const idx = text.indexOf(link.word, pos);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + link.word.length, link });
      pos = idx + link.word.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start);

  // Elimina solapamientos
  const clean: typeof ranges = [];
  let lastEnd = 0;
  for (const r of ranges) {
    if (r.start >= lastEnd) { clean.push(r); lastEnd = r.end; }
  }

  // Construye segmentos
  const segs: Segment[] = [];
  let cursor = 0;
  for (const r of clean) {
    if (cursor < r.start) segs.push({ type: 'plain', content: text.slice(cursor, r.start) });
    segs.push({ type: 'link', content: text.slice(r.start, r.end), link: r.link });
    cursor = r.end;
  }
  if (cursor < text.length) segs.push({ type: 'plain', content: text.slice(cursor) });
  return segs;
}

// ─── Texto con outline negro estilo retro gaming ──────────────────────────────
function OutlineText({ children, style }: { children: string; style?: any }) {
  const black = [style, { color: '#000', position: 'absolute' as const, width: '100%' }];
  return (
    <View style={{ width: '100%' }}>
      <Text style={[...black, { top: -2 }]}>{children}</Text>
      <Text style={[...black, { top:  2 }]}>{children}</Text>
      <Text style={[...black, { left: -2 }]}>{children}</Text>
      <Text style={[...black, { left:  2 }]}>{children}</Text>
      <Text style={[style, { width: '100%' }]}>{children}</Text>
    </View>
  );
}

// ─── Sparkle al tocar enlace ──────────────────────────────────────────────────
const SPARK_N = 12;

function SparkleOverlay({ x, y, color, onDone }: {
  x: number; y: number; color: string; onDone: () => void;
}) {
  const anims  = useRef(Array.from({ length: SPARK_N }, () => new Animated.Value(0))).current;
  const flash  = useRef(new Animated.Value(0)).current;

  // Configuración fija de partículas (no recalcular en cada render)
  const parts  = useRef(
    Array.from({ length: SPARK_N }, (_, i) => ({
      angle:   (i / SPARK_N) * Math.PI * 2 + 0.26,
      diamond: i % 3 !== 0,          // mayoría diamantes, algunos círculos
      size:    4 + (i % 4) * 2.5,
      dist:    22 + (i % 5) * 10,
    }))
  ).current;

  useEffect(() => {
    anims.forEach(a => a.setValue(0));
    flash.setValue(0);

    // Flash central (brillo rápido)
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 55,  useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 340, useNativeDriver: true }),
    ]).start();

    // Partículas en abanico escalonado
    Animated.parallel(
      anims.map((a, i) =>
        Animated.sequence([
          Animated.delay(i * 22),
          Animated.timing(a, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(a, { toValue: 2, duration: 230, useNativeDriver: true }),
        ])
      )
    ).start(() => onDone());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flashOpacity = flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.40] });
  const flashScale   = flash.interpolate({ inputRange: [0, 1], outputRange: [0.1, 1]  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Flash central */}
      <Animated.View style={{
        position: 'absolute',
        left: x - 36, top: y - 36,
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: color,
        opacity: flashOpacity,
        transform: [{ scale: flashScale }],
      }} />

      {/* Partículas */}
      {parts.map((p, i) => {
        const tx = anims[i].interpolate({
          inputRange: [0, 1, 2],
          outputRange: [0, Math.cos(p.angle) * p.dist, Math.cos(p.angle) * p.dist * 1.3],
        });
        const ty = anims[i].interpolate({
          inputRange: [0, 1, 2],
          outputRange: [0, Math.sin(p.angle) * p.dist, Math.sin(p.angle) * p.dist * 1.3],
        });
        const opacity = anims[i].interpolate({
          inputRange: [0, 0.15, 1, 2],
          outputRange: [0, 1, 1, 0],
        });
        const scale = anims[i].interpolate({
          inputRange: [0, 0.4, 1, 2],
          outputRange: [0, 1.5, 1, 0.2],
        });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: x - p.size / 2,
              top:  y - p.size / 2,
              width: p.size, height: p.size,
              backgroundColor: color,
              borderRadius: p.diamond ? 1 : p.size / 2,
              opacity,
              transform: [
                { translateX: tx },
                { translateY: ty },
                { rotate: p.diamond ? '45deg' : '0deg' },
                { scale },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

const RETRO_FONT = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// Lectores montados: al cambiar de capítulo se monta uno nuevo antes de desmontar el anterior
let mountedReaders = 0;

// Historial de navegación: de qué página se vino en cada salto (capítulo + página).
// "Atrás" deshace ese camino en vez de ir a la página anterior del capítulo: a una página
// se puede llegar de varias formas (enlaces, "saltar a", otro capítulo) y hay que volver
// por donde se vino. Va a nivel de módulo porque al cambiar de capítulo el lector se
// reemplaza por otra instancia; el parámetro hist=1 indica que el historial continúa.
type HistoryEntry = { chapterId: string; pageId: string };
let readerHistory: HistoryEntry[] = [];
const HISTORY_MAX = 300;
// El historial se guarda junto con la posición a la que corresponde, en dos sitios:
//   · en el móvil, en cada cambio de página (aguanta aunque la app se cierre de golpe);
//   · en la biblioteca del usuario en Firestore, con el progreso (al salir o pasar a
//     segundo plano), para poder seguir en otro dispositivo.
// Al volver a entrar en esa misma página se recupera, así "atrás" sigue deshaciendo el
// camino aunque se salga del lector, se cierre la app o se cambie de móvil.
const historyKey = (uid: string, storyId: string) => `immersa_reader_history:${uid}:${storyId}`;
type SavedHistory = { chapterId: string; pageId: string; history: HistoryEntry[] };

// Ajustes del lector (se guardan en el móvil, como el color de acento)
type TextSpeed = 'slow' | 'normal' | 'fast' | 'instant';
type TextScale = 'sm' | 'md' | 'lg';
const TEXT_SPEED_KEY = 'immersa_text_speed';
const TEXT_SCALE_KEY = 'immersa_text_scale';
// Caracteres por segundo (null = al instante)
const TEXT_SPEED_CPS: Record<TextSpeed, number | null> = { slow: 18, normal: 31, fast: 70, instant: null };
const TEXT_SCALE: Record<TextScale, number>    = { sm: 0.85, md: 1, lg: 1.2 };
const TEXT_SPEED_OPTIONS: { value: TextSpeed; label: string }[] = [
  { value: 'slow', label: 'Lenta' }, { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Rápida' }, { value: 'instant', label: 'Al instante' },
];
const TEXT_SCALE_OPTIONS: { value: TextScale; label: string }[] = [
  { value: 'sm', label: 'Pequeña' }, { value: 'md', label: 'Normal' }, { value: 'lg', label: 'Grande' },
];

// ─── Texto con efecto máquina de escribir ─────────────────────────────────────
// Va en un componente aparte para que escribir letra a letra solo vuelva a pintar el
// texto. Antes cada letra re-renderizaba la pantalla entera del lector ~30 veces por
// segundo (con 5–9 capas de texto por el contorno), y eso era lo que daba tirones.
type TypewriterHandle = {
  /** Si está escribiendo, muestra el párrafo completo y devuelve true. */
  finish: () => boolean;
};
type TypewriterProps = {
  paragraphs: string[];
  paraIndex: number;
  cps: number | null;   // caracteres por segundo; null = al instante
  textStyle: any;
  links: PageLink[];
  onLinkPress: (link: PageLink, x: number, y: number) => void;
  onComplete: () => void;
};

const OUTLINE_OFFSETS: [number, number][] = [
  [-2, 0], [2, 0], [0, -2], [0, 2], [-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5],
];

const Typewriter = React.memo(forwardRef<TypewriterHandle, TypewriterProps>(function Typewriter(
  { paragraphs, paraIndex, cps, textStyle, links, onLinkPress, onComplete }, ref,
) {
  const current = paragraphs[paraIndex] ?? '';
  const key = `${paraIndex}|${current}`;
  // Letras mostradas, asociadas al párrafo al que pertenecen: así un párrafo nuevo
  // nunca se pinta un instante con las letras del anterior
  const [typed, setTyped] = useState<{ key: string; n: number }>({ key: '', n: 0 });
  const shown = typed.key === key ? typed.n : (cps === null ? current.length : 0);

  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef       = useRef(true);
  const cpsRef        = useRef(cps);
  const onCompleteRef = useRef(onComplete);
  const scrollRef     = useRef<ScrollView>(null);
  cpsRef.current = cps;
  onCompleteRef.current = onComplete;

  const stop = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  const complete = (k: string, len: number) => {
    stop();
    setTyped({ key: k, n: len });
    if (!doneRef.current) { doneRef.current = true; onCompleteRef.current(); }
  };

  useEffect(() => {
    doneRef.current = false;
    const speed = cpsRef.current;
    if (speed === null || current.length === 0) { complete(key, current.length); return; }
    setTyped({ key, n: 0 });
    const start = Date.now();
    // ~30 fps: en cada tick se muestran las letras que tocan según el tiempo transcurrido
    timerRef.current = setInterval(() => {
      const n = Math.min(current.length, Math.floor(((Date.now() - start) / 1000) * speed) + 1);
      if (n >= current.length) complete(key, current.length);
      else setTyped({ key, n });
    }, 33);
    return stop;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    finish: () => {
      if (doneRef.current) return false;
      complete(key, current.length);
      return true;
    },
  }), [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const revealedText = [...paragraphs.slice(0, paraIndex), current.slice(0, shown)].filter(Boolean).join('\n\n');

  let content: React.ReactNode;
  if (links.length === 0) {
    // Sin enlaces: outline clásico (mejor calidad visual)
    content = <OutlineText style={textStyle}>{revealedText}</OutlineText>;
  } else {
    // Con enlaces: capas de outline absolutas + capa principal en flujo
    const segs = parseParagraphSegments(revealedText, links);
    const renderSegs = (forOutline: boolean) =>
      segs.map((seg, i) =>
        seg.type === 'link'
          ? <Text
              key={i}
              style={{
                fontWeight: '900' as const,
                color: forOutline ? darkenHex(seg.link.color, 0.55) : seg.link.color,
                ...(forOutline ? {} : { textDecorationLine: 'underline' as const }),
              }}
              {...(forOutline ? {} : {
                onPress: (e: any) => onLinkPress(
                  seg.link,
                  e.nativeEvent.pageX ?? e.nativeEvent.clientX ?? 0,
                  e.nativeEvent.pageY ?? e.nativeEvent.clientY ?? 0,
                ),
              })}
            >{seg.content}</Text>
          : <Text key={i} style={{ color: forOutline ? '#000' : '#fff' as const }}>{seg.content}</Text>
      );
    content = (
      <View>
        {/* Capas de outline — absolutas, detrás del texto principal */}
        {OUTLINE_OFFSETS.map(([dx, dy], idx) => (
          <Text
            key={`ol-${idx}`}
            style={[textStyle, {
              position: 'absolute' as const,
              left: 0, top: 0, right: 0,
              transform: [{ translateX: dx }, { translateY: dy }],
            }]}
          >
            {renderSegs(true)}
          </Text>
        ))}
        {/* Capa principal — en flujo, define la altura del bloque */}
        <Text style={textStyle}>{renderSegs(false)}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.textScroll}
      showsVerticalScrollIndicator={false}
      scrollEnabled={false}
      // Solo cuando crece la altura (línea nueva), no en cada letra
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
    >
      {content}
    </ScrollView>
  );
}));

export default function PageModernoReaderScreen() {
  const router = useRouter();
  const { storyId, chapterId, pageIndex: pageIndexParam, pageId: pageIdParam, preview, hist } = useLocalSearchParams<{
    storyId: string;
    chapterId: string;
    pageIndex?: string;
    pageId?: string;     // tiene prioridad sobre pageIndex (no cambia al reordenar)
    preview?: string;    // '1' = abierto desde el editor: no guarda progreso
    hist?: string;       // '1' = se llega desde otro capítulo dentro del lector: conservar historial
  }>();
  const isPreview = preview === '1';

  // La pantalla no se apaga mientras el lector está abierto (párrafos largos, autoplay)
  useKeepAwake();

  // Historial: se vacía al abrir el lector desde fuera; se conserva entre capítulos
  const [historyLen, setHistoryLen] = useState(() => {
    if (hist !== '1') readerHistory = [];
    return readerHistory.length;
  });
  const fadingRef = useRef(false); // hay una transición de página en curso
  const historyReadyRef = useRef(false); // ya se intentó recuperar el historial guardado
  const viewCountedRef = useRef(false);  // ya se intentó contar la lectura en esta apertura
  const historyRestoredRef = useRef(hist === '1'); // la recuperación terminó (se puede guardar en la nube)

  const [pages, setPages]       = useState<Page[]>([]);
  const [loading, setLoading]   = useState(true);
  const [current, setCurrent]   = useState(Number(pageIndexParam ?? 0));
  const [containerSize, setContainerSize] = useState({ width: 667, height: 375 });
  // Tamaño medido de cada etiqueta de personaje (sin rotar), para colocarla contra el bloque
  const [labelSizes, setLabelSizes] = useState({ left: { w: 0, h: 0 }, right: { w: 0, h: 0 } });
  const [showUI, setShowUI]                 = useState(true);
  const [paragraphs, setParagraphs]         = useState<string[]>([]);
  const [paraIndex, setParaIndex]           = useState(0);
  const [paraComplete, setParaComplete]     = useState(false);
  const [autoPlay, setAutoPlay]             = useState(false);
  // Color de acento dinámico
  const [accentColor, setAccentColor]           = useState(Colors.emerald);
  const [showSettings, setShowSettings]         = useState(false);
  const [textSpeed, setTextSpeed]               = useState<TextSpeed>('normal');
  const [textScale, setTextScale]               = useState<TextScale>('md');

  // Marcador: chapterId + pageIndex guardados manualmente por el lector
  const [savedBookmark, setSavedBookmark]   = useState<{ chapterId: string; pageIndex: number } | null>(null);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  // Sparkle: posición y datos del enlace pulsado
  const [sparkle, setSparkle] = useState<{ x: number; y: number; color: string; link: PageLink } | null>(null);
  // Siguiente capítulo (null si no existe o no está publicado — excepto para el autor)
  const [nextChapter, setNextChapter] = useState<{ id: string; title: string } | null>(null);
  const [isAuthor, setIsAuthor] = useState(false);
  // Comentarios: se cargan los del capítulo y se reparten por página
  const { publicName, publicAvatar, can, blocked, suspended } = useAuth();
  const [storyMeta, setStoryMeta]           = useState<{ title?: string; authorUid?: string | null }>({});
  const [chapterNumber, setChapterNumber]   = useState(1);
  const [chapterComments, setChapterComments] = useState<StoryComment[]>([]);
  const [showComments, setShowComments]     = useState(false);
  const [commentText, setCommentText]       = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const [reportTarget, setReportTarget]     = useState<ReportTarget | null>(null);
  const [staffRoles, setStaffRoles]         = useState<Map<string, Role>>(new Map());
  const uiOpacity   = useRef(new Animated.Value(1)).current;
  const cursorAnim  = useRef(new Animated.Value(1)).current;
  // Ref para capturar la página actual en el cleanup (sin depender de state)
  const currentRef      = useRef(Number(pageIndexParam ?? 0));
  // Texto con efecto máquina de escribir (componente aparte)
  const typewriterRef   = useRef<TypewriterHandle>(null);

  // ── Audio música ──────────────────────────────────────────────────────────
  const soundRef        = useRef<Audio.Sound | null>(null);
  const currentTrackRef = useRef<string | null>(null);
  const playGenRef      = useRef(0);   // se incrementa cada vez que inicia una carga nueva
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const [isMuted, setIsMuted]               = useState(false);
  const isMutedRef = useRef(false);
  const trackVolumeRef = useRef(musicPlaybackVolume()); // volumen de la pista actual
  const playingUrlRef  = useRef<string | null>(null);   // url de la pista que suena (soundRef)
  // Fundidos de volumen en curso, y pistas que aún están saliendo (no se liberan)
  const fadeTimersRef  = useRef(new Map<Audio.Sound, ReturnType<typeof setInterval>>());
  const fadingOutRef   = useRef(new Set<string>());

  // ── SFX de UI ─────────────────────────────────────────────────────────────
  const sfxParaRef = useRef<Audio.Sound | null>(null);
  const sfxPageRef = useRef<Audio.Sound | null>(null);

  // ── Transición de página ──────────────────────────────────────────────────
  const pageOpacity = useRef(new Animated.Value(1)).current;

  // ── Barras ecualizador ────────────────────────────────────────────────────
  const bars        = useRef([0.3, 0.6, 0.4, 0.5].map(v => new Animated.Value(v))).current;
  const barsAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    mountedReaders++;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    // Configurar audio una sola vez al entrar (evita delay en cada pista)
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    // Precargar SFX de UI
    (async () => {
      try {
        const [{ sound: p }, { sound: pg }] = await Promise.all([
          Audio.Sound.createAsync(require('@/assets/sounds/sfx_para.wav'), { volume: 0.55 }),
          Audio.Sound.createAsync(require('@/assets/sounds/sfx_page.wav'), { volume: 0.50 }),
        ]);
        sfxParaRef.current = p;
        sfxPageRef.current = pg;
      } catch (_) {}
    })();
    if (Platform.OS === 'android') {
      NavigationBar.setVisibilityAsync('hidden');
      NavigationBar.setBehaviorAsync('overlay-swipe');
    }
    return () => {
      mountedReaders--;
      if (mountedReaders === 0) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        if (Platform.OS === 'android') {
          NavigationBar.setVisibilityAsync('visible');
          NavigationBar.setBehaviorAsync('overlay-swipe');
        }
      }
      sfxParaRef.current?.unloadAsync().catch(() => {});
      sfxPageRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!storyId || !chapterId) return;
    (async () => {
      try {
        const [pagesSnap, storySnap, chaptersSnap, savedPref] = await Promise.all([
          getDocs(query(
            collection(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages'),
            orderBy('order', 'asc')
          )),
          getDoc(doc(db, 'stories', storyId as string)),
          getDocs(collection(db, 'stories', storyId as string, 'chapters')),
          AsyncStorage.getItem(UI_ACCENT_KEY).catch(() => null),
        ]);
        const data: Page[] = pagesSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Page, 'id'>) }));
        setPages(data);
        // Fondos a caché antes de llegar a cada página (evita el negro al pasar)
        const bgUrls = [...new Set(data.map(p => p.backgroundUrl).filter(Boolean))];
        bgUrls.forEach(url => { Image.prefetch(url).catch(() => {}); });
        const startIdx = pageIdParam ? data.findIndex(p => p.id === pageIdParam) : -1;
        if (startIdx >= 0) {
          currentRef.current = startIdx;
          setCurrent(startIdx);
        } else if (data.length > 0 && currentRef.current >= data.length) {
          currentRef.current = data.length - 1;
          setCurrent(data.length - 1);
        }
        // Color: preferencia del lector → recomendación del escritor → verde
        const recommended = storySnap.exists() ? (storySnap.data().recommendedUiColor ?? null) : null;
        setAccentColor(savedPref ?? recommended ?? Colors.emerald);
        // El autor puede ver capítulos no publicados también
        const storyAuthorId = storySnap.exists() ? (storySnap.data().uid ?? null) : null;
        const currentUid = auth.currentUser?.uid ?? null;
        const isStoryAuthor = !!(storyAuthorId && currentUid && storyAuthorId === currentUid);
        setIsAuthor(isStoryAuthor);
        setStoryMeta({
          title: storySnap.exists() ? storySnap.data().title : undefined,
          authorUid: storyAuthorId,
        });
        // Buscar el siguiente capítulo (publicado para lectores, cualquiera para el autor)
        const sortedChapters = sortChapters(chaptersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        const currentIdx = sortedChapters.findIndex(c => c.id === chapterId);
        // Número de capítulo como lo ven los lectores (entre los publicados)
        const publishedIdx = sortedChapters.filter(c => c.published === true).findIndex(c => c.id === chapterId);
        setChapterNumber(Math.max(0, publishedIdx !== -1 ? publishedIdx : currentIdx) + 1);
        // Comentarios del capítulo (si fallan, el lector funciona igual)
        listChapterComments(storyId as string, chapterId as string)
          .then(setChapterComments)
          .catch(e => console.error('Error cargando comentarios:', e));
        getStaffRoles().then(setStaffRoles)
          .catch(e => console.error('Error cargando el equipo:', e));
        if (currentIdx !== -1) {
          const next = sortedChapters.slice(currentIdx + 1).find(c => isStoryAuthor || c.published === true);
          if (next) setNextChapter({ id: next.id, title: next.title ?? 'Siguiente capítulo' });
        }
      } catch (e) {
        console.error('Error cargando páginas:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [storyId, chapterId]);

  // ── Cambiar color de acento y guardarlo globalmente ───────────────────────
  const handlePickAccentColor = async (hex: string) => {
    setAccentColor(hex);
    try { await AsyncStorage.setItem(UI_ACCENT_KEY, hex); } catch (_) {}
  };

  // ── Ajustes de texto ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [speed, scale] = await Promise.all([
          AsyncStorage.getItem(TEXT_SPEED_KEY), AsyncStorage.getItem(TEXT_SCALE_KEY),
        ]);
        if (speed && speed in TEXT_SPEED_CPS) setTextSpeed(speed as TextSpeed);
        if (scale && scale in TEXT_SCALE)    setTextScale(scale as TextScale);
      } catch (_) {}
    })();
  }, []);

  const handlePickTextSpeed = (speed: TextSpeed) => {
    setTextSpeed(speed);
    AsyncStorage.setItem(TEXT_SPEED_KEY, speed).catch(() => {});
  };
  const handlePickTextScale = (scale: TextScale) => {
    setTextScale(scale);
    AsyncStorage.setItem(TEXT_SCALE_KEY, scale).catch(() => {});
  };

  // ── Efecto 1: al cambiar de página, dividir en párrafos y resetear ──────
  useEffect(() => {
    if (pages.length === 0) return;
    const text = pages[current]?.text ?? '';
    // Dividir solo en doble salto de línea — los \n simples se preservan dentro del párrafo
    const paras = text.split(/\n\n+/).map(p => p.replace(/^\n+|\n+$/g, '')).filter(p => p.length > 0);
    setParagraphs(paras.length > 0 ? paras : ['']);
    setParaIndex(0);
    setParaComplete(false);
  }, [current, pages]);

  // ── Efecto 3: auto-avance de párrafos (no páginas) ───────────────────────
  useEffect(() => {
    if (!paraComplete || !autoPlay) return;
    if (paraIndex >= paragraphs.length - 1) return; // última párrafo → no avanzar página
    const t = setTimeout(() => { setParaComplete(false); setParaIndex(i => i + 1); }, 1400);
    return () => clearTimeout(t);
  }, [paraComplete, autoPlay, paraIndex, paragraphs]);

  // ── Pulso de los iconos de navegación dentro del recuadro ───────────────
  // Se reinicia cada vez que los iconos se vuelven visibles para garantizar
  // que la animación no quede congelada tras un cambio de estado.
  const hintAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const startHintPulse = () => {
    hintAnimRef.current?.stop();
    cursorAnim.setValue(1);
    hintAnimRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorAnim, { toValue: 0.15, duration: 550, useNativeDriver: true }),
        Animated.timing(cursorAnim, { toValue: 1,    duration: 550, useNativeDriver: true }),
      ])
    );
    hintAnimRef.current.start();
  };

  // Reiniciar pulso al terminar cada párrafo
  useEffect(() => {
    if (paraComplete) startHintPulse();
  }, [paraComplete]);

  // Reiniciar pulso al cambiar de página (para la flecha ← de retroceder)
  useEffect(() => {
    startHintPulse();
  }, [current]);

  // Sincronizar ref con state para el cleanup
  useEffect(() => { currentRef.current = current; }, [current]);

  // ── Funciones de audio ────────────────────────────────────────────────────
  // Animación del ecualizador en el hilo nativo (escala): mientras suena la música
  // no ocupa el hilo de JS. Antes animaba la altura desde JS cada 110 ms.
  const stopBars = () => {
    barsAnimRef.current?.stop();
    barsAnimRef.current = null;
    bars.forEach(b => b.setValue(0.2));
  };

  const startBars = () => {
    stopBars();
    const loop = (bar: Animated.Value, hi: number, lo: number, ms: number) => Animated.loop(
      Animated.sequence([
        Animated.timing(bar, { toValue: hi, duration: ms,       useNativeDriver: true }),
        Animated.timing(bar, { toValue: lo, duration: ms * 0.8, useNativeDriver: true }),
      ])
    );
    barsAnimRef.current = Animated.parallel([
      loop(bars[0], 1,    0.3,  260),
      loop(bars[1], 0.85, 0.25, 340),
      loop(bars[2], 1,    0.4,  200),
      loop(bars[3], 0.7,  0.2,  300),
    ]);
    barsAnimRef.current.start();
  };

  // ── Fundido de volumen ────────────────────────────────────────────────────
  const cancelFade = (sound: Audio.Sound) => {
    const t = fadeTimersRef.current.get(sound);
    if (t) { clearInterval(t); fadeTimersRef.current.delete(sound); }
  };
  const fadeVolume = (sound: Audio.Sound, from: number, to: number, ms: number, onDone?: () => void) => {
    cancelFade(sound);
    const steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    const timer = setInterval(() => {
      i++;
      sound.setVolumeAsync(Math.max(0, Math.min(1, from + (to - from) * (i / steps)))).catch(() => {});
      if (i >= steps) {
        clearInterval(timer);
        fadeTimersRef.current.delete(sound);
        onDone?.();
      }
    }, 50);
    fadeTimersRef.current.set(sound, timer);
  };
  // Baja una pista hasta el silencio y la para. Mientras sale, no se libera de la caché.
  const fadeOutAndStop = (sound: Audio.Sound, url: string | null, fromVolume: number) => {
    const stop = () => {
      sound.stopAsync().catch(() => {});
      if (url) fadingOutRef.current.delete(url);
    };
    if (fromVolume <= 0) { cancelFade(sound); stop(); return; }
    if (url) fadingOutRef.current.add(url);
    fadeVolume(sound, fromVolume, 0, MUSIC_FADE_MS, stop);
  };

  const toggleMute = async () => {
    const newMuted = !isMutedRef.current;
    isMutedRef.current = newMuted;
    setIsMuted(newMuted);
    try {
      if (soundRef.current) cancelFade(soundRef.current);
      await soundRef.current?.setStatusAsync({ volume: newMuted ? 0 : trackVolumeRef.current });
    } catch (_) {}
  };

  // ── Caché de audio ────────────────────────────────────────────────────────
  // La música y los efectos se descargan por adelantado (página actual y la
  // siguiente), así suenan al instante al llegar. Antes cada pista se descargaba
  // al llegar a la página, después de parar y descargar la anterior.
  const audioCacheRef = useRef(new Map<string, Promise<Audio.Sound>>());
  const loadAudio = (url: string, looping: boolean): Promise<Audio.Sound> => {
    const key = (looping ? 'music:' : 'sfx:') + url;
    let p = audioCacheRef.current.get(key);
    if (!p) {
      p = Audio.Sound.createAsync({ uri: url }, { shouldPlay: false, isLooping: looping, volume: 0 })
        .then(r => r.sound);
      p.catch(() => audioCacheRef.current.delete(key)); // si falla, se reintenta la próxima vez
      audioCacheRef.current.set(key, p);
    }
    return p;
  };
  const releaseAudio = (key: string) => {
    const p = audioCacheRef.current.get(key);
    if (!p) return;
    audioCacheRef.current.delete(key);
    p.then(s => s.unloadAsync()).catch(() => {});
  };

  const playTrack = async (url: string, volume: number) => {
    const gen = ++playGenRef.current; // captura la generación de esta llamada
    const previous       = soundRef.current;
    const previousUrl    = playingUrlRef.current;
    const previousVolume = isMutedRef.current ? 0 : trackVolumeRef.current;
    currentTrackRef.current = url;
    trackVolumeRef.current = volume;
    try {
      const sound = await loadAudio(url, true);
      if (gen !== playGenRef.current) return; // llegó otra pista mientras cargaba
      // Empieza en silencio y entra con un fundido; la anterior sale con otro
      cancelFade(sound);
      fadingOutRef.current.delete(url);
      await sound.setStatusAsync({ shouldPlay: true, positionMillis: 0, volume: 0 });
      if (gen !== playGenRef.current) {
        if (currentTrackRef.current !== url) sound.stopAsync().catch(() => {});
        return;
      }
      if (previous && previous !== sound) fadeOutAndStop(previous, previousUrl, previousVolume);
      soundRef.current = sound;
      playingUrlRef.current = url;
      if (!isMutedRef.current) fadeVolume(sound, 0, volume, MUSIC_FADE_MS);
      setIsPlayingMusic(true);
      startBars();
    } catch (e) {
      if (gen === playGenRef.current) currentTrackRef.current = null;
      console.error('Error reproduciendo música:', e);
    }
  };

  const stopTrack = () => {
    playGenRef.current++; // invalida cualquier playTrack en vuelo
    const sound = soundRef.current;
    if (sound) fadeOutAndStop(sound, playingUrlRef.current, isMutedRef.current ? 0 : trackVolumeRef.current);
    soundRef.current = null;
    playingUrlRef.current = null;
    currentTrackRef.current = null;
    setIsPlayingMusic(false);
    stopBars();
  };

  // ── Efecto de música al cambiar de página ─────────────────────────────────
  useEffect(() => {
    if (pages.length === 0) return;

    // Busca hacia atrás la pista efectiva para la página actual
    let effectiveTrack: string | null = null;
    let effectiveVolume = musicPlaybackVolume();
    let found = false;
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.musicUrl !== undefined) {
        effectiveTrack = pages[i]?.musicUrl || null;
        effectiveVolume = musicPlaybackVolume(pages[i]?.musicVolume);
        found = true;
        break;
      }
    }

    if (!found || effectiveTrack === null) {
      // Sin música: detener si algo sonaba
      if (currentTrackRef.current !== null) stopTrack();
    } else if (effectiveTrack !== currentTrackRef.current) {
      // Nueva pista
      playTrack(effectiveTrack, effectiveVolume);
    } else if (effectiveVolume !== trackVolumeRef.current) {
      // Misma pista con otro volumen: ajustarlo sin cortarla
      const from = trackVolumeRef.current;
      trackVolumeRef.current = effectiveVolume;
      if (!isMutedRef.current && soundRef.current) fadeVolume(soundRef.current, from, effectiveVolume, 250);
    }
    // Si misma pista y mismo volumen: no hacer nada (sigue sonando)
  }, [current, pages]);

  // ── Efecto de sonido de la página: una vez al llegar; se corta al cambiar ──
  useEffect(() => {
    const url = pages[current]?.sfxUrl;
    if (!url) return;
    let cancelled = false;
    let playing: Audio.Sound | null = null;
    loadAudio(url, false)
      .then(sound => {
        if (cancelled || isMutedRef.current) return;
        playing = sound;
        return sound.setStatusAsync({
          shouldPlay: true, positionMillis: 0, volume: sfxPlaybackVolume(pages[current]?.sfxVolume),
        });
      })
      .catch(e => console.error('Error reproduciendo efecto de sonido:', e));
    return () => {
      cancelled = true;
      (playing as Audio.Sound | null)?.stopAsync().catch(() => {});
    };
  }, [current, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Precarga de audio: página actual y siguiente; se libera el resto ─────
  useEffect(() => {
    if (pages.length === 0) return;
    const musicAt = (i: number): string | null => {
      for (let k = i; k >= 0; k--) {
        if (pages[k]?.musicUrl !== undefined) return pages[k]?.musicUrl || null;
      }
      return null;
    };
    const wanted = new Set<string>();
    for (const i of [current, getNextPageIndex()]) {
      if (i === null) continue;
      const m = musicAt(i);
      if (m) wanted.add('music:' + m);
      const s = pages[i]?.sfxUrl;
      if (s) wanted.add('sfx:' + s);
    }
    if (currentTrackRef.current) wanted.add('music:' + currentTrackRef.current);
    if (playingUrlRef.current) wanted.add('music:' + playingUrlRef.current);
    fadingOutRef.current.forEach(url => wanted.add('music:' + url));

    wanted.forEach(k => {
      if (k.startsWith('music:')) loadAudio(k.slice('music:'.length), true).catch(() => {});
      else loadAudio(k.slice('sfx:'.length), false).catch(() => {});
    });
    [...audioCacheRef.current.keys()].forEach(k => { if (!wanted.has(k)) releaseAudio(k); });
  }, [current, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup al salir del reader ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      playGenRef.current++;            // invalida cualquier playTrack en vuelo
      fadeTimersRef.current.forEach(t => clearInterval(t));
      fadeTimersRef.current.clear();
      stopBars();
      audioCacheRef.current.forEach(p => p.then(s => s.unloadAsync()).catch(() => {}));
      audioCacheRef.current.clear();
      soundRef.current = null;
    };
  }, []);

  // ── Historial de navegación: recuperar al entrar y guardar en cada cambio ──
  useEffect(() => {
    if (pages.length === 0 || !storyId || !chapterId || isPreview) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const key = historyKey(uid, storyId as string);
    const pageId = pages[current]?.id;
    if (!pageId) return;

    if (!historyReadyRef.current) {
      historyReadyRef.current = true;
      // hist=1: se viene de otro capítulo dentro del lector, el historial ya está en memoria
      if (hist === '1') return;
      (async () => {
        // Solo vale un historial que termina exactamente en la página a la que se vuelve
        const matches = (s: any): s is SavedHistory =>
          !!s && s.chapterId === chapterId && s.pageId === pageId && Array.isArray(s.history);
        const restore = (history: HistoryEntry[]) => {
          readerHistory = [...history, ...readerHistory].slice(-HISTORY_MAX);
          setHistoryLen(readerHistory.length);
        };
        try {
          const raw = await AsyncStorage.getItem(key);
          const local = raw ? JSON.parse(raw) : null;
          if (matches(local)) {
            restore(local.history);
          } else {
            // En este móvil no está: puede venir de otro dispositivo (biblioteca en Firestore)
            const lib = (await getDoc(doc(db, 'users', uid, 'library', storyId as string))).data();
            const cloud = lib ? { chapterId: lib.lastChapterId, pageId: lib.lastPageId, history: lib.history } : null;
            if (matches(cloud)) restore(cloud.history);
          }
        } catch (_) {}
        historyRestoredRef.current = true;
      })();
      return;
    }

    const state: SavedHistory = { chapterId: chapterId as string, pageId, history: readerHistory };
    AsyncStorage.setItem(key, JSON.stringify(state)).catch(() => {});
  }, [current, pages, historyLen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guardar progreso de lectura en biblioteca ─────────────────────────────
  useEffect(() => {
    if (pages.length === 0 || !storyId || !chapterId || isPreview) return;

    const saveProgress = async (pageIdx: number) => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const libraryRef = doc(db, 'users', user.uid, 'library', storyId as string);
        const [storySnap, chapterSnap, existingSnap] = await Promise.all([
          getDoc(doc(db, 'stories', storyId as string)),
          getDoc(doc(db, 'stories', storyId as string, 'chapters', chapterId as string)),
          getDoc(libraryRef),
        ]);
        if (!storySnap.exists()) return;
        const sd = storySnap.data();
        const cd = chapterSnap.exists() ? chapterSnap.data() : null;
        const existing = existingSnap.exists() ? existingSnap.data() : null;
        const now = new Date().toISOString();

        await setDoc(libraryRef, {
          storyId,
          title: sd.title ?? '',
          coverUrl: sd.coverUrl ?? null,
          format: sd.format ?? '',
          coverOrientation: sd.coverOrientation ?? 'vertical',
          status: sd.status ?? 'ongoing',
          isReading: true,
          isInterested: existing?.isInterested ?? false,
          lastChapterId: chapterId,
          lastPageIndex: pageIdx,
          lastPageId: pages[pageIdx]?.id ?? null,
          ...(historyRestoredRef.current ? { history: readerHistory } : {}),
          lastChapterTitle: cd?.title ?? null,
          lastReadAt: now,
          addedAt: existing?.addedAt ?? now,
        }, { merge: true });
        // Lecturas (estadística del autor): se intenta una vez por apertura del lector,
        // no en cada guardado (al salir tras leer un rato contaría una lectura de más)
        if (!viewCountedRef.current) {
          viewCountedRef.current = true;
          enterReading(storyId as string, user.uid, sd.uid);
        }
      } catch (e) {
        console.error('Error guardando progreso de lectura:', e);
      }
    };

    // Guardar al abrir (posición inicial)
    saveProgress(currentRef.current);
    // Cargar marcador guardado
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'library', storyId as string));
        if (snap.exists() && snap.data().bookmarkChapterId) {
          const d = snap.data();
          setSavedBookmark({ chapterId: d.bookmarkChapterId, pageIndex: d.bookmarkPageIndex ?? 0 });
        }
      } catch (_) {}
    })();

    // Guardar también al mandar la app a segundo plano: si se cierra desde ahí,
    // el lector no llega a desmontarse y se perdería la posición
    const readerUid = auth.currentUser?.uid;
    const appStateSub = AppState.addEventListener('change', state => {
      if (state !== 'background') return;
      saveProgress(currentRef.current);
      // Apunta la hora por si la app se cierra desde el fondo (la sesión sigue abierta)
      if (readerUid) leaveReading(storyId as string, readerUid, false);
    });

    // Guardar al salir (posición final) y apuntar que se deja de leer
    return () => {
      appStateSub.remove();
      saveProgress(currentRef.current);
      if (readerUid) leaveReading(storyId as string, readerUid);
    };
  }, [pages]); // Solo cuando carguen las páginas

  // ── Marcador ──────────────────────────────────────────────────────────────
  // isBookmarked es derivado: true si la página actual coincide con el marcador
  const isBookmarked = savedBookmark?.chapterId === chapterId && savedBookmark?.pageIndex === current;

  // ── Obtiene el índice de la página siguiente (respetando redirecciones) ─────
  const getNextPageIndex = (): number | null => {
    const page = pages[current];
    if (page?.nextPageId) {
      const idx = pages.findIndex(p => p.id === page.nextPageId);
      if (idx >= 0) return idx;
    }
    const override = page?.nextPageIndex; // formato antiguo
    if (override !== undefined && override !== null && override >= 0 && override < pages.length) {
      return override;
    }
    return current < pages.length - 1 ? current + 1 : null;
  };

  // ── Navegación real (después del sparkle) ────────────────────────────────
  const doNavForLink = (link: PageLink) => {
    if (link.targetChapterId && link.targetChapterId !== chapterId) {
      pushHistory();
      router.replace(
        `/reader/page-moderno?storyId=${storyId}&chapterId=${link.targetChapterId}&pageIndex=${link.targetPageIndex}${link.targetPageId ? `&pageId=${link.targetPageId}` : ''}&hist=1${isPreview ? '&preview=1' : ''}`
      );
    } else {
      const idx = link.targetPageId
        ? pages.findIndex(p => p.id === link.targetPageId)
        : link.targetPageIndex;
      if (idx >= 0 && idx < pages.length) fadeToPage(idx);
    }
  };

  // ── Toque sobre enlace: muestra sparkle y después navega ─────────────────
  const handleLinkPress = (link: PageLink, px: number, py: number) => {
    if (sparkle) return;
    playSfxLink();
    setSparkle({ x: px, y: py, color: link.color, link });
  };

  const toggleBookmark = async () => {
    const user = auth.currentUser;
    if (!user || bookmarkLoading) return;
    setBookmarkLoading(true);
    try {
      const libraryRef = doc(db, 'users', user.uid, 'library', storyId as string);
      const snap = await getDoc(libraryRef);

      if (isBookmarked) {
        // Borrar marcador
        if (snap.exists()) {
          await updateDoc(libraryRef, {
            bookmarkChapterId: deleteField(),
            bookmarkPageIndex: deleteField(),
            bookmarkPageId: deleteField(),
            bookmarkChapterTitle: deleteField(),
          });
        }
        setSavedBookmark(null);
      } else {
        // Guardar marcador en la página actual
        const chapterSnap = await getDoc(doc(db, 'stories', storyId as string, 'chapters', chapterId as string));
        const chapterTitle = chapterSnap.exists() ? chapterSnap.data().title : null;
        const bm = {
          bookmarkChapterId: chapterId, bookmarkPageIndex: current,
          bookmarkPageId: pages[current]?.id ?? null, bookmarkChapterTitle: chapterTitle,
        };
        if (snap.exists()) {
          await updateDoc(libraryRef, bm);
        } else {
          const storySnap = await getDoc(doc(db, 'stories', storyId as string));
          const sd = storySnap.exists() ? storySnap.data() : {};
          await setDoc(libraryRef, {
            storyId, title: sd.title ?? '', coverUrl: sd.coverUrl ?? null,
            format: sd.format ?? '', coverOrientation: sd.coverOrientation ?? 'vertical',
            status: sd.status ?? 'ongoing', isReading: false, isInterested: false,
            addedAt: new Date().toISOString(), ...bm,
          });
        }
        setSavedBookmark({ chapterId: chapterId as string, pageIndex: current });
      }
    } catch (e) { console.error('Error guardando marcador:', e); }
    finally { setBookmarkLoading(false); }
  };

  // ── Comentarios de la página ──────────────────────────────────────────────
  const handleSendComment = async () => {
    const text = commentText.trim();
    const me = auth.currentUser;
    const pg = pages[current];
    if (!text || !me || !pg || sendingComment) return;
    if (suspended) {
      AppAlert.alert('Cuenta suspendida', 'Tu cuenta está suspendida: no puedes comentar.');
      return;
    }
    setSendingComment(true);
    try {
      const created = await addComment(
        storyId as string,
        {
          uid: me.uid, userName: publicName || 'Sin nombre', userAvatar: publicAvatar, text,
          chapterId: chapterId as string, pageId: pg.id,
          chapterNumber, pageNumber: current + 1,
        },
        storyMeta,
      );
      setChapterComments(prev => [created, ...prev]);
      setCommentText('');
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudo publicar el comentario.');
    } finally {
      setSendingComment(false);
    }
  };

  const handleDeleteComment = (c: StoryComment) => {
    AppAlert.alert('Borrar comentario', '¿Seguro que quieres borrar este comentario?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(storyId as string, c.id);
            setChapterComments(prev => prev.filter(x => x.id !== c.id));
          } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo borrar el comentario.'); }
        },
      },
    ]);
  };

  const goNext = () => {
    if (sparkle) return;   // no interrumpir animación de enlace
    // Con la interfaz oculta se sigue leyendo igual; se recupera con su botón (ojo)
    // Primer toque mientras escribe → mostrar párrafo completo
    if (!paraComplete) { typewriterRef.current?.finish(); return; }
    const isLastPara = paraIndex >= paragraphs.length - 1;
    if (!isLastPara) {
      playSfxPara();
      setParaComplete(false);
      setParaIndex(i => i + 1);
    } else {
      const next = getNextPageIndex();
      if (next !== null) fadeToPage(next);
    }
  };
  // ── SFX helpers ───────────────────────────────────────────────────────────
  const playSfxPara = () => {
    sfxParaRef.current?.replayAsync().catch(() => {});
  };
  const playSfxPage = () => {
    sfxPageRef.current?.replayAsync().catch(() => {});
  };
  const playSfxLink = () => {
    // Crea cada nota al vuelo — evita el problema de "primer click sin sonido"
    // que ocurre en Android con sonidos precargados a rate != 1.0
    const fireNote = (rate: number, volume: number, delayMs: number) => {
      setTimeout(async () => {
        try {
          const { sound } = await Audio.Sound.createAsync(
            require('@/assets/sounds/sfx_para.wav'),
            { shouldPlay: true, volume, rate, shouldCorrectPitch: false }
          );
          // Auto-descarga al terminar
          sound.setOnPlaybackStatusUpdate(status => {
            if (status.isLoaded && status.didJustFinish) {
              sound.unloadAsync().catch(() => {});
            }
          });
        } catch (_) {}
      }, delayMs);
    };
    fireNote(1.4, 0.55,   0);   // "ti"
    fireNote(2.0, 0.60,  90);   // "ru"
    fireNote(2.8, 0.50, 190);   // "ruun"
  };

  // ── Mostrar / ocultar HUD ────────────────────────────────────────────────
  const toggleHUD = () => {
    if (showUI) {
      Animated.timing(uiOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setShowUI(false));
    } else {
      setShowUI(true);
      Animated.timing(uiOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  };

  // ── Fade de página ────────────────────────────────────────────────────────
  // Apunta la página actual como origen del siguiente salto
  const pushHistory = () => {
    const pg = pages[current];
    if (!pg) return;
    readerHistory.push({ chapterId: chapterId as string, pageId: pg.id });
    if (readerHistory.length > HISTORY_MAX) readerHistory.shift();
    setHistoryLen(readerHistory.length);
  };

  // record = false al retroceder (no se apunta el paso atrás en el historial)
  const fadeToPage = (newIndex: number, record = true) => {
    if (fadingRef.current) return; // evita saltos dobles por toques seguidos
    fadingRef.current = true;
    if (record) pushHistory();
    playSfxPage();
    Animated.timing(pageOpacity, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      // Limpiar estado de texto ANTES de volver a ser visible — evita el flash
      setParagraphs(['']);
      setParaIndex(0);
      setParaComplete(false);
      setCurrent(newIndex);
      fadingRef.current = false;
      Animated.timing(pageOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  // Atrás: vuelve a la página de la que se vino (aunque sea de otro capítulo).
  // Sin historial (p. ej. al continuar una lectura), va a la página anterior del capítulo.
  const goPrev = () => {
    if (fadingRef.current) return;
    while (readerHistory.length > 0) {
      const entry = readerHistory.pop()!;
      setHistoryLen(readerHistory.length);
      if (entry.chapterId !== chapterId) {
        router.replace(
          `/reader/page-moderno?storyId=${storyId}&chapterId=${entry.chapterId}&pageId=${entry.pageId}&hist=1${isPreview ? '&preview=1' : ''}`
        );
        return;
      }
      const idx = pages.findIndex(p => p.id === entry.pageId);
      if (idx >= 0 && idx !== current) { fadeToPage(idx, false); return; }
      // Esa página ya no existe: probar con el paso anterior del historial
    }
    if (current > 0) fadeToPage(current - 1, false);
  };
  const goNextPage = () => { const next = getNextPageIndex(); if (next !== null) fadeToPage(next); };

  const page       = pages[current];
  // Comentarios de esta página, sin los de usuarios bloqueados
  const pageComments = page ? chapterComments.filter(c => c.pageId === page.id && !blocked.has(c.uid)) : [];
  const isLastPage = current === pages.length - 1 && pages.length > 0;
  const hasNextOverride = page?.nextPageIndex !== undefined && page?.nextPageIndex !== null;
  const showArrowRight  = !isLastPage || hasNextOverride;

  // ── Herencia de imagen de fondo (como la música) ──────────────────────────
  const effectiveBg = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.backgroundUrl) return {
        url:    pages[i].backgroundUrl,
        anchor: pages[i].imageAnchor ?? 'center',
        fit:    pages[i].imageFit    ?? 'cover',
        blur:   pages[i].bgBlur      ?? BG_BLUR_DEFAULT,
      };
    }
    return null;
  })();

  // ── Herencia de tamaño de texto (como la música) ──────────────────────────
  const effectiveTextSize: TextSize = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.textSize !== undefined) return pages[i].textSize!;
    }
    return 'md';
  })();

  // Estable entre renders para que el Typewriter (memo) no se repinte sin motivo
  const textFontSize = FONT_SIZES[effectiveTextSize] * TEXT_SCALE[textScale];
  const typewriterTextStyle = useMemo(
    () => [styles.vnText, { fontSize: textFontSize, lineHeight: textFontSize * 1.6 }],
    [textFontSize],
  );
  const linkPressRef = useRef(handleLinkPress);
  linkPressRef.current = handleLinkPress;
  const onTypewriterLinkPress = useCallback(
    (link: PageLink, x: number, y: number) => linkPressRef.current(link, x, y), [],
  );
  const onParagraphComplete = useCallback(() => setParaComplete(true), []);

  // ── Layout del cuadro de texto — heredado hacia atrás (como música y fondo) ─
  const tbl = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.textBoxLayout !== undefined) return pages[i].textBoxLayout!;
    }
    return DEFAULT_TBL;
  })();

  // ── Nombres y posiciones de personaje — heredados hacia atrás ───────────
  const effectiveLeftChar = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.leftChar !== undefined) return pages[i].leftChar || null;
    }
    return null;
  })();
  const effectiveRightChar = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.rightChar !== undefined) return pages[i].rightChar || null;
    }
    return null;
  })();
  const effectiveLeftCharPos = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.leftCharPos !== undefined) return pages[i].leftCharPos!;
    }
    return null;
  })();
  const effectiveRightCharPos = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.rightCharPos !== undefined) return pages[i].rightCharPos!;
    }
    return null;
  })();
  const effectiveLeftCharSide = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.leftCharSide !== undefined) return pages[i].leftCharSide!;
    }
    return 1; // default: pegado arriba (sin borde inferior)
  })();
  const effectiveRightCharSide = (() => {
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.rightCharSide !== undefined) return pages[i].rightCharSide!;
    }
    return 1;
  })();
  const tbPixels = {
    left:   (tbl.x / 100) * containerSize.width,
    top:    (tbl.y / 100) * containerSize.height,
    width:  (tbl.w / 100) * containerSize.width,
    height: (tbl.h / 100) * containerSize.height,
  };

  // ── Etiquetas de personaje ────────────────────────────────────────────────
  // Misma geometría que el editor (charLabelPos): pegada, se coloca contra el bloque y
  // su eje libre se limita para no sobresalir. Se oculta hasta medirla.
  const renderCharLabel = (
    key: 'left' | 'right',
    name: string,
    side: number,
    pos: { x: number; y: number } | null,
  ) => {
    const { w, h } = labelSizes[key];
    const freeX = pos
      ? (pos.x / 100) * containerSize.width
      : key === 'left' ? tbPixels.left : tbPixels.left + tbPixels.width - w;
    const freeY = pos
      ? (pos.y / 100) * containerSize.height
      : side === 3 || side === 4 ? tbPixels.top : tbPixels.top - h;
    const { left, top } = charLabelPos(
      side, freeX, freeY, w, h,
      tbPixels.left, tbPixels.top,
      tbPixels.left + tbPixels.width, tbPixels.top + tbPixels.height,
    );
    return (
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left, top, opacity: w > 0 ? 1 : 0 }}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          if (width !== w || height !== h) {
            setLabelSizes(prev => ({ ...prev, [key]: { w: width, h: height } }));
          }
        }}
      >
        <View style={[styles.charLabel, { borderColor: accentColor + '70' }, charLabelSideStyle(side, CHAR_LABEL.radius)]}>
          <Text style={[styles.charLabelText, { color: accentColor }]} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <ActivityIndicator color={accentColor} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <TouchableOpacity
        style={styles.mainArea}
        activeOpacity={1}
        onPress={goNext}
        onLayout={e => setContainerSize(e.nativeEvent.layout)}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: pageOpacity }]}>

        {/* ── FONDO COMPLETO — hereda imagen si la página no tiene una propia ── */}
        {effectiveBg
          ? <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
              <Image
                source={{ uri: effectiveBg.url }}
                style={
                  effectiveBg.fit === 'contain'
                    ? StyleSheet.absoluteFill
                    : effectiveBg.anchor === 'center'
                    ? StyleSheet.absoluteFill
                    : effectiveBg.anchor === 'top'
                    ? { position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: 16 / 9 }
                    : { position: 'absolute', bottom: 0, left: 0, right: 0, aspectRatio: 16 / 9 }
                }
                resizeMode={effectiveBg.fit === 'contain' ? 'contain' : 'cover'}
                // Se aplica al decodificar y queda en caché: no se recalcula en cada frame
                blurRadius={effectiveBg.blur}
              />
            </View>
          : null
        }

        {/* ── Badge "Fin del capítulo" — arriba de la pantalla ── */}
        {isLastPage && (
          <View style={[styles.endChapterBadge, { borderColor: accentColor }]}>
            <OutlineText style={[styles.endChapterText, { color: accentColor }]}>— FIN DEL CAPÍTULO —</OutlineText>
          </View>
        )}

        </Animated.View>

        {/* ── Etiquetas de personaje ── */}
        {effectiveLeftChar &&
          renderCharLabel('left', effectiveLeftChar, effectiveLeftCharSide, effectiveLeftCharPos)}
        {effectiveRightChar &&
          renderCharLabel('right', effectiveRightChar, effectiveRightCharSide, effectiveRightCharPos)}

        {/* ── Bloque de texto — posición y tamaño definidos por el autor ── */}
        <View style={[styles.textBox, { position: 'absolute', ...tbPixels }]}>
            {page ? (
              <Typewriter
                ref={typewriterRef}
                paragraphs={paragraphs}
                paraIndex={paraIndex}
                cps={TEXT_SPEED_CPS[textSpeed]}
                textStyle={typewriterTextStyle}
                links={page.links ?? []}
                onLinkPress={onTypewriterLinkPress}
                onComplete={onParagraphComplete}
              />
            ) : (
              <Text style={styles.emptyText}>No hay texto en esta página.</Text>
            )}

            {/* Flecha retroceder — esquina inferior izquierda del recuadro */}
            {(historyLen > 0 || current > 0) && (
              <TouchableOpacity style={styles.prevHint} onPress={goPrev} activeOpacity={0.7}>
                <Animated.View style={{ opacity: cursorAnim }}>
                  <MaterialIcons name="keyboard-backspace" size={16} color={accentColor} />
                </Animated.View>
              </TouchableOpacity>
            )}

            {/* Icono de avance flotante: ↵ para siguiente párrafo, libro para siguiente página */}
            {paraComplete && (
              <Animated.View style={[styles.paraHint, { opacity: cursorAnim }]}>
                <MaterialIcons
                  name={paraIndex < paragraphs.length - 1 ? 'keyboard-return' : 'menu-book'}
                  size={16}
                  color={accentColor}
                />
              </Animated.View>
            )}
          </View>

      </TouchableOpacity>

      {/* ── UI de navegación ── */}
      <Animated.View style={[styles.uiLayer, { opacity: uiOpacity }]} pointerEvents={showUI ? 'box-none' : 'none'}>

        <TouchableOpacity style={styles.backBtn} activeOpacity={0.8} onPress={() => router.back()}>
          <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        {/* Indicador ecualizador / mute */}
        {isPlayingMusic && (
          <TouchableOpacity
            style={[styles.equalizerWrap, isMuted && styles.equalizerWrapMuted]}
            onPress={toggleMute}
            activeOpacity={0.75}
          >
            {isMuted
              ? <MaterialIcons name="volume-off" size={18} color="#FF4444" />
              : bars.map((bar, i) => (
                  <Animated.View
                    key={i}
                    style={[styles.equalizerBar, { backgroundColor: accentColor, transform: [{ scaleY: bar }] }]}
                  />
                ))
            }
          </TouchableOpacity>
        )}

        {/* Botón ajustes — color, velocidad y tamaño del texto */}
        <TouchableOpacity
          style={[styles.paletteBtn, showSettings && { borderWidth: 1, borderColor: accentColor }]}
          onPress={() => setShowSettings(v => !v)}
          activeOpacity={0.75}
        >
          <MaterialIcons name="tune" size={16} color={showSettings ? accentColor : 'rgba(255,255,255,0.7)'} />
        </TouchableOpacity>

        {/* Botón ocultar HUD */}
        <TouchableOpacity style={styles.hideUIBtn} onPress={toggleHUD} activeOpacity={0.75}>
          <MaterialIcons name="visibility-off" size={16} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>

        {/* Panel de ajustes */}
        {showSettings && (
          <View style={styles.settingsPanel}>
            <Text style={styles.settingsLabel}>Color</Text>
            <View style={styles.settingsRow}>
              {UI_COLORS.map(c => (
                <TouchableOpacity
                  key={c.hex}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: c.hex },
                    accentColor === c.hex && { borderColor: '#fff', transform: [{ scale: 1.2 }] },
                  ]}
                  onPress={() => handlePickAccentColor(c.hex)}
                  activeOpacity={0.8}
                />
              ))}
            </View>
            <Text style={styles.settingsLabel}>Velocidad del texto</Text>
            <View style={styles.settingsRow}>
              {TEXT_SPEED_OPTIONS.map(o => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.settingsChip, textSpeed === o.value && { borderColor: accentColor, backgroundColor: hexToRgba(accentColor, 0.18) }]}
                  onPress={() => handlePickTextSpeed(o.value)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.settingsChipText, textSpeed === o.value && { color: accentColor }]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.settingsLabel}>Tamaño de letra</Text>
            <View style={styles.settingsRow}>
              {TEXT_SCALE_OPTIONS.map(o => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.settingsChip, textScale === o.value && { borderColor: accentColor, backgroundColor: hexToRgba(accentColor, 0.18) }]}
                  onPress={() => handlePickTextScale(o.value)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.settingsChipText, textScale === o.value && { color: accentColor }]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <View style={styles.pageIndicator}>
          <Text style={styles.pageIndicatorText}>{current + 1} / {pages.length}</Text>
        </View>

        {/* Botón comentarios de la página (no en modo prueba del autor) */}
        {!isPreview && page && (
          <TouchableOpacity style={styles.commentsBtn} activeOpacity={0.75} onPress={() => setShowComments(true)}>
            <MaterialIcons name="chat-bubble-outline" size={15} color="rgba(255,255,255,0.7)" />
            {pageComments.length > 0 && (
              <Text style={styles.commentsBtnCount}>{pageComments.length > 99 ? '99+' : pageComments.length}</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Botón marcador */}
        <TouchableOpacity
          style={[
            styles.bookmarkBtn,
            isBookmarked && { backgroundColor: hexToRgba(accentColor, 0.18), borderWidth: 1, borderColor: accentColor },
          ]}
          activeOpacity={0.75}
          onPress={toggleBookmark}
          disabled={bookmarkLoading}
        >
          {bookmarkLoading
            ? <ActivityIndicator size="small" color={accentColor} />
            : <MaterialIcons
                name={isBookmarked ? 'bookmark' : 'bookmark-border'}
                size={16}
                color={isBookmarked ? accentColor : 'rgba(255,255,255,0.7)'}
              />
          }
        </TouchableOpacity>

        {/* Botón auto-lectura */}
        <TouchableOpacity
          style={[
            styles.autoBtn,
            autoPlay && { backgroundColor: hexToRgba(accentColor, 0.18), borderWidth: 1, borderColor: accentColor },
          ]}
          activeOpacity={0.75}
          onPress={() => setAutoPlay(v => !v)}
        >
          <MaterialIcons
            name={autoPlay ? 'pause' : 'play-arrow'}
            size={16}
            color={autoPlay ? accentColor : 'rgba(255,255,255,0.7)'}
          />
        </TouchableOpacity>

        {showArrowRight && (
          <TouchableOpacity style={styles.arrowRight} activeOpacity={0.7} onPress={goNextPage}>
            <MaterialIcons name="chevron-right" size={32} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        )}

      </Animated.View>

      {/* Fuera de la capa ocultable: debe poder pulsarse con la interfaz oculta */}
      {/* Botón siguiente capítulo — solo al final del último párrafo de la última página */}
      {isLastPage && paraComplete && paraIndex >= paragraphs.length - 1 && nextChapter && (
        <TouchableOpacity
          style={[styles.nextChapterBtn, { borderColor: accentColor, backgroundColor: hexToRgba(accentColor, 0.15) }]}
          activeOpacity={0.8}
          onPress={() => {
            pushHistory();
            router.replace(
              `/reader/page-moderno?storyId=${storyId}&chapterId=${nextChapter.id}&pageIndex=0&hist=1${isPreview ? '&preview=1' : ''}`
            );
          }}
        >
          <MaterialIcons name="skip-next" size={16} color={accentColor} />
          <Text style={[styles.nextChapterText, { color: accentColor }]} numberOfLines={1}>
            {nextChapter.title}
          </Text>
          <MaterialIcons name="chevron-right" size={16} color={accentColor} />
        </TouchableOpacity>
      )}

      {/* Interfaz oculta: el botón se queda a la izquierda, más transparente, para recuperarla */}
      {!showUI && (
        <TouchableOpacity style={styles.showUIBtn} onPress={toggleHUD} activeOpacity={0.6}>
          <MaterialIcons name="visibility" size={16} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
      )}

      {/* ── Comentarios de la página ── */}
      <Modal
        visible={showComments}
        transparent
        animationType="fade"
        supportedOrientations={['landscape', 'portrait']}
        onRequestClose={() => setShowComments(false)}
      >
        <View style={styles.commentsOverlay}>
          <AppDialogHost />
          <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowComments(false)} />
          <KeyboardAvoidingView
            style={styles.commentsPanel}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.commentsHeader}>
              <Text style={styles.commentsTitle}>
                Comentarios · Cap. {chapterNumber} · Pág. {current + 1}
              </Text>
              <TouchableOpacity onPress={() => setShowComments(false)} hitSlop={8}>
                <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.8)" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={pageComments}
              keyExtractor={c => c.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 14, flexGrow: 1 }}
              ListEmptyComponent={
                <Text style={styles.commentsEmpty}>Nadie ha comentado esta página todavía.</Text>
              }
              renderItem={({ item }) => (
                <CommentItem
                  comment={item}
                  role={staffRoles.get(item.uid)}
                  showLocation={false}
                  canDelete={item.uid === auth.currentUser?.uid || isAuthor || can('deleteStories')}
                  onDelete={handleDeleteComment}
                  onReport={item.uid !== auth.currentUser?.uid
                    ? () => setReportTarget({
                        type: 'comment', storyId: storyId as string, storyTitle: storyMeta.title ?? '',
                        commentId: item.id, commentText: item.text, targetUid: item.uid,
                      })
                    : undefined}
                />
              )}
            />
            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Escribe un comentario…"
                placeholderTextColor="rgba(255,255,255,0.35)"
                maxLength={COMMENT_MAX_LENGTH}
                multiline
                disableFullscreenUI
              />
              <TouchableOpacity
                style={[styles.commentSendBtn, { backgroundColor: accentColor }, (!commentText.trim() || sendingComment) && { opacity: 0.4 }]}
                onPress={handleSendComment}
                disabled={!commentText.trim() || sendingComment}
                activeOpacity={0.8}
              >
                {sendingComment
                  ? <ActivityIndicator size="small" color="#000" />
                  : <MaterialIcons name="send" size={16} color="#000" />}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ── Sparkle overlay — encima de todo ── */}
      {sparkle && (
        <SparkleOverlay
          x={sparkle.x}
          y={sparkle.y}
          color={sparkle.color}
          onDone={() => {
            const link = sparkle.link;
            setSparkle(null);
            doNavForLink(link);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  mainArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Badge "Fin del capítulo" — arriba de la pantalla, centrado ───────────────
  endChapterBadge: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.80)',
    borderWidth: 1,
    borderColor: Colors.emerald,
    borderRadius: 4,
  },
  endChapterText: {
    fontFamily: RETRO_FONT,
    fontSize: 10,
    fontWeight: '700',
    color: Colors.emerald,
    letterSpacing: 2,
  },

  // ── Bloque de texto — la posición/tamaño se aplican vía estilo inline ───────
  textBox: {
    backgroundColor: 'rgba(22,24,30,0.82)',
    borderRadius: TEXT_BOX.radius,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: TEXT_BOX.paddingHorizontal,
    paddingTop: TEXT_BOX.paddingTop,
    paddingBottom: TEXT_BOX.paddingBottom,
    overflow: 'hidden',
  },
  textScroll: {
    flex: 1,
  },
  vnText: {
    fontFamily: RETRO_FONT,
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 24,
    letterSpacing: TEXT_BOX.letterSpacing,
    fontWeight: '700',
  },
  // Icono retroceder página — esquina inferior izquierda del recuadro
  prevHint: {
    position: 'absolute',
    bottom: 10,
    left: 14,
  },
  // Icono avanzar párrafo/página — esquina inferior derecha del recuadro
  paraHint: {
    position: 'absolute',
    bottom: 10,
    right: 14,
  },
  emptyText: {
    fontFamily: RETRO_FONT,
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    textAlign: 'center',
  },

  // ── UI de navegación ─────────────────────────────────────────────────────────
  uiLayer: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'box-none',
  },
  backBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageIndicator: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  autoBtn: {
    position: 'absolute',
    bottom: 18,
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  autoBtnActive: {
    backgroundColor: 'rgba(0,200,120,0.18)',
    borderWidth: 1,
    borderColor: Colors.emerald,
  },
  // Comentarios: a la izquierda del marcador (58 + 34 + 8 = 100)
  commentsBtn: {
    position: 'absolute',
    bottom: 18,
    right: 100,
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 9,
    flexDirection: 'row',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentsBtnCount: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700' },
  commentsOverlay:  { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.45)' },
  commentsPanel: {
    width: '52%', minWidth: 300, backgroundColor: 'rgba(18,18,22,0.97)',
    borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.12)',
  },
  commentsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  commentsTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  commentsEmpty: { color: 'rgba(255,255,255,0.45)', fontSize: 13, textAlign: 'center', marginTop: 24 },
  commentInputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)',
  },
  commentInput: {
    flex: 1, maxHeight: 84, color: '#fff', fontSize: 13,
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  commentSendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // Botón para recuperar la interfaz cuando está oculta: a la izquierda del todo y tenue
  showUIBtn: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.4,
  },
  bookmarkBtn: {
    position: 'absolute',
    bottom: 18,
    right: 58,       // autoPlay está en right:16, ancho 34, gap 8 → 16+34+8=58
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookmarkBtnActive: {
    backgroundColor: 'rgba(0,200,120,0.18)',
    borderWidth: 1,
    borderColor: Colors.emerald,
  },
  pageIndicatorText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: RETRO_FONT,
  },
  arrowRight: {
    position: 'absolute',
    right: 8,
    top: '50%',
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Ecualizador ──────────────────────────────────────────────────────────
  equalizerWrap: {
    position: 'absolute',
    bottom: 18,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 42,
    minHeight: 30,
    justifyContent: 'center',
  },
  equalizerWrapMuted: {
    borderWidth: 1,
    borderColor: 'rgba(255,68,68,0.4)',
  },
  equalizerBar: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: Colors.emerald, // se sobreescribe con accentColor en inline
  },

  // ── Paleta de colores ─────────────────────────────────────────────────────
  paletteBtn: {
    position: 'absolute',
    top: 16,
    left: 58,   // cerrar(34) + gap(8) = 58
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hideUIBtn: {
    position: 'absolute',
    top: 16,
    left: 100,  // paleta(58+34) + gap(8) = 100
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsPanel: {
    position: 'absolute',
    top: 58,
    left: 16,
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  settingsLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginTop: 2 },
  settingsRow:   { flexDirection: 'row', gap: 8, alignItems: 'center' },
  settingsChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  settingsChipText: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: 'transparent',
  },

  // ── Etiquetas de personaje ────────────────────────────────────────────────
  // Los bordes y radios de esquina se calculan dinámicamente con charSideBorder()
  charLabel: {
    backgroundColor: 'rgba(22,24,30,0.88)',
    paddingHorizontal: CHAR_LABEL.paddingHorizontal,
    paddingVertical: CHAR_LABEL.paddingVertical,
  },
  charLabelText: {
    fontFamily: RETRO_FONT,
    fontSize: CHAR_LABEL.fontSize,
    fontWeight: '700',
    letterSpacing: CHAR_LABEL.letterSpacing,
  },

  // ── Botón siguiente capítulo ──────────────────────────────────────────────
  nextChapterBtn: {
    position: 'absolute',
    bottom: 18,
    alignSelf: 'center',
    left: '25%',
    right: '25%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  nextChapterText: {
    fontFamily: RETRO_FONT,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
});
