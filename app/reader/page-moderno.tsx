import React, { useEffect, useState, useRef } from 'react';
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
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as NavigationBar from 'expo-navigation-bar';
import { collection, getDocs, query, orderBy, doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { db, auth } from '@/config/firebase';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';

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
type TextSize      = 'xs' | 'sm' | 'md' | 'lg';
type TextBoxLayout = { x: number; y: number; w: number; h: number };

// ─── Enlace de texto ──────────────────────────────────────────────────────────
export type PageLink = {
  word: string;
  color: string;
  targetPageIndex: number;
  targetChapterId?: string;
  targetChapterTitle?: string;
};

const FONT_SIZES: Record<TextSize, number> = { xs: 11, sm: 13, md: 15, lg: 19 };
const DEFAULT_TBL: TextBoxLayout = { x: 11, y: 23, w: 78, h: 53 };

interface Page {
  id: string;
  text: string;
  backgroundUrl: string;
  imageAnchor?: ImageAnchor;
  imageFit?: ImageFit;
  musicUrl?: string | null;
  textSize?: TextSize;
  textBoxLayout?: TextBoxLayout;
  links?: PageLink[];
  nextPageIndex?: number | null;
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

export default function PageModernoReaderScreen() {
  const router = useRouter();
  const { storyId, chapterId, pageIndex: pageIndexParam } = useLocalSearchParams<{
    storyId: string;
    chapterId: string;
    pageIndex: string;
  }>();

  const [pages, setPages]       = useState<Page[]>([]);
  const [loading, setLoading]   = useState(true);
  const [current, setCurrent]   = useState(Number(pageIndexParam ?? 0));
  const [containerSize, setContainerSize] = useState({ width: 667, height: 375 });
  const [showUI, setShowUI]                 = useState(true);
  const [displayedText, setDisplayedText]   = useState('');
  const [paragraphs, setParagraphs]         = useState<string[]>([]);
  const [paraIndex, setParaIndex]           = useState(0);
  const [paraComplete, setParaComplete]     = useState(false);
  const [autoPlay, setAutoPlay]             = useState(false);
  // Color de acento dinámico
  const [accentColor, setAccentColor]           = useState(Colors.emerald);
  const [showColorPicker, setShowColorPicker]   = useState(false);
  // Marcador: chapterId + pageIndex guardados manualmente por el lector
  const [savedBookmark, setSavedBookmark]   = useState<{ chapterId: string; pageIndex: number } | null>(null);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  // Sparkle: posición y datos del enlace pulsado
  const [sparkle, setSparkle] = useState<{ x: number; y: number; color: string; link: PageLink } | null>(null);
  // Siguiente capítulo (null si no existe o no está publicado — excepto para el autor)
  const [nextChapter, setNextChapter] = useState<{ id: string; title: string } | null>(null);
  const [isAuthor, setIsAuthor] = useState(false);
  const uiOpacity   = useRef(new Animated.Value(1)).current;
  const cursorAnim  = useRef(new Animated.Value(1)).current;
  // Ref para capturar la página actual en el cleanup (sin depender de state)
  const currentRef      = useRef(Number(pageIndexParam ?? 0));
  // Refs para el efecto typewriter
  const typingTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingIndexRef  = useRef(0);
  // Ref para auto-scroll del recuadro de texto
  const textScrollRef   = useRef<ScrollView>(null);

  // ── Audio música ──────────────────────────────────────────────────────────
  const soundRef        = useRef<Audio.Sound | null>(null);
  const currentTrackRef = useRef<string | null>(null);
  const playGenRef      = useRef(0);   // se incrementa cada vez que inicia una carga nueva
  const [isPlayingMusic, setIsPlayingMusic] = useState(false);
  const [isMuted, setIsMuted]               = useState(false);
  const isMutedRef = useRef(false);

  // ── SFX de UI ─────────────────────────────────────────────────────────────
  const sfxParaRef = useRef<Audio.Sound | null>(null);
  const sfxPageRef = useRef<Audio.Sound | null>(null);

  // ── Transición de página ──────────────────────────────────────────────────
  const pageOpacity = useRef(new Animated.Value(1)).current;

  // ── Barras ecualizador ────────────────────────────────────────────────────
  const bar1H = useRef(new Animated.Value(4)).current;
  const bar2H = useRef(new Animated.Value(10)).current;
  const bar3H = useRef(new Animated.Value(6)).current;
  const bar4H = useRef(new Animated.Value(8)).current;
  const barsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barsPhaseRef    = useRef(0);

  useEffect(() => {
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
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible');
        NavigationBar.setBehaviorAsync('overlay-swipe');
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
        // Color: preferencia del lector → recomendación del escritor → verde
        const recommended = storySnap.exists() ? (storySnap.data().recommendedUiColor ?? null) : null;
        setAccentColor(savedPref ?? recommended ?? Colors.emerald);
        // El autor puede ver capítulos no publicados también
        const storyAuthorId = storySnap.exists() ? (storySnap.data().authorId ?? null) : null;
        const currentUid = auth.currentUser?.uid ?? null;
        const isStoryAuthor = !!(storyAuthorId && currentUid && storyAuthorId === currentUid);
        setIsAuthor(isStoryAuthor);
        // Buscar el siguiente capítulo (publicado para lectores, cualquiera para el autor)
        const sortedChapters = chaptersSnap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
            if (a.createdAt && b.createdAt) return a.createdAt > b.createdAt ? 1 : -1;
            return 0;
          });
        const currentIdx = sortedChapters.findIndex(c => c.id === chapterId);
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
    setShowColorPicker(false);
    try { await AsyncStorage.setItem(UI_ACCENT_KEY, hex); } catch (_) {}
  };

  // ── Efecto 1: al cambiar de página, dividir en párrafos y resetear ──────
  useEffect(() => {
    if (pages.length === 0) return;
    const text = pages[current]?.text ?? '';
    // Dividir solo en doble salto de línea — los \n simples se preservan dentro del párrafo
    const paras = text.split(/\n\n+/).map(p => p.replace(/^\n+|\n+$/g, '')).filter(p => p.length > 0);
    setParagraphs(paras.length > 0 ? paras : ['']);
    setParaIndex(0);
  }, [current, pages]);

  // ── Efecto 2: al cambiar de párrafo, arrancar el typewriter ─────────────
  useEffect(() => {
    if (paragraphs.length === 0) return;
    const fullText = paragraphs[paraIndex] ?? '';

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    typingIndexRef.current = 0;
    setDisplayedText('');
    setParaComplete(false);

    typingTimerRef.current = setInterval(() => {
      typingIndexRef.current += 1;
      setDisplayedText(fullText.slice(0, typingIndexRef.current));
      if (typingIndexRef.current >= fullText.length) {
        clearInterval(typingTimerRef.current!);
        typingTimerRef.current = null;
        setParaComplete(true);
      }
    }, 32);

    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, [paraIndex, paragraphs]);

  // ── Efecto: scroll automático al final cuando se añade texto ────────────
  useEffect(() => {
    textScrollRef.current?.scrollToEnd({ animated: false });
  }, [displayedText, paraIndex]);

  // ── Efecto 3: auto-avance de párrafos (no páginas) ───────────────────────
  useEffect(() => {
    if (!paraComplete || !autoPlay) return;
    if (paraIndex >= paragraphs.length - 1) return; // última párrafo → no avanzar página
    const t = setTimeout(() => { setDisplayedText(''); setParaIndex(i => i + 1); }, 1400);
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
    if (current > 0) startHintPulse();
  }, [current]);

  // Sincronizar ref con state para el cleanup
  useEffect(() => { currentRef.current = current; }, [current]);

  // ── Funciones de audio ────────────────────────────────────────────────────
  const stopBars = () => {
    if (barsIntervalRef.current) {
      clearInterval(barsIntervalRef.current);
      barsIntervalRef.current = null;
    }
    bar1H.setValue(3); bar2H.setValue(3); bar3H.setValue(3); bar4H.setValue(3);
  };

  const startBars = () => {
    stopBars();
    barsPhaseRef.current = 0;
    barsIntervalRef.current = setInterval(() => {
      barsPhaseRef.current += 0.22;
      const wave = 0.5 + 0.45 * Math.sin(barsPhaseRef.current);
      const r    = () => 0.75 + 0.5 * Math.random();
      const clamp = (v: number) => Math.min(20, Math.max(4, v));
      Animated.parallel([
        Animated.timing(bar1H, { toValue: clamp(4 + 16 * wave * r()),        duration: 95, useNativeDriver: false }),
        Animated.timing(bar2H, { toValue: clamp(4 + 16 * wave * 1.35 * r()), duration: 95, useNativeDriver: false }),
        Animated.timing(bar3H, { toValue: clamp(4 + 16 * wave * 0.7  * r()), duration: 95, useNativeDriver: false }),
        Animated.timing(bar4H, { toValue: clamp(4 + 16 * wave * 1.1  * r()), duration: 95, useNativeDriver: false }),
      ]).start();
    }, 110);
  };

  const toggleMute = async () => {
    const newMuted = !isMutedRef.current;
    isMutedRef.current = newMuted;
    setIsMuted(newMuted);
    try {
      await soundRef.current?.setStatusAsync({ volume: newMuted ? 0 : 0.65 });
    } catch (_) {}
  };

  const playTrack = async (url: string) => {
    const gen = ++playGenRef.current; // captura la generación de esta llamada
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync().catch(() => {});
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      // Si ya hay una llamada más reciente en vuelo, abortamos
      if (gen !== playGenRef.current) return;

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true, isLooping: true, volume: isMutedRef.current ? 0 : 0.65 }
      );

      // Si mientras cargaba llegó otra llamada, descargar el sonido recién creado
      if (gen !== playGenRef.current) {
        sound.stopAsync().catch(() => {});
        sound.unloadAsync().catch(() => {});
        return;
      }

      soundRef.current = sound;
      currentTrackRef.current = url;
      setIsPlayingMusic(true);
      startBars();
    } catch (e) {
      console.error('Error reproduciendo música:', e);
    }
  };

  const stopTrack = async () => {
    try {
      await soundRef.current?.stopAsync();
      await soundRef.current?.unloadAsync();
    } catch (_) {}
    soundRef.current = null;
    currentTrackRef.current = null;
    setIsPlayingMusic(false);
    stopBars();
  };

  // ── Efecto de música al cambiar de página ─────────────────────────────────
  useEffect(() => {
    if (pages.length === 0) return;

    // Busca hacia atrás la pista efectiva para la página actual
    let effectiveTrack: string | null = null;
    let found = false;
    for (let i = current; i >= 0; i--) {
      if (pages[i]?.musicUrl !== undefined) {
        effectiveTrack = pages[i]?.musicUrl || null;
        found = true;
        break;
      }
    }

    if (!found || effectiveTrack === null) {
      // Sin música: detener si algo sonaba
      if (currentTrackRef.current !== null) stopTrack();
    } else if (effectiveTrack !== currentTrackRef.current) {
      // Nueva pista
      playTrack(effectiveTrack);
    }
    // Si misma pista: no hacer nada (sigue sonando)
  }, [current, pages]);

  // ── Cleanup al salir del reader ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      playGenRef.current++;            // invalida cualquier playTrack en vuelo
      stopBars();
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  // ── Guardar progreso de lectura en biblioteca ─────────────────────────────
  useEffect(() => {
    if (pages.length === 0 || !storyId || !chapterId) return;

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
          lastChapterTitle: cd?.title ?? null,
          lastReadAt: now,
          addedAt: existing?.addedAt ?? now,
        });
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

    // Guardar al salir (posición final)
    return () => { saveProgress(currentRef.current); };
  }, [pages]); // Solo cuando carguen las páginas

  // ── Marcador ──────────────────────────────────────────────────────────────
  // isBookmarked es derivado: true si la página actual coincide con el marcador
  const isBookmarked = savedBookmark?.chapterId === chapterId && savedBookmark?.pageIndex === current;

  // ── Obtiene el índice de la página siguiente (respetando redirecciones) ─────
  const getNextPageIndex = (): number | null => {
    const override = pages[current]?.nextPageIndex;
    if (override !== undefined && override !== null && override >= 0 && override < pages.length) {
      return override;
    }
    return current < pages.length - 1 ? current + 1 : null;
  };

  // ── Navegación real (después del sparkle) ────────────────────────────────
  const doNavForLink = (link: PageLink) => {
    if (link.targetChapterId && link.targetChapterId !== chapterId) {
      router.push(
        `/reader/page-moderno?storyId=${storyId}&chapterId=${link.targetChapterId}&pageIndex=${link.targetPageIndex}`
      );
    } else {
      if (link.targetPageIndex >= 0 && link.targetPageIndex < pages.length) {
        fadeToPage(link.targetPageIndex);
      }
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
            bookmarkChapterTitle: deleteField(),
          });
        }
        setSavedBookmark(null);
      } else {
        // Guardar marcador en la página actual
        const chapterSnap = await getDoc(doc(db, 'stories', storyId as string, 'chapters', chapterId as string));
        const chapterTitle = chapterSnap.exists() ? chapterSnap.data().title : null;
        const bm = { bookmarkChapterId: chapterId, bookmarkPageIndex: current, bookmarkChapterTitle: chapterTitle };
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

  const goNext = () => {
    if (sparkle) return;   // no interrumpir animación de enlace
    // Si el HUD está oculto, recuperarlo y no avanzar la historia
    if (!showUI) { toggleHUD(); return; }
    // Primer toque mientras escribe → mostrar párrafo completo
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
      setDisplayedText(paragraphs[paraIndex] ?? '');
      setParaComplete(true);
      return;
    }
    if (!paraComplete) return;
    const isLastPara = paraIndex >= paragraphs.length - 1;
    if (!isLastPara) {
      playSfxPara();
      setDisplayedText('');
      setParaIndex(i => i + 1);
    } else {
      const next = getNextPageIndex();
      if (next !== null) fadeToPage(next);
    }
  };
  // ── SFX helpers ───────────────────────────────────────────────────────────
  const playSfxPara = () => {
    sfxParaRef.current?.setPositionAsync(0).then(() => sfxParaRef.current?.playAsync()).catch(() => {});
  };
  const playSfxPage = () => {
    sfxPageRef.current?.setPositionAsync(0).then(() => sfxPageRef.current?.playAsync()).catch(() => {});
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
  const fadeToPage = (newIndex: number) => {
    playSfxPage();
    Animated.timing(pageOpacity, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
      // Limpiar estado de texto ANTES de volver a ser visible — evita el flash
      if (typingTimerRef.current) { clearInterval(typingTimerRef.current); typingTimerRef.current = null; }
      setDisplayedText('');
      setParagraphs(['']);
      setParaIndex(0);
      setParaComplete(false);
      setCurrent(newIndex);
      Animated.timing(pageOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const goPrev     = () => { if (current > 0) fadeToPage(current - 1); };
  const goNextPage = () => { const next = getNextPageIndex(); if (next !== null) fadeToPage(next); };

  const page       = pages[current];
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
  // Calcula el estilo de bordes + rotación según el side de la etiqueta.
  // s=3 → -90° CCW (izquierda), s=4 → +90° CW (derecha).
  // Los radios son en espacio de LAYOUT (antes de rotar):
  //   TL/TR → sólo squared al pegarse abajo (s=2)
  //   BL/BR → squared al pegarse arriba (1), izquierda (3) o derecha (4)
  const charSideBorder = (side: number) => ({
    borderTopWidth:          side === 2 ? 0 : 1,
    borderBottomWidth:       side === 1 ? 0 : 1,
    borderLeftWidth:         side === 4 ? 0 : 1,
    borderRightWidth:        side === 3 ? 0 : 1,
    borderTopLeftRadius:     side === 2 ? 0 : 6,
    borderTopRightRadius:    side === 2 ? 0 : 6,
    borderBottomLeftRadius:  (side === 1 || side === 3 || side === 4) ? 0 : 6,
    borderBottomRightRadius: (side === 1 || side === 3 || side === 4) ? 0 : 6,
    transform: side === 3 ? ([{ rotate: '-90deg' }] as any) : side === 4 ? ([{ rotate: '90deg' }] as any) : [],
  });
  const tbPixels = {
    left:   (tbl.x / 100) * containerSize.width,
    top:    (tbl.y / 100) * containerSize.height,
    width:  (tbl.w / 100) * containerSize.width,
    height: (tbl.h / 100) * containerSize.height,
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

        {/* ── Etiqueta personaje izquierda ── */}
        {effectiveLeftChar && (() => {
          const side = effectiveLeftCharSide;
          const pos  = effectiveLeftCharPos;
          // Cuando está pegada, la posición se deriva del bloque de texto (no del % guardado)
          // para compensar la diferencia de escala entre el preview del editor y la pantalla real.
          let left: number, top: number;
          if (side === 1) {
            // Pegada arriba: misma X que guardado, Y = justo encima del bloque
            left = pos ? (pos.x / 100) * containerSize.width : tbPixels.left;
            top  = tbPixels.top - 28; // 28px ≈ alto del label en el lector
          } else if (side === 2) {
            left = pos ? (pos.x / 100) * containerSize.width : tbPixels.left;
            top  = tbPixels.top + tbPixels.height;
          } else if (side === 3) {
            // Pegada izquierda: X = justo a la izq del bloque, Y libre
            left = tbPixels.left - 28; // label rotado: ancho visual ≈ su alto ≈ 28px
            top  = pos ? (pos.y / 100) * containerSize.height : tbPixels.top;
          } else if (side === 4) {
            left = tbPixels.left + tbPixels.width;
            top  = pos ? (pos.y / 100) * containerSize.height : tbPixels.top;
          } else {
            // Libre: posición exacta guardada
            left = pos ? (pos.x / 100) * containerSize.width : tbPixels.left;
            top  = pos ? (pos.y / 100) * containerSize.height : tbPixels.top - 28;
          }
          return (
            <View pointerEvents="none" style={{ position: 'absolute', left, top }}>
              <View style={[styles.charLabel, { borderColor: accentColor + '70' }, charSideBorder(side)]}>
                <Text style={[styles.charLabelText, { color: accentColor }]} numberOfLines={1}>
                  {effectiveLeftChar}
                </Text>
              </View>
            </View>
          );
        })()}
        {/* ── Etiqueta personaje derecha ── */}
        {effectiveRightChar && (() => {
          const side = effectiveRightCharSide;
          const pos  = effectiveRightCharPos;
          let left: number, top: number;
          if (side === 1) {
            left = pos ? (pos.x / 100) * containerSize.width : tbPixels.left + tbPixels.width - 120;
            top  = tbPixels.top - 28;
          } else if (side === 2) {
            left = pos ? (pos.x / 100) * containerSize.width : tbPixels.left + tbPixels.width - 120;
            top  = tbPixels.top + tbPixels.height;
          } else if (side === 3) {
            left = tbPixels.left - 28;
            top  = pos ? (pos.y / 100) * containerSize.height : tbPixels.top;
          } else if (side === 4) {
            left = tbPixels.left + tbPixels.width;
            top  = pos ? (pos.y / 100) * containerSize.height : tbPixels.top;
          } else {
            left = pos ? (pos.x / 100) * containerSize.width : tbPixels.left + tbPixels.width - 120;
            top  = pos ? (pos.y / 100) * containerSize.height : tbPixels.top - 28;
          }
          return (
            <View pointerEvents="none" style={{ position: 'absolute', left, top }}>
              <View style={[styles.charLabel, { borderColor: accentColor + '70' }, charSideBorder(side)]}>
                <Text style={[styles.charLabelText, { color: accentColor }]} numberOfLines={1}>
                  {effectiveRightChar}
                </Text>
              </View>
            </View>
          );
        })()}

        {/* ── Bloque de texto — posición y tamaño definidos por el autor ── */}
        <View style={[styles.textBox, { position: 'absolute', ...tbPixels }]}>
            <ScrollView
              ref={textScrollRef}
              style={styles.textScroll}
              showsVerticalScrollIndicator={false}
              scrollEnabled={false}
            >
              {(() => {
                if (!page) return <Text style={styles.emptyText}>No hay texto en esta página.</Text>;
                const revealedText = [...paragraphs.slice(0, paraIndex), displayedText].filter(Boolean).join('\n\n');
                const textStyle = [styles.vnText, { fontSize: FONT_SIZES[effectiveTextSize], lineHeight: FONT_SIZES[effectiveTextSize] * 1.6 }] as any;
                const pageLinks = page.links ?? [];
                if (pageLinks.length === 0) {
                  // Sin enlaces: outline clásico (mejor calidad visual)
                  return <OutlineText style={textStyle}>{revealedText}</OutlineText>;
                }
                // Con enlaces: capas de outline absolutas + capa principal en flujo
                const segs = parseParagraphSegments(revealedText, pageLinks);
                const outlineOffsets: [number, number][] = [
                  [-2,0],[2,0],[0,-2],[0,2],[-1.5,-1.5],[1.5,-1.5],[-1.5,1.5],[1.5,1.5],
                ];
                // Renderiza los segmentos de texto para una capa dada
                const renderSegs = (forOutline: boolean) =>
                  segs.map((seg, i) =>
                    seg.type === 'link'
                      ? <Text
                          key={i}
                          style={{
                            fontWeight: '900' as const,
                            color: forOutline
                              ? darkenHex(seg.link.color, 0.55)
                              : seg.link.color,
                            ...(forOutline ? {} : { textDecorationLine: 'underline' as const }),
                          }}
                          {...(forOutline ? {} : {
                            onPress: (e: any) => handleLinkPress(
                              seg.link,
                              e.nativeEvent.pageX ?? e.nativeEvent.clientX ?? 0,
                              e.nativeEvent.pageY ?? e.nativeEvent.clientY ?? 0,
                            ),
                          })}
                        >{seg.content}</Text>
                      : <Text key={i} style={{ color: forOutline ? '#000' : '#fff' as const }}>{seg.content}</Text>
                  );
                return (
                  <View>
                    {/* Capas de outline — absolutas, detrás del texto principal */}
                    {outlineOffsets.map(([dx, dy], idx) => (
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
                    <Text style={textStyle}>
                      {renderSegs(false)}
                    </Text>
                  </View>
                );
              })()}
            </ScrollView>

            {/* Flecha retroceder — esquina inferior izquierda del recuadro */}
            {current > 0 && (
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
              : [bar1H, bar2H, bar3H, bar4H].map((bar, i) => (
                  <Animated.View key={i} style={[styles.equalizerBar, { height: bar, backgroundColor: accentColor }]} />
                ))
            }
          </TouchableOpacity>
        )}

        {/* Botón paleta — cambiar color de acento */}
        <TouchableOpacity
          style={[styles.paletteBtn, showColorPicker && { borderWidth: 1, borderColor: accentColor }]}
          onPress={() => setShowColorPicker(v => !v)}
          activeOpacity={0.75}
        >
          <MaterialIcons name="palette" size={16} color={showColorPicker ? accentColor : 'rgba(255,255,255,0.7)'} />
        </TouchableOpacity>

        {/* Botón ocultar HUD */}
        <TouchableOpacity style={styles.hideUIBtn} onPress={toggleHUD} activeOpacity={0.75}>
          <MaterialIcons name="visibility-off" size={16} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>

        {/* Panel selector de color */}
        {showColorPicker && (
          <View style={styles.colorPickerPanel}>
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
        )}

        <View style={styles.pageIndicator}>
          <Text style={styles.pageIndicatorText}>{current + 1} / {pages.length}</Text>
        </View>

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

        {/* Botón siguiente capítulo — solo al final del último párrafo de la última página */}
        {isLastPage && paraComplete && paraIndex >= paragraphs.length - 1 && nextChapter && (
          <TouchableOpacity
            style={[styles.nextChapterBtn, { borderColor: accentColor, backgroundColor: hexToRgba(accentColor, 0.15) }]}
            activeOpacity={0.8}
            onPress={() =>
              router.push(
                `/reader/page-moderno?storyId=${storyId}&chapterId=${nextChapter.id}&pageIndex=0`
              )
            }
          >
            <MaterialIcons name="skip-next" size={16} color={accentColor} />
            <Text style={[styles.nextChapterText, { color: accentColor }]} numberOfLines={1}>
              {nextChapter.title}
            </Text>
            <MaterialIcons name="chevron-right" size={16} color={accentColor} />
          </TouchableOpacity>
        )}

      </Animated.View>

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
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 14,
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
    letterSpacing: 0.8,
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
  colorPickerPanel: {
    position: 'absolute',
    top: 58,
    left: 16,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.80)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '45%',
  },
  charLabelText: {
    fontFamily: RETRO_FONT,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
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
