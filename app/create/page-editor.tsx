import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  collection, addDoc, doc, updateDoc, getDoc, getDocs,
  deleteField, query, orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { uploadLocalFile } from '@/services/media';
import { sortChapters } from '@/services/stories';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS, type SharedValue } from 'react-native-reanimated';
// TouchableOpacity de RNGH: necesario para que los botones dentro del ScrollView funcionen
// correctamente junto con los GestureDetectors del preview.
// Para los TextInput de nombre usamos refs + .focus() programático que bypasea el sistema de gestos.
import { GestureDetector, Gesture, TouchableOpacity } from 'react-native-gesture-handler';
import {
  REF_SCREEN, FONT_SIZES, TEXT_BOX, CHAR_LABEL, BG_BLUR_DEFAULT, BG_BLUR_MAX, BG_BLUR_PRESETS,
  MUSIC_VOLUME_MIN, MUSIC_VOLUME_MAX, MUSIC_VOLUME_STEP, SFX_VOLUME_MAX,
  musicPlaybackVolume, sfxPlaybackVolume,
  charLabelPos, charLabelSideStyle,
  type TextSize,
} from '@/constants/reader-layout';

// ─── Tipos ───────────────────────────────────────────────────────────────────
type ImageAnchor   = 'top' | 'center' | 'bottom';
type ImageFit      = 'cover' | 'contain';
type MusicMode     = 'inherit' | 'play' | 'silence';
type CharMode      = 'inherit' | 'show' | 'hide';
type TextBoxLayout = { x: number; y: number; w: number; h: number };

const DEFAULT_TB: TextBoxLayout = { x: 11, y: 23, w: 78, h: 53 };

// ─── Enlace de texto ──────────────────────────────────────────────────────────
type PageLink = {
  word: string;
  color: string;
  targetPageId?: string;       // destino (enlaces antiguos solo tienen targetPageIndex)
  targetPageIndex: number;     // número al crear el enlace: etiqueta y compatibilidad
  targetChapterId?: string;    // undefined = mismo capítulo
  targetChapterTitle?: string; // para mostrar en el chip
};

type ChapterPageOption = {
  chapterId: string;
  chapterTitle: string;
  pageId: string;
  pageOrder: number;  // número visible (1-based)
  pageIndex: number;  // índice 0-based en el array de páginas
  pageText: string;
};

const LINK_COLORS = [
  { hex: '#FFD700', label: 'Amarillo' },
  { hex: '#FF69B4', label: 'Rosa'     },
  { hex: '#00C878', label: 'Verde'    },
  { hex: '#4A90D9', label: 'Azul'     },
  { hex: '#FF6B35', label: 'Naranja'  },
  { hex: '#9B59B6', label: 'Morado'   },
  { hex: '#FF4444', label: 'Rojo'     },
];

const TEXT_SIZE_OPTIONS: { value: TextSize | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'xs',   label: 'XS'   },
  { value: 'sm',   label: 'S'    },
  { value: 'md',   label: 'M'    },
  { value: 'lg',   label: 'L'    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeMediaUrl(url: string): string {
  const driveFile  = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFile)  return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;
  const driveOpen  = url.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (driveOpen)  return `https://drive.google.com/uc?export=download&id=${driveOpen[1]}`;
  const driveShort = url.match(/drive\.google\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (driveShort) return `https://drive.google.com/uc?export=download&id=${driveShort[1]}`;
  return url.trim();
}

function confirmAction(title: string, message: string, confirmText: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if ((window as any).confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    AppAlert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: confirmText, style: 'destructive', onPress: onConfirm },
    ]);
  }
}

// Nombre legible de un archivo a partir de su URL
const fileNameFromUrl = (url: string, fallback: string) => {
  try { return decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? fallback); }
  catch { return fallback; }
};

// Fila "Volumen: − 100% +  [Escuchar]" (música y efecto de sonido).
// Ajusta cómo suena en el lector; no modifica el archivo de audio.
function VolumeRow({ value, min, max, onStep, playing, onTogglePlay }: {
  value: number; min: number; max: number;
  onStep: (delta: number) => void;
  playing: boolean; onTogglePlay: () => void;
}) {
  return (
    <View style={styles.anchorRow}>
      <Text style={styles.anchorLabel}>Volumen:</Text>
      <TouchableOpacity
        style={[styles.blurStepBtn, value <= min && { opacity: 0.35 }]}
        onPress={() => onStep(-MUSIC_VOLUME_STEP)}
        disabled={value <= min}
        hitSlop={6}
      >
        <MaterialIcons name="volume-down" size={14} color={Colors.textSecondary} />
      </TouchableOpacity>
      <Text style={[styles.blurValue, { minWidth: 44 }]}>{Math.round(value * 100)}%</Text>
      <TouchableOpacity
        style={[styles.blurStepBtn, value >= max && { opacity: 0.35 }]}
        onPress={() => onStep(MUSIC_VOLUME_STEP)}
        disabled={value >= max}
        hitSlop={6}
      >
        <MaterialIcons name="volume-up" size={14} color={Colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.anchorBtn, playing && styles.anchorBtnActive, { marginLeft: 'auto' }]}
        onPress={onTogglePlay}
        activeOpacity={0.75}
      >
        <MaterialIcons name={playing ? 'stop' : 'play-arrow'} size={14} color={playing ? '#000' : Colors.textSecondary} />
        <Text style={[styles.anchorBtnText, playing && styles.anchorBtnTextActive]}>
          {playing ? 'Parar' : 'Escuchar'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────
export default function PageEditorScreen() {
  const router = useRouter();
  const { storyId, chapterId, pageId, pageOrder } = useLocalSearchParams<{
    storyId: string; chapterId: string; pageId?: string; pageOrder?: string;
  }>();

  const isEditing = !!pageId;
  const pageNum   = Number(pageOrder ?? 1);

  // ── Estado de página ──────────────────────────────────────────────────────
  const [loading, setLoading]           = useState(isEditing);
  const [saving, setSaving]             = useState(false);
  const [pageText, setPageText]         = useState('');
  const [bgUri, setBgUri]               = useState<string | null>(null);
  const [bgUrl, setBgUrl]               = useState('');
  const [imageAnchor, setImageAnchor]   = useState<ImageAnchor>('center');
  const [imageFit, setImageFit]         = useState<ImageFit>('cover');
  const [bgBlur, setBgBlur]             = useState(BG_BLUR_DEFAULT);
  const [uploadingBg, setUploadingBg]   = useState(false);
  const [imageSource, setImageSource]   = useState<'file' | 'url'>('file');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [musicMode, setMusicMode]       = useState<MusicMode>('inherit');
  const [editMusicUrl, setEditMusicUrl] = useState('');
  const [musicFileName, setMusicFileName] = useState('');
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [musicSource, setMusicSource]   = useState<'file' | 'url'>('file');
  const [musicUrlInput, setMusicUrlInput] = useState('');
  const [musicVolume, setMusicVolume]   = useState(1);       // ajuste del autor (1 = 100 %)
  const [previewingMusic, setPreviewingMusic] = useState(false);
  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const [textSize, setTextSize]         = useState<TextSize | undefined>(undefined);
  const [tbLayout, setTbLayout]         = useState<TextBoxLayout>(DEFAULT_TB);
  // Ancho real de la preview: escala del lector (pantalla de referencia) a la preview
  const [pvWidth, setPvWidth]           = useState(390);
  const [links, setLinks]               = useState<PageLink[]>([]);
  // "Al pasar la página": saltar a otra página del capítulo (se guarda su id)
  const [jumpEnabled, setJumpEnabled]   = useState(false);
  const [nextPageInput, setNextPageInput] = useState('');
  // Ids de las páginas del capítulo en orden: traduce número de página ↔ id
  const [chapterPageIds, setChapterPageIds] = useState<string[]>([]);
  // Efecto de sonido (se reproduce una vez al llegar a la página; no se hereda)
  const [sfxUrl, setSfxUrl]             = useState('');
  const [sfxFileName, setSfxFileName]   = useState('');
  const [uploadingSfx, setUploadingSfx] = useState(false);
  const [sfxSource, setSfxSource]       = useState<'file' | 'url'>('file');
  const [sfxUrlInput, setSfxUrlInput]   = useState('');
  const [sfxVolume, setSfxVolume]       = useState(1);       // ajuste del autor (1 = 100 %)
  const [previewingSfx, setPreviewingSfx] = useState(false);
  const sfxPreviewRef = useRef<Audio.Sound | null>(null);
  // Cambia al recuperar un borrador: fuerza a recrear los campos de nombre (no controlados)
  const [draftNonce, setDraftNonce]     = useState(0);
  // Personajes
  const [leftCharMode, setLeftCharMode]   = useState<CharMode>('inherit');
  const [leftCharName, setLeftCharName]   = useState('');
  const [rightCharMode, setRightCharMode] = useState<CharMode>('inherit');
  const [rightCharName, setRightCharName] = useState('');
  const [leftCharPos,  setLeftCharPos]    = useState({ x: 11, y: 16 });
  const [rightCharPos, setRightCharPos]   = useState({ x: 62, y: 16 });
  // side: 0=libre, 1=arriba, 2=abajo, 3=izquierda, 4=derecha del bloque de texto
  const [leftCharSide,  setLeftCharSide]  = useState(1);
  const [rightCharSide, setRightCharSide] = useState(1);
  // Guard para evitar doble carga de opciones
  const loadingPageOptionsRef = useRef(false);
  // Refs para foco programático de TextInputs de nombre (bypasea el sistema de gestos de RNGH en Android)
  const lcInputRef = useRef<TextInput>(null);
  const rcInputRef = useRef<TextInput>(null);

  // Modo enlace
  const [linkMode, setLinkMode]                       = useState(false);
  const [pendingWord, setPendingWord]                 = useState('');
  const [pendingLinkColor, setPendingLinkColor]       = useState('#FFD700');
  const [pendingLinkTarget, setPendingLinkTarget]     = useState<ChapterPageOption | null>(null);
  // Picker de página destino
  const [pageOptions, setPageOptions]                 = useState<ChapterPageOption[]>([]);
  const [loadingPageOptions, setLoadingPageOptions]   = useState(false);
  const [pagePickerOpen, setPagePickerOpen]           = useState(false);
  const [pagePickerSearch, setPagePickerSearch]       = useState('');
  const [creatingNewPage, setCreatingNewPage]         = useState(false);
  const [currentChapterPublished, setCurrentChapterPublished] = useState(false);

  // ── Shared values para el cuadro redimensionable ──────────────────────────
  const tbX  = useSharedValue(DEFAULT_TB.x);
  const tbY  = useSharedValue(DEFAULT_TB.y);
  const tbW  = useSharedValue(DEFAULT_TB.w);
  const tbH  = useSharedValue(DEFAULT_TB.h);
  const tbSX = useSharedValue(DEFAULT_TB.x);
  const tbSY = useSharedValue(DEFAULT_TB.y);
  const tbSW = useSharedValue(DEFAULT_TB.w);
  const tbSH = useSharedValue(DEFAULT_TB.h);
  const pvW  = useSharedValue(300);
  const pvH  = useSharedValue(200);

  // ── Shared values para etiquetas de personaje (posición en %) ─────────────
  const lcX         = useSharedValue(11);
  const lcY         = useSharedValue(16);
  const lcSX        = useSharedValue(11);
  const lcSY        = useSharedValue(16);
  const lcBX        = useSharedValue(11); // posición al empezar a mover/redimensionar el bloque
  const lcBY        = useSharedValue(16);
  const lcSide      = useSharedValue(1); // 0=libre,1=arriba,2=abajo,3=izq,4=der
  const lcStartSide = useSharedValue(0); // side al inicio del gesto actual
  const lcLabelW    = useSharedValue(80); // tamaño real del label (px), medido en onLayout
  const lcLabelH    = useSharedValue(13);
  const rcX         = useSharedValue(62);
  const rcY         = useSharedValue(16);
  const rcSX        = useSharedValue(62);
  const rcSY        = useSharedValue(16);
  const rcBX        = useSharedValue(62);
  const rcBY        = useSharedValue(16);
  const rcSide      = useSharedValue(1);
  const rcStartSide = useSharedValue(0);
  const rcLabelW    = useSharedValue(80);
  const rcLabelH    = useSharedValue(13);

  const tbAnimStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left:   (tbX.value / 100) * pvW.value,
    top:    (tbY.value / 100) * pvH.value,
    width:  (tbW.value / 100) * pvW.value,
    height: (tbH.value / 100) * pvH.value,
  }));

  // ── Geometría de etiquetas (worklets) ──────────────────────────────────────
  // Posición en px de una etiqueta según su side, con el eje libre limitado al bloque.
  const labelPx = (side: number, x: number, y: number, lW: number, lH: number) => {
    'worklet';
    return charLabelPos(
      side,
      (x / 100) * pvW.value, (y / 100) * pvH.value,
      lW, lH,
      (tbX.value / 100) * pvW.value,
      (tbY.value / 100) * pvH.value,
      ((tbX.value + tbW.value) / 100) * pvW.value,
      ((tbY.value + tbH.value) / 100) * pvH.value,
    );
  };

  // Limita el eje libre de una etiqueta pegada para que no sobresalga del bloque (en %).
  const clampToBox = (side: number, x: number, y: number, lW: number, lH: number) => {
    'worklet';
    const p = labelPx(side, x, y, lW, lH);
    return {
      x: side === 1 || side === 2 ? (p.left / pvW.value) * 100 : x,
      y: side === 3 || side === 4 ? (p.top  / pvH.value) * 100 : y,
    };
  };

  // Desplaza una etiqueta pegada junto con el bloque (dx/dy en %) y la mantiene dentro.
  const followBox = (side: number, x: number, y: number, lW: number, lH: number, dx: number, dy: number) => {
    'worklet';
    if (side === 1 || side === 2) return clampToBox(side, x + dx, y, lW, lH);
    if (side === 3 || side === 4) return clampToBox(side, x, y + dy, lW, lH);
    return { x, y };
  };

  const labelAnimStyle = (side: number, x: number, y: number, lW: number, lH: number) => {
    'worklet';
    const { left, top } = labelPx(side, x, y, lW, lH);
    return {
      position: 'absolute' as const,
      left, top,
      ...charLabelSideStyle(side, CHAR_LABEL.radius * (pvW.value / REF_SCREEN.width)),
    };
  };

  const lcAnimStyle = useAnimatedStyle(() =>
    labelAnimStyle(lcSide.value, lcX.value, lcY.value, lcLabelW.value, lcLabelH.value));
  const rcAnimStyle = useAnimatedStyle(() =>
    labelAnimStyle(rcSide.value, rcX.value, rcY.value, rcLabelW.value, rcLabelH.value));

  const syncTbToState = useCallback((x: number, y: number, w: number, h: number) => {
    setTbLayout({ x, y, w, h });
  }, []);

  const syncLcPos = useCallback((x: number, y: number, side: number) => {
    setLeftCharPos({ x, y });
    setLeftCharSide(side);
  }, []);
  const syncRcPos = useCallback((x: number, y: number, side: number) => {
    setRightCharPos({ x, y });
    setRightCharSide(side);
  }, []);

  const tbGestures = useMemo(() => {
    const make = (type: string) => Gesture.Pan()
      .minDistance(4)  // no activar en taps — el gesto solo empieza con movimiento real
      .onBegin(() => {
        'worklet';
        tbSX.value = tbX.value; tbSY.value = tbY.value;
        tbSW.value = tbW.value; tbSH.value = tbH.value;
        lcBX.value = lcX.value; lcBY.value = lcY.value;
        rcBX.value = rcX.value; rcBY.value = rcY.value;
      })
      .onUpdate((e) => {
        'worklet';
        const dx = (e.translationX / pvW.value) * 100;
        const dy = (e.translationY / pvH.value) * 100;
        let x = tbSX.value, y = tbSY.value, w = tbSW.value, h = tbSH.value;
        if (type === 'move') { x += dx; y += dy; }
        else {
          if (type === 'e' || type === 'ne' || type === 'se') w += dx;
          if (type === 'w' || type === 'nw' || type === 'sw') { x += dx; w -= dx; }
          if (type === 's' || type === 'se' || type === 'sw') h += dy;
          if (type === 'n' || type === 'ne' || type === 'nw') { y += dy; h -= dy; }
        }
        w = Math.max(18, w); h = Math.max(12, h);
        x = Math.max(0, Math.min(100 - w, x));
        y = Math.max(0, Math.min(100 - h, y));
        tbX.value = x; tbY.value = y; tbW.value = w; tbH.value = h;

        // Auto-despegue: si el bloque se hace más pequeño que el label → side = 0 (libre)
        // Para sides 1/2 (arriba/abajo): el label se extiende horizontalmente → compara tbW
        // Para sides 3/4 (izq/der, rotado): la extensión visual del label = lcLabelW → compara tbH
        const tbWpx = (w / 100) * pvW.value;
        const tbHpx = (h / 100) * pvH.value;
        if ((lcSide.value === 1 || lcSide.value === 2) && tbWpx < lcLabelW.value) lcSide.value = 0;
        if ((lcSide.value === 3 || lcSide.value === 4) && tbHpx < lcLabelW.value) lcSide.value = 0;
        if ((rcSide.value === 1 || rcSide.value === 2) && tbWpx < rcLabelW.value) rcSide.value = 0;
        if ((rcSide.value === 3 || rcSide.value === 4) && tbHpx < rcLabelW.value) rcSide.value = 0;

        // Las etiquetas pegadas acompañan al bloque y se mantienen dentro de sus bordes
        const bdx = x - tbSX.value, bdy = y - tbSY.value;
        const lp = followBox(lcSide.value, lcBX.value, lcBY.value, lcLabelW.value, lcLabelH.value, bdx, bdy);
        lcX.value = lp.x; lcY.value = lp.y;
        const rp = followBox(rcSide.value, rcBX.value, rcBY.value, rcLabelW.value, rcLabelH.value, bdx, bdy);
        rcX.value = rp.x; rcY.value = rp.y;
      })
      .onFinalize(() => {
        'worklet';
        runOnJS(syncTbToState)(tbX.value, tbY.value, tbW.value, tbH.value);
        // Sincronizar sides de labels (pueden haberse auto-despegado arriba)
        runOnJS(syncLcPos)(lcX.value, lcY.value, lcSide.value);
        runOnJS(syncRcPos)(rcX.value, rcY.value, rcSide.value);
      });
    return {
      move: make('move'),
      n: make('n'), s: make('s'), e: make('e'), w: make('w'),
      ne: make('ne'), nw: make('nw'), se: make('se'), sw: make('sw'),
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTbShared = (l: TextBoxLayout) => {
    tbX.value = l.x; tbY.value = l.y; tbW.value = l.w; tbH.value = l.h;
  };
  const applyLcShared = (pos: { x: number; y: number }) => { lcX.value = pos.x; lcY.value = pos.y; };
  const applyRcShared = (pos: { x: number; y: number }) => { rcX.value = pos.x; rcY.value = pos.y; };

  const charGestures = useMemo(() => {
    // ── Detecta el side al soltar el label ────────────────────────────────────
    // px,py = posición top-left del label en %. Se usa su CENTRO: el usuario arrastra
    // hacia un lado del bloque, no hacia una esquina concreta.
    // Zona de snap: 20% alrededor de cada borde; gana el borde más cercano al centro.
    // Si la etiqueta no cabe a lo largo de ese borde, se queda libre.
    const computeSide = (px: number, py: number, lW: number, lH: number): number => {
      'worklet';
      const cx = px + (lW / pvW.value) * 50;
      const cy = py + (lH / pvH.value) * 50;

      const x1 = tbX.value, x2 = tbX.value + tbW.value;
      const y1 = tbY.value, y2 = tbY.value + tbH.value;

      const MARGIN = 20;
      if (cx < x1 - MARGIN || cx > x2 + MARGIN) return 0;
      if (cy < y1 - MARGIN || cy > y2 + MARGIN) return 0;

      const dTop    = Math.abs(cy - y1);
      const dBottom = Math.abs(cy - y2);
      const dLeft   = Math.abs(cx - x1);
      const dRight  = Math.abs(cx - x2);
      const minD    = Math.min(dTop, dBottom, dLeft, dRight);
      const side = minD === dTop ? 1 : minD === dBottom ? 2 : minD === dLeft ? 3 : 4;

      const tbWpx = (tbW.value / 100) * pvW.value;
      const tbHpx = (tbH.value / 100) * pvH.value;
      if ((side === 1 || side === 2) && lW > tbWpx) return 0;
      if ((side === 3 || side === 4) && lW > tbHpx) return 0;
      return side;
    };

    type LabelValues = {
      x: SharedValue<number>; y: SharedValue<number>;
      sx: SharedValue<number>; sy: SharedValue<number>;
      side: SharedValue<number>; startSide: SharedValue<number>;
      w: SharedValue<number>; h: SharedValue<number>;
    };

    const make = (v: LabelValues, sync: (x: number, y: number, side: number) => void) => Gesture.Pan()
      .minDistance(4)
      .onBegin(() => {
        'worklet';
        const ss = v.side.value;
        v.startSide.value = ss;
        // Partir de la posición que se ve en pantalla (en las pegadas se deriva del bloque)
        if (ss !== 0) {
          const p = labelPx(ss, v.x.value, v.y.value, v.w.value, v.h.value);
          v.x.value = (p.left / pvW.value) * 100;
          v.y.value = (p.top  / pvH.value) * 100;
        }
        v.sx.value = v.x.value;
        v.sy.value = v.y.value;
        // Sin rotación mientras se arrastra: se verá siempre horizontal
        v.side.value = 0;
      })
      .onUpdate(e => {
        'worklet';
        const dx = (e.translationX / pvW.value) * 100;
        const dy = (e.translationY / pvH.value) * 100;
        const rawX = v.sx.value + dx;
        const rawY = v.sy.value + dy;
        const ss   = v.startSide.value;

        if (ss === 0) {
          v.x.value = Math.max(0, Math.min(95, rawX));
          v.y.value = Math.max(0, Math.min(95, rawY));
          return;
        }
        // Pegada: se desliza a lo largo del borde sin salirse del bloque.
        // Arrastrar > 14% en perpendicular la despega.
        const perpDist = (ss === 1 || ss === 2) ? Math.abs(dy) : Math.abs(dx);
        if (perpDist >= 14) {
          v.x.value = Math.max(0, Math.min(95, rawX));
          v.y.value = Math.max(0, Math.min(95, rawY));
          v.startSide.value = 0; // ya libre: si vuelve a estar cerca se re-pegará al soltar
        } else if (ss === 1 || ss === 2) {
          v.x.value = clampToBox(ss, rawX, v.y.value, v.w.value, v.h.value).x;
        } else {
          v.y.value = clampToBox(ss, v.x.value, rawY, v.w.value, v.h.value).y;
        }
      })
      .onFinalize(() => {
        'worklet';
        // Detectar el side final, restaurar la rotación y dejarla dentro del bloque
        const s = computeSide(v.x.value, v.y.value, v.w.value, v.h.value);
        const c = clampToBox(s, v.x.value, v.y.value, v.w.value, v.h.value);
        v.x.value = c.x;
        v.y.value = c.y;
        v.side.value = s;
        runOnJS(sync)(c.x, c.y, s);
      });

    return {
      left: make({
        x: lcX, y: lcY, sx: lcSX, sy: lcSY, side: lcSide, startSide: lcStartSide, w: lcLabelW, h: lcLabelH,
      }, syncLcPos),
      right: make({
        x: rcX, y: rcY, sx: rcSX, sy: rcSY, side: rcSide, startSide: rcStartSide, w: rcLabelW, h: rcLabelH,
      }, syncRcPos),
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Centrar el bloque de texto sin cambiar su tamaño ──────────────────────
  // Las etiquetas pegadas se mueven con él (se calcula con el bloque nuevo de forma
  // explícita: leer un shared value justo después de escribirlo en JS no es fiable).
  const centerTextBox = () => {
    const W = pvW.value, H = pvH.value;
    const w = tbW.value, h = tbH.value;
    const x = (100 - w) / 2, y = (100 - h) / 2;
    const dx = x - tbX.value, dy = y - tbY.value;

    const follow = (side: number, lx: number, ly: number, lW: number, lH: number) => {
      if (side === 0) return { x: lx, y: ly };
      const fx = side === 1 || side === 2 ? lx + dx : lx;
      const fy = side === 3 || side === 4 ? ly + dy : ly;
      const p = charLabelPos(
        side, (fx / 100) * W, (fy / 100) * H, lW, lH,
        (x / 100) * W, (y / 100) * H, ((x + w) / 100) * W, ((y + h) / 100) * H,
      );
      return {
        x: side === 1 || side === 2 ? (p.left / W) * 100 : fx,
        y: side === 3 || side === 4 ? (p.top  / H) * 100 : fy,
      };
    };
    const lp = follow(lcSide.value, lcX.value, lcY.value, lcLabelW.value, lcLabelH.value);
    const rp = follow(rcSide.value, rcX.value, rcY.value, rcLabelW.value, rcLabelH.value);

    applyTbShared({ x, y, w, h });
    setTbLayout({ x, y, w, h });
    applyLcShared(lp); syncLcPos(lp.x, lp.y, lcSide.value);
    applyRcShared(rp); syncRcPos(rp.x, rp.y, rcSide.value);
  };

  // ── Elegir modo de nombre: al pasar a "Nombre" se enfoca el campo ──────────
  // Solo por acción del usuario: al abrir una página guardada no salta el teclado.
  const chooseLeftCharMode = (mode: CharMode) => {
    setLeftCharMode(mode);
    if (mode === 'show') setTimeout(() => lcInputRef.current?.focus(), 80);
  };
  const chooseRightCharMode = (mode: CharMode) => {
    setRightCharMode(mode);
    if (mode === 'show') setTimeout(() => rcInputRef.current?.focus(), 80);
  };

  // ── Cargar página si estamos editando ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [snap, pagesSnap] = await Promise.all([
          isEditing && pageId
            ? getDoc(doc(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages', pageId as string))
            : Promise.resolve(null),
          getDocs(query(
            collection(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages'),
            orderBy('order', 'asc'),
          )),
        ]);
        const ids = pagesSnap.docs.map(d => d.id);
        setChapterPageIds(ids);
        if (!snap || !snap.exists()) return;
        const p = snap.data();
        setPageText(p.text ?? '');
        setBgUri(p.backgroundUrl || null);
        setBgUrl(p.backgroundUrl || '');
        setImageAnchor(p.imageAnchor ?? 'center');
        setImageFit(p.imageFit ?? 'cover');
        setBgBlur(p.bgBlur ?? BG_BLUR_DEFAULT);
        setTextSize(p.textSize ?? undefined);
        const tbl = p.textBoxLayout ?? DEFAULT_TB;
        setTbLayout(tbl); applyTbShared(tbl);
        if (p.musicUrl === undefined)    { setMusicMode('inherit'); }
        else if (p.musicUrl === null)    { setMusicMode('silence'); }
        else { setMusicMode('play'); setMusicVolume(p.musicVolume ?? 1); setEditMusicUrl(p.musicUrl); setMusicFileName(decodeURIComponent(p.musicUrl.split('/').pop()?.split('?')[0] ?? 'Pista')); }
        // Enlaces antiguos del mismo capítulo: se les asigna el id de su página destino
        setLinks((p.links ?? []).map((l: PageLink) =>
          l.targetPageId || l.targetChapterId || ids[l.targetPageIndex] === undefined
            ? l
            : { ...l, targetPageId: ids[l.targetPageIndex] }
        ));
        // "Al pasar la página": por id, o por número en páginas antiguas
        const jumpIdx = p.nextPageId ? ids.indexOf(p.nextPageId)
                      : typeof p.nextPageIndex === 'number' ? p.nextPageIndex
                      : -1;
        if (jumpIdx >= 0) { setJumpEnabled(true); setNextPageInput(String(jumpIdx + 1)); }
        setSfxUrl(p.sfxUrl ?? '');
        setSfxVolume(p.sfxVolume ?? 1);
        if (p.sfxUrl) setSfxFileName(decodeURIComponent(p.sfxUrl.split('/').pop()?.split('?')[0] ?? 'Efecto'));
        // Personajes
        if (p.leftChar === undefined) { setLeftCharMode('inherit'); }
        else if (p.leftChar === '')   { setLeftCharMode('hide'); }
        else { setLeftCharMode('show'); setLeftCharName(p.leftChar); }
        if (p.rightChar === undefined) { setRightCharMode('inherit'); }
        else if (p.rightChar === '')   { setRightCharMode('hide'); }
        else { setRightCharMode('show'); setRightCharName(p.rightChar); }
        if (p.leftCharPos)  { setLeftCharPos(p.leftCharPos);  applyLcShared(p.leftCharPos); }
        if (p.rightCharPos) { setRightCharPos(p.rightCharPos); applyRcShared(p.rightCharPos); }
        const ls = p.leftCharSide  ?? 1;
        const rs = p.rightCharSide ?? 1;
        setLeftCharSide(ls);  lcSide.value = ls;
        setRightCharSide(rs); rcSide.value = rs;
      } catch (e) { console.error('Error cargando página:', e); }
      finally     { setLoading(false); }
    })();
  }, [pageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers de imagen ────────────────────────────────────────────────────
  // ── Cargar opciones de página (todos los capítulos, en paralelo) ─────────
  const loadPageOptions = useCallback(async () => {
    if (!storyId || loadingPageOptionsRef.current || pageOptions.length > 0) return;
    loadingPageOptionsRef.current = true;
    setLoadingPageOptions(true);
    try {
      const chaptersSnap = await getDocs(
        collection(db, 'stories', storyId as string, 'chapters')
      );
      const chapterDocs = sortChapters(chaptersSnap.docs.map(d => ({
        doc: d, order: d.data().order as number | undefined, createdAt: d.data().createdAt as string | undefined,
      }))).map(c => c.doc);
      const perChapter = await Promise.all(
        chapterDocs.map(async chDoc => {
          const chTitle = (chDoc.data().title as string) ?? 'Capítulo';
          const pagesSnap = await getDocs(
            collection(db, 'stories', storyId as string, 'chapters', chDoc.id, 'pages')
          );
          // pageIndex es la posición de la página ordenada por 'order', que es
          // como el lector numera las páginas al seguir un enlace.
          return pagesSnap.docs
            .map((pDoc, idx) => ({ pDoc, order: (pDoc.data().order as number) ?? idx + 1 }))
            .sort((a, b) => a.order - b.order)
            .map(({ pDoc, order }, idx): ChapterPageOption => ({
              chapterId: chDoc.id,
              chapterTitle: chTitle,
              pageId: pDoc.id,
              pageOrder: order,
              pageIndex: idx,
              pageText: (pDoc.data().text as string) ?? '',
            }));
        })
      );
      setPageOptions(perChapter.flat());
    } catch (e) {
      console.error('Error cargando opciones de página:', e);
    } finally {
      loadingPageOptionsRef.current = false;
      setLoadingPageOptions(false);
    }
  }, [storyId, pageOptions.length]); // eslint-disable-line

  const openPagePicker = async () => {
    setPagePickerOpen(true);
    setPagePickerSearch('');
    loadPageOptions();
    // Comprobar estado publicado cada vez que se abre el picker
    try {
      const chSnap = await getDoc(
        doc(db, 'stories', storyId as string, 'chapters', chapterId as string)
      );
      setCurrentChapterPublished(chSnap.data()?.published === true);
    } catch (e) {
      console.error('Error comprobando estado del capítulo:', e);
    }
  };

  const handleCreateNewPage = async () => {
    if (creatingNewPage) return;
    setCreatingNewPage(true);
    try {
      // Título del capítulo actual
      let chapterTitle = pageOptions.find(p => p.chapterId === chapterId)?.chapterTitle;
      if (!chapterTitle) {
        const chSnap = await getDoc(doc(db, 'stories', storyId as string, 'chapters', chapterId as string));
        chapterTitle = (chSnap.data()?.title as string) ?? 'Capítulo';
      }
      // Orden de la nueva página (al final del capítulo)
      const currentChapterPages = pageOptions.filter(p => p.chapterId === chapterId);
      const newOrder = currentChapterPages.length > 0
        ? Math.max(...currentChapterPages.map(p => p.pageOrder)) + 1
        : 1;

      const newRef = await addDoc(
        collection(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages'),
        { text: '', backgroundUrl: '', order: newOrder, createdAt: new Date().toISOString(), links: [] }
      );

      const newOption: ChapterPageOption = {
        chapterId: chapterId as string,
        chapterTitle,
        pageId: newRef.id,
        pageOrder: newOrder,
        pageIndex: currentChapterPages.length,
        pageText: '',
      };
      setPageOptions(prev => [...prev, newOption]);
      setChapterPageIds(prev => [...prev, newRef.id]);
      setPendingLinkTarget(newOption);
      setPagePickerOpen(false);
    } catch (e) {
      console.error('Error creando página:', e);
    } finally {
      setCreatingNewPage(false);
    }
  };

  const handleUseImageUrl = () => {
    if (!imageUrlInput.trim()) return;
    const url = normalizeMediaUrl(imageUrlInput);
    setBgUri(url); setBgUrl(url); setImageUrlInput('');
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { AppAlert.alert('Permiso denegado', 'Necesitamos acceso a tu galería.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      setBgUri(localUri);
      setUploadingBg(true);
      try {
        const filename  = `pages/${storyId}/${chapterId}/${Date.now()}.jpg`;
        const storageRef = ref(storage, filename);
        const blob: Blob = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload  = () => resolve(xhr.response);
          xhr.onerror = () => reject(new Error('No se pudo leer el archivo'));
          xhr.responseType = 'blob'; xhr.open('GET', localUri, true); xhr.send(null);
        });
        await uploadBytes(storageRef, blob);
        const url = await getDownloadURL(storageRef);
        setBgUrl(url); setBgUri(url);
      } catch (e: any) {
        AppAlert.alert('Error al subir', e?.message ?? 'Inténtalo de nuevo.');
        setBgUri(null); setBgUrl('');
      } finally { setUploadingBg(false); }
    }
  };

  // ── Handlers de música ────────────────────────────────────────────────────
  const handleUseMusicUrl = () => {
    if (!musicUrlInput.trim()) return;
    const url = normalizeMediaUrl(musicUrlInput);
    setEditMusicUrl(url); setMusicFileName(musicUrlInput.trim());
    setMusicMode('play'); setMusicUrlInput('');
  };

  const handlePickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setUploadingMusic(true);
        try {
          const ext = asset.name.split('.').pop() ?? 'mp3';
          const url = await uploadLocalFile(asset.uri, `music/${storyId}/${chapterId}/${Date.now()}.${ext}`);
          setEditMusicUrl(url); setMusicFileName(asset.name); setMusicMode('play');
        } catch (e: any) { AppAlert.alert('Error al subir música', e?.message ?? 'Inténtalo de nuevo.'); }
        finally { setUploadingMusic(false); }
      }
    } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo abrir el selector.'); }
  };

  // ── Escuchar la pista en el editor (con el volumen elegido) ───────────────
  const stopMusicPreview = useCallback(() => {
    const s = previewSoundRef.current;
    previewSoundRef.current = null;
    setPreviewingMusic(false);
    s?.stopAsync().catch(() => {});
    s?.unloadAsync().catch(() => {});
  }, []);

  const toggleMusicPreview = async () => {
    if (previewingMusic) { stopMusicPreview(); return; }
    if (!editMusicUrl) return;
    setPreviewingMusic(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: editMusicUrl },
        { shouldPlay: true, isLooping: true, volume: musicPlaybackVolume(musicVolume) },
      );
      previewSoundRef.current = sound;
    } catch (e: any) {
      setPreviewingMusic(false);
      AppAlert.alert('No se pudo reproducir', e?.message ?? 'Comprueba el archivo o el enlace.');
    }
  };

  // El volumen se aplica en vivo mientras se escucha
  useEffect(() => {
    previewSoundRef.current?.setVolumeAsync(musicPlaybackVolume(musicVolume)).catch(() => {});
  }, [musicVolume]);
  // Parar al cambiar de pista o de modo, y al salir de la pantalla (también al ir a "Probar")
  useEffect(() => { stopMusicPreview(); }, [editMusicUrl, musicMode, stopMusicPreview]);

  const stepVolume = (v: number, delta: number, max: number) =>
    Math.round(Math.min(max, Math.max(MUSIC_VOLUME_MIN, v + delta)) * 10) / 10;
  const changeMusicVolume = (delta: number) => setMusicVolume(v => stepVolume(v, delta, MUSIC_VOLUME_MAX));
  const changeSfxVolume   = (delta: number) => setSfxVolume(v => stepVolume(v, delta, SFX_VOLUME_MAX));

  // ── Escuchar el efecto de sonido (una vez, con el volumen elegido) ─────────
  const stopSfxPreview = useCallback(() => {
    const s = sfxPreviewRef.current;
    sfxPreviewRef.current = null;
    setPreviewingSfx(false);
    s?.stopAsync().catch(() => {});
    s?.unloadAsync().catch(() => {});
  }, []);

  const toggleSfxPreview = async () => {
    if (previewingSfx) { stopSfxPreview(); return; }
    if (!sfxUrl) return;
    setPreviewingSfx(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: sfxUrl },
        { shouldPlay: true, volume: sfxPlaybackVolume(sfxVolume) },
      );
      sfxPreviewRef.current = sound;
      sound.setOnPlaybackStatusUpdate(status => {
        if (status.isLoaded && status.didJustFinish) stopSfxPreview();
      });
    } catch (e: any) {
      setPreviewingSfx(false);
      AppAlert.alert('No se pudo reproducir', e?.message ?? 'Comprueba el archivo o el enlace.');
    }
  };
  useEffect(() => {
    sfxPreviewRef.current?.setVolumeAsync(sfxPlaybackVolume(sfxVolume)).catch(() => {});
  }, [sfxVolume]);
  useEffect(() => { stopSfxPreview(); }, [sfxUrl, stopSfxPreview]);

  // Al salir de la pantalla (también al ir a "Probar") se para lo que esté sonando
  useFocusEffect(useCallback(() => () => { stopMusicPreview(); stopSfxPreview(); }, [stopMusicPreview, stopSfxPreview]));

  // ── Handlers de efecto de sonido ──────────────────────────────────────────
  const handleUseSfxUrl = () => {
    if (!sfxUrlInput.trim()) return;
    setSfxUrl(normalizeMediaUrl(sfxUrlInput));
    setSfxFileName(sfxUrlInput.trim());
    setSfxUrlInput('');
  };

  const handlePickSfx = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      setUploadingSfx(true);
      try {
        const ext = asset.name.split('.').pop() ?? 'mp3';
        const url = await uploadLocalFile(asset.uri, `sfx/${storyId}/${chapterId}/${Date.now()}.${ext}`);
        setSfxUrl(url); setSfxFileName(asset.name);
      } catch (e: any) { AppAlert.alert('Error al subir el sonido', e?.message ?? 'Inténtalo de nuevo.'); }
      finally { setUploadingSfx(false); }
    } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo abrir el selector.'); }
  };

  // ── Cambios sin guardar ───────────────────────────────────────────────────
  // Instantánea de todo lo que se guarda; si difiere de la inicial hay cambios.
  const snapshot = JSON.stringify({
    pageText, bgUrl, imageAnchor, imageFit, bgBlur, musicMode, musicVolume, editMusicUrl, textSize, tbLayout, links,
    jumpEnabled, nextPageInput, sfxUrl, sfxVolume,
    leftCharMode, leftCharName, rightCharMode, rightCharName,
    leftCharPos, rightCharPos, leftCharSide, rightCharSide,
  });
  const initialSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!loading && initialSnapshotRef.current === null) initialSnapshotRef.current = snapshot;
  }, [loading, snapshot]);
  const isDirty = initialSnapshotRef.current !== null && snapshot !== initialSnapshotRef.current;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;

  // ── Borrador automático ───────────────────────────────────────────────────
  // Mientras hay cambios sin guardar, la instantánea se guarda en el móvil. Si la app
  // se cierra, al volver a abrir la página se ofrece recuperarla.
  const draftKey = `immersa_page_draft:${storyId}:${chapterId}:${pageId ?? 'new'}`;
  const draftResolvedRef = useRef(false); // ya se comprobó (y respondió) si había borrador
  const draftCheckStartedRef = useRef(false);
  const clearDraft = () => { AsyncStorage.removeItem(draftKey).catch(() => {}); };

  const applyDraft = (d: any) => {
    setPageText(d.pageText ?? '');
    setBgUrl(d.bgUrl ?? ''); setBgUri(d.bgUrl || null);
    setImageAnchor(d.imageAnchor ?? 'center'); setImageFit(d.imageFit ?? 'cover');
    setBgBlur(d.bgBlur ?? BG_BLUR_DEFAULT);
    setMusicMode(d.musicMode ?? 'inherit'); setMusicVolume(d.musicVolume ?? 1);
    setEditMusicUrl(d.editMusicUrl ?? '');
    setMusicFileName(d.editMusicUrl ? fileNameFromUrl(d.editMusicUrl, 'Pista') : '');
    setTextSize(d.textSize ?? undefined);
    if (d.tbLayout) { setTbLayout(d.tbLayout); applyTbShared(d.tbLayout); }
    setLinks(d.links ?? []);
    setJumpEnabled(!!d.jumpEnabled); setNextPageInput(d.nextPageInput ?? '');
    setSfxUrl(d.sfxUrl ?? ''); setSfxVolume(d.sfxVolume ?? 1);
    setSfxFileName(d.sfxUrl ? fileNameFromUrl(d.sfxUrl, 'Efecto') : '');
    setLeftCharMode(d.leftCharMode ?? 'inherit');   setLeftCharName(d.leftCharName ?? '');
    setRightCharMode(d.rightCharMode ?? 'inherit'); setRightCharName(d.rightCharName ?? '');
    if (d.leftCharPos)  { setLeftCharPos(d.leftCharPos);   applyLcShared(d.leftCharPos); }
    if (d.rightCharPos) { setRightCharPos(d.rightCharPos); applyRcShared(d.rightCharPos); }
    const ls = d.leftCharSide ?? 1, rs = d.rightCharSide ?? 1;
    setLeftCharSide(ls);  lcSide.value = ls;
    setRightCharSide(rs); rcSide.value = rs;
    setDraftNonce(n => n + 1);
  };

  // Al terminar de cargar: ¿hay un borrador distinto de lo guardado?
  useEffect(() => {
    if (loading || initialSnapshotRef.current === null || draftCheckStartedRef.current) return;
    draftCheckStartedRef.current = true;
    const saved = initialSnapshotRef.current;
    (async () => {
      let raw: string | null = null;
      try { raw = await AsyncStorage.getItem(draftKey); } catch { /* sin borrador */ }
      if (!raw || raw === saved) { draftResolvedRef.current = true; if (raw) clearDraft(); return; }
      const restore = () => {
        try { applyDraft(JSON.parse(raw as string)); } catch { clearDraft(); }
        draftResolvedRef.current = true;
      };
      const discard = () => { clearDraft(); draftResolvedRef.current = true; };
      const message = 'Hay cambios de esta página que no llegaste a guardar. ¿Quieres recuperarlos?';
      if (Platform.OS === 'web') {
        if ((window as any).confirm(`Borrador sin guardar\n\n${message}`)) restore(); else discard();
      } else {
        AppAlert.alert('Borrador sin guardar', message, [
          { text: 'Descartar', style: 'destructive', onPress: discard },
          { text: 'Recuperar', onPress: restore },
        ], { cancelable: false });
      }
    })();
  }, [loading, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardar el borrador (con un pequeño retardo) mientras haya cambios
  useEffect(() => {
    if (!draftResolvedRef.current) return; // no pisar un borrador pendiente de respuesta
    if (!isDirty) { clearDraft(); return; }
    const t = setTimeout(() => { AsyncStorage.setItem(draftKey, snapshot).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [snapshot, isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Salir (flecha, botón atrás del móvil o gesto) con cambios → pedir confirmación
  const navigation = useNavigation();
  const allowLeaveRef = useRef(false);
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (allowLeaveRef.current || !isDirtyRef.current) return;
      e.preventDefault();
      confirmAction(
        'Cambios sin guardar',
        'Si sales ahora perderás los cambios de esta página.',
        'Salir sin guardar',
        () => { allowLeaveRef.current = true; clearDraft(); navigation.dispatch(e.data.action); },
      );
    });
  }, [navigation]);

  // Abrir el lector en esta página (sin guardar progreso de lectura)
  const handlePreview = () => {
    const open = () => router.push(
      `/reader/page-moderno?storyId=${storyId}&chapterId=${chapterId}&pageId=${pageId}&preview=1`
    );
    if (isDirty) {
      confirmAction(
        'Cambios sin guardar',
        'El lector mostrará la última versión guardada de esta página.',
        'Probar igualmente',
        open,
      );
    } else {
      open();
    }
  };

  // ── Guardar ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (saving || uploadingBg || uploadingMusic || uploadingSfx) return;

    // "Saltar a": el número debe ser una página existente del capítulo
    let nextPageId: string | null = null;
    if (jumpEnabled) {
      const n = parseInt(nextPageInput, 10);
      nextPageId = chapterPageIds[n - 1] ?? null;
      if (!nextPageId) {
        AppAlert.alert('Página no válida', `El capítulo no tiene una página ${nextPageInput || '(vacía)'}.`);
        return;
      }
    }

    setSaving(true);
    try {
      const musicForStore: string | null | undefined =
        musicMode === 'inherit' ? undefined : musicMode === 'silence' ? null : editMusicUrl;

      const cleanLinks = links.filter(l => l.word.trim());

      if (isEditing) {
        const updateData: any = {
          text: pageText, backgroundUrl: bgUrl, imageAnchor, imageFit, bgBlur,
          textBoxLayout: tbLayout,
          links: cleanLinks,
        };
        updateData.nextPageId    = nextPageId ?? deleteField();
        updateData.nextPageIndex = deleteField(); // formato antiguo (por número)
        updateData.sfxUrl        = sfxUrl || deleteField();
        updateData.sfxVolume     = sfxUrl && sfxVolume !== 1 ? sfxVolume : deleteField();
        if (textSize === undefined) updateData.textSize = deleteField();
        else updateData.textSize = textSize;
        if (musicMode === 'inherit')  updateData.musicUrl = deleteField();
        else if (musicMode === 'silence') updateData.musicUrl = null;
        else updateData.musicUrl = editMusicUrl;
        updateData.musicVolume = musicMode === 'play' && musicVolume !== 1 ? musicVolume : deleteField();
        // Personajes
        if (leftCharMode === 'inherit')  updateData.leftChar = deleteField();
        else if (leftCharMode === 'hide') updateData.leftChar = '';
        else updateData.leftChar = leftCharName.trim();
        if (rightCharMode === 'inherit')  updateData.rightChar = deleteField();
        else if (rightCharMode === 'hide') updateData.rightChar = '';
        else updateData.rightChar = rightCharName.trim();
        if (leftCharMode === 'show')  { updateData.leftCharPos = leftCharPos; updateData.leftCharSide = leftCharSide; }
        else { updateData.leftCharPos = deleteField(); updateData.leftCharSide = deleteField(); }
        if (rightCharMode === 'show') { updateData.rightCharPos = rightCharPos; updateData.rightCharSide = rightCharSide; }
        else { updateData.rightCharPos = deleteField(); updateData.rightCharSide = deleteField(); }

        await updateDoc(
          doc(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages', pageId as string),
          updateData
        );
      } else {
        // El orden se calcula ahora: mientras se editaba pudo crearse otra página
        // (p. ej. desde el selector de enlaces)
        const lastSnap = await getDocs(query(
          collection(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages'),
          orderBy('order', 'asc'),
        ));
        const lastOrder = lastSnap.docs.reduce((m, d) => Math.max(m, (d.data().order as number) ?? 0), 0);
        const newData: any = {
          text: pageText, backgroundUrl: bgUrl, imageAnchor, imageFit, bgBlur,
          textBoxLayout: tbLayout, order: lastOrder + 1,
          createdAt: new Date().toISOString(),
          links: cleanLinks,
        };
        if (nextPageId) newData.nextPageId = nextPageId;
        if (sfxUrl) newData.sfxUrl = sfxUrl;
        if (sfxUrl && sfxVolume !== 1) newData.sfxVolume = sfxVolume;
        if (textSize !== undefined) newData.textSize = textSize;
        if (musicMode === 'silence') newData.musicUrl = null;
        else if (musicMode === 'play' && editMusicUrl) newData.musicUrl = editMusicUrl;
        if (musicMode === 'play' && editMusicUrl && musicVolume !== 1) newData.musicVolume = musicVolume;
        // Personajes
        if (leftCharMode === 'show' && leftCharName.trim()) newData.leftChar = leftCharName.trim();
        else if (leftCharMode === 'hide') newData.leftChar = '';
        if (rightCharMode === 'show' && rightCharName.trim()) newData.rightChar = rightCharName.trim();
        else if (rightCharMode === 'hide') newData.rightChar = '';
        if (leftCharMode === 'show')  { newData.leftCharPos = leftCharPos; newData.leftCharSide = leftCharSide; }
        if (rightCharMode === 'show') { newData.rightCharPos = rightCharPos; newData.rightCharSide = rightCharSide; }

        await addDoc(
          collection(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages'),
          newData
        );
      }
      allowLeaveRef.current = true;
      clearDraft();
      router.back();
    } catch (e) {
      console.error('Error guardando página:', e);
      AppAlert.alert('Error', 'No se pudo guardar la página. Inténtalo de nuevo.');
    }
    finally     { setSaving(false); }
  };

  // Etiqueta del destino de un enlace (el número se calcula desde el id: sigue
  // siendo correcto aunque se reordenen las páginas)
  const linkTargetLabel = (link: PageLink) => {
    if (link.targetChapterId) return `→ ${link.targetChapterTitle ?? 'Cap.'} p.${link.targetPageIndex + 1}`;
    const i = link.targetPageId ? chapterPageIds.indexOf(link.targetPageId) : link.targetPageIndex;
    return i >= 0 ? `→ p.${i + 1}` : '→ página borrada';
  };

  // ── Escala de la preview respecto al lector ───────────────────────────────
  // Todo lo que se pinta en la preview usa las medidas del lector × pvScale,
  // así lo que cabe aquí es lo que cabe al leer. 'Auto' = 'md', igual que en el lector.
  const pvScale         = pvWidth / REF_SCREEN.width;
  const previewFontSize = FONT_SIZES[textSize ?? 'md'] * pvScale;
  const previewLabelStyle = {
    paddingHorizontal: CHAR_LABEL.paddingHorizontal * pvScale,
    paddingVertical:   CHAR_LABEL.paddingVertical * pvScale,
  };
  const previewLabelTextStyle = {
    fontSize:      CHAR_LABEL.fontSize * pvScale,
    letterSpacing: CHAR_LABEL.letterSpacing * pvScale,
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.emerald} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBack} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color="rgba(255,255,255,0.9)" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Página {pageNum}</Text>
        <View style={styles.headerActions}>
          {isEditing && (
            <TouchableOpacity style={styles.headerBack} onPress={handlePreview} activeOpacity={0.7}>
              <MaterialIcons name="play-arrow" size={22} color="rgba(0,0,0,0.85)" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.saveBtn, (saving || uploadingBg || uploadingMusic || uploadingSfx) && { opacity: 0.5 }]}
            onPress={handleSave}
            disabled={saving || uploadingBg || uploadingMusic || uploadingSfx}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator size="small" color="#000" />
              : <Text style={styles.saveBtnText}>Guardar</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Preview — ancho completo, proporción de un móvil medio en horizontal ── */}
      <View
        style={styles.preview}
        onLayout={e => {
          pvW.value = e.nativeEvent.layout.width;
          pvH.value = e.nativeEvent.layout.height;
          setPvWidth(e.nativeEvent.layout.width);
        }}
      >
        {/* Fondo */}
        {bgUri
          ? <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
              <Image
                source={{ uri: bgUri }}
                style={
                  imageFit === 'contain' ? StyleSheet.absoluteFill
                  : imageAnchor === 'center' ? StyleSheet.absoluteFill
                  : imageAnchor === 'top'
                    ? { position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: 16 / 9 }
                    : { position: 'absolute', bottom: 0, left: 0, right: 0, aspectRatio: 16 / 9 }
                }
                resizeMode={imageFit === 'contain' ? 'contain' : 'cover'}
                // Escalado como el resto de la preview para que se vea igual que al leer
                blurRadius={bgBlur * pvScale}
              />
            </View>
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        }
        <View style={styles.previewOverlay} />

        {/* Cuadro de texto redimensionable */}
        <Animated.View style={[
          styles.tbBox, { borderRadius: TEXT_BOX.radius * pvScale },
          linkMode && styles.tbBoxLinkMode, tbAnimStyle,
        ]}>
          <TextInput
            style={[styles.previewInput, {
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              paddingTop:        TEXT_BOX.paddingTop * pvScale,
              paddingHorizontal: TEXT_BOX.paddingHorizontal * pvScale,
              paddingBottom:     TEXT_BOX.paddingBottom * pvScale,
              fontSize:          previewFontSize,
              lineHeight:        previewFontSize * 1.6,
              letterSpacing:     TEXT_BOX.letterSpacing * pvScale,
            }]}
            value={pageText}
            onChangeText={setPageText}
            onSelectionChange={e => {
              if (!linkMode) return;
              const { start, end } = e.nativeEvent.selection;
              if (start !== end) setPendingWord(pageText.slice(start, end));
            }}
            placeholder="Escribe el texto aquí…"
            placeholderTextColor="rgba(255,255,255,0.30)"
            multiline
            textAlignVertical="top"
            maxLength={1000}
            autoCorrect={false}
          />
          {/* Barra de mover */}
          <GestureDetector gesture={tbGestures.move}>
            <View style={styles.tbMoveBar}>
              <MaterialIcons name="drag-indicator" size={12} color={Colors.emerald + 'AA'} />
            </View>
          </GestureDetector>
          {/* Handles aristas */}
          <GestureDetector gesture={tbGestures.n}><View style={[styles.tbHandle, styles.tbN]} /></GestureDetector>
          <GestureDetector gesture={tbGestures.s}><View style={[styles.tbHandle, styles.tbS]} /></GestureDetector>
          <GestureDetector gesture={tbGestures.e}><View style={[styles.tbHandle, styles.tbE]} /></GestureDetector>
          <GestureDetector gesture={tbGestures.w}><View style={[styles.tbHandle, styles.tbW]} /></GestureDetector>
          {/* Handles esquinas */}
          <GestureDetector gesture={tbGestures.ne}><View style={[styles.tbHandle, styles.tbNE]} /></GestureDetector>
          <GestureDetector gesture={tbGestures.nw}><View style={[styles.tbHandle, styles.tbNW]} /></GestureDetector>
          <GestureDetector gesture={tbGestures.se}><View style={[styles.tbHandle, styles.tbSE]} /></GestureDetector>
          <GestureDetector gesture={tbGestures.sw}><View style={[styles.tbHandle, styles.tbSW]} /></GestureDetector>
        </Animated.View>

        {/* Etiquetas de personaje — renderizadas DESPUÉS del bloque (z-order: encima) */}
        {leftCharMode === 'show' && (
          <GestureDetector gesture={charGestures.left}>
            <Animated.View
              onLayout={e => {
                lcLabelW.value = e.nativeEvent.layout.width;
                lcLabelH.value = e.nativeEvent.layout.height;
              }}
              style={[styles.previewCharLabel, previewLabelStyle, lcAnimStyle]}
            >
              <Text
                style={[styles.previewCharLabelText, previewLabelTextStyle, !leftCharName.trim() && { opacity: 0.4 }]}
                numberOfLines={1}
              >
                {leftCharName.trim() || 'POV / Protagonista'}
              </Text>
            </Animated.View>
          </GestureDetector>
        )}
        {rightCharMode === 'show' && (
          <GestureDetector gesture={charGestures.right}>
            <Animated.View
              onLayout={e => {
                rcLabelW.value = e.nativeEvent.layout.width;
                rcLabelH.value = e.nativeEvent.layout.height;
              }}
              style={[styles.previewCharLabel, previewLabelStyle, rcAnimStyle]}
            >
              <Text
                style={[styles.previewCharLabelText, previewLabelTextStyle, !rightCharName.trim() && { opacity: 0.4 }]}
                numberOfLines={1}
              >
                {rightCharName.trim() || 'Otro personaje'}
              </Text>
            </Animated.View>
          </GestureDetector>
        )}

        {/* Contador de caracteres */}
        <View style={styles.charCountBadge}>
          <Text style={styles.charCountText}>{pageText.length}/1000</Text>
        </View>

        {/* Overlay de subida */}
        {uploadingBg && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator color={Colors.emerald} />
            <Text style={styles.uploadingText}>Subiendo imagen…</Text>
          </View>
        )}

        {/* Botón centrar bloque — esquina superior derecha del preview */}
        <TouchableOpacity
          style={styles.resetTbBtn}
          onPress={centerTextBox}
          activeOpacity={0.7}
        >
          <MaterialIcons name="center-focus-strong" size={14} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>

      {/* ── Configuración desplazable ── */}
      <ScrollView
        style={styles.config}
        contentContainerStyle={styles.configContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Tamaño de texto */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Tamaño de texto</Text>
          <View style={styles.textSizeRow}>
            {TEXT_SIZE_OPTIONS.map(opt => {
              const isActive = opt.value === 'auto' ? textSize === undefined : textSize === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.textSizeBtn, isActive && styles.textSizeBtnActive]}
                  onPress={() => setTextSize(opt.value === 'auto' ? undefined : opt.value as TextSize)}
                  activeOpacity={0.75}
                >
                  <Text style={[
                    styles.textSizeBtnLabel,
                    { fontSize: opt.value === 'auto' ? 12 : opt.value === 'xs' ? 10 : opt.value === 'sm' ? 12 : opt.value === 'md' ? 14 : 17 },
                    isActive && styles.textSizeBtnLabelActive,
                  ]}>
                    {opt.value === 'auto' ? 'Auto' : 'A'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Imagen de fondo */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Imagen de fondo</Text>

          {bgUri ? (
            <>
              <View style={styles.bgActiveRow}>
                <MaterialIcons name="check-circle" size={16} color={Colors.emerald} />
                <Text style={styles.bgActiveText}>Imagen añadida</Text>
                <TouchableOpacity onPress={() => { setBgUri(null); setBgUrl(''); }} style={styles.bgRemoveBtn}>
                  <MaterialIcons name="close" size={16} color="#FF6B6B" />
                  <Text style={styles.bgRemoveText}>Quitar</Text>
                </TouchableOpacity>
              </View>
              {/* Fit */}
              <View style={styles.fitRow}>
                {([{ value: 'cover', icon: 'crop-free', label: 'Rellenar' }, { value: 'contain', icon: 'fit-screen', label: 'Ver todo' }] as any[]).map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.fitBtn, imageFit === opt.value && styles.fitBtnActive]}
                    onPress={() => setImageFit(opt.value)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={opt.icon} size={14} color={imageFit === opt.value ? '#000' : Colors.textSecondary} />
                    <Text style={[styles.fitBtnText, imageFit === opt.value && styles.fitBtnTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Ancla */}
              {imageFit === 'cover' && (
                <View style={styles.anchorRow}>
                  <Text style={styles.anchorLabel}>Encuadre:</Text>
                  {(['top', 'center', 'bottom'] as ImageAnchor[]).map(a => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.anchorBtn, imageAnchor === a && styles.anchorBtnActive]}
                      onPress={() => setImageAnchor(a)}
                      activeOpacity={0.75}
                    >
                      <MaterialIcons
                        name={a === 'top' ? 'vertical-align-top' : a === 'center' ? 'vertical-align-center' : 'vertical-align-bottom'}
                        size={13}
                        color={imageAnchor === a ? '#000' : Colors.textSecondary}
                      />
                      <Text style={[styles.anchorBtnText, imageAnchor === a && styles.anchorBtnTextActive]}>
                        {a === 'top' ? 'Arriba' : a === 'center' ? 'Centro' : 'Abajo'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {/* Desenfoque */}
              <View style={styles.blurBlock}>
                <View style={styles.anchorRow}>
                  <Text style={styles.anchorLabel}>Desenfoque:</Text>
                  <TouchableOpacity
                    style={[styles.blurStepBtn, bgBlur === 0 && { opacity: 0.35 }]}
                    onPress={() => setBgBlur(b => Math.max(0, b - 1))}
                    disabled={bgBlur === 0}
                    hitSlop={6}
                  >
                    <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={styles.blurValue}>{bgBlur === 0 ? 'Sin' : bgBlur}</Text>
                  <TouchableOpacity
                    style={[styles.blurStepBtn, bgBlur >= BG_BLUR_MAX && { opacity: 0.35 }]}
                    onPress={() => setBgBlur(b => Math.min(BG_BLUR_MAX, b + 1))}
                    disabled={bgBlur >= BG_BLUR_MAX}
                    hitSlop={6}
                  >
                    <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.blurPresetRow}>
                  {BG_BLUR_PRESETS.map(p => (
                    <TouchableOpacity
                      key={p.value}
                      style={[styles.anchorBtn, bgBlur === p.value && styles.anchorBtnActive]}
                      onPress={() => setBgBlur(p.value)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.anchorBtnText, bgBlur === p.value && styles.anchorBtnTextActive]}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={styles.sourceToggleRow}>
                {(['file', 'url'] as const).map(src => (
                  <TouchableOpacity
                    key={src}
                    style={[styles.sourceBtn, imageSource === src && styles.sourceBtnActive]}
                    onPress={() => setImageSource(src)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={src === 'file' ? 'upload-file' : 'link'} size={13} color={imageSource === src ? '#000' : Colors.textSecondary} />
                    <Text style={[styles.sourceBtnText, imageSource === src && styles.sourceBtnTextActive]}>
                      {src === 'file' ? 'Archivo' : 'URL / Drive'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {imageSource === 'file' ? (
                <TouchableOpacity style={styles.pickBtn} onPress={handlePickImage} disabled={uploadingBg} activeOpacity={0.7}>
                  <MaterialIcons name="add-photo-alternate" size={18} color={Colors.textSecondary} />
                  <Text style={styles.pickBtnText}>Añadir imagen de fondo</Text>
                  {uploadingBg && <ActivityIndicator size="small" color={Colors.emerald} />}
                </TouchableOpacity>
              ) : (
                <View style={styles.urlRow}>
                  <TextInput
                    style={styles.urlInput}
                    defaultValue={imageUrlInput}
                    onChangeText={setImageUrlInput}
                    placeholder="Link de Drive o URL directa a imagen…"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={[styles.urlConfirmBtn, !imageUrlInput.trim() && { opacity: 0.4 }]}
                    onPress={handleUseImageUrl}
                    disabled={!imageUrlInput.trim()}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.urlConfirmText}>Usar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* Música */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Música</Text>
          <View style={styles.musicModeRow}>
            {([
              { value: 'inherit', icon: 'redo',       label: 'Heredar'   },
              { value: 'play',    icon: 'audiotrack',  label: 'Pista'     },
              { value: 'silence', icon: 'music-off',   label: 'Silenciar' },
            ] as any[]).map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.musicModeBtn, musicMode === opt.value && styles.musicModeBtnActive]}
                onPress={() => {
                  setMusicMode(opt.value);
                  if (opt.value !== 'play') { setEditMusicUrl(''); setMusicFileName(''); }
                }}
                activeOpacity={0.75}
              >
                <MaterialIcons name={opt.icon} size={13} color={musicMode === opt.value ? '#000' : Colors.textSecondary} />
                <Text style={[styles.musicModeBtnText, musicMode === opt.value && styles.musicModeBtnTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {musicMode === 'play' && (
            editMusicUrl ? (
              <>
              <View style={styles.musicTrackRow}>
                <MaterialIcons name="audiotrack" size={14} color={Colors.aqua} />
                <Text style={styles.musicTrackName} numberOfLines={1}>{musicFileName || 'Pista de audio'}</Text>
                {uploadingMusic
                  ? <ActivityIndicator size="small" color={Colors.aqua} />
                  : <TouchableOpacity
                      onPress={() => { setEditMusicUrl(''); setMusicFileName(''); }}
                      style={{ padding: 6 }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="close" size={15} color="#FF6B6B" />
                    </TouchableOpacity>
                }
              </View>
              <VolumeRow
                value={musicVolume} min={MUSIC_VOLUME_MIN} max={MUSIC_VOLUME_MAX}
                onStep={changeMusicVolume}
                playing={previewingMusic} onTogglePlay={toggleMusicPreview}
              />
              </>
            ) : (
              <>
                <View style={styles.sourceToggleRow}>
                  {(['file', 'url'] as const).map(src => (
                    <TouchableOpacity
                      key={src}
                      style={[styles.sourceBtn, musicSource === src && styles.sourceBtnActive]}
                      onPress={() => setMusicSource(src)}
                      activeOpacity={0.75}
                    >
                      <MaterialIcons name={src === 'file' ? 'upload-file' : 'link'} size={13} color={musicSource === src ? '#000' : Colors.textSecondary} />
                      <Text style={[styles.sourceBtnText, musicSource === src && styles.sourceBtnTextActive]}>
                        {src === 'file' ? 'Archivo' : 'URL / Drive'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {musicSource === 'file' ? (
                  <TouchableOpacity
                    style={[styles.pickBtn, uploadingMusic && { opacity: 0.5 }]}
                    onPress={handlePickAudio}
                    disabled={uploadingMusic}
                    activeOpacity={0.7}
                  >
                    {uploadingMusic
                      ? <ActivityIndicator size="small" color={Colors.aqua} />
                      : <MaterialIcons name="upload-file" size={16} color={Colors.textSecondary} />
                    }
                    <Text style={styles.pickBtnText}>
                      {uploadingMusic ? 'Subiendo…' : 'Elegir archivo de audio'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.urlRow}>
                    <TextInput
                      style={styles.urlInput}
                      defaultValue={musicUrlInput}
                      onChangeText={setMusicUrlInput}
                      placeholder="Link de Drive o URL directa a audio…"
                      placeholderTextColor={Colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <TouchableOpacity
                      style={[styles.urlConfirmBtn, !musicUrlInput.trim() && { opacity: 0.4 }]}
                      onPress={handleUseMusicUrl}
                      disabled={!musicUrlInput.trim()}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.urlConfirmText}>Usar</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )
          )}
          {musicMode === 'inherit' && (
            <View style={styles.musicHint}>
              <MaterialIcons name="redo" size={12} color={Colors.textMuted} />
              <Text style={styles.musicHintText}>Continúa la pista de la página anterior</Text>
            </View>
          )}
          {musicMode === 'silence' && (
            <View style={styles.musicHint}>
              <MaterialIcons name="music-off" size={12} color={Colors.textMuted} />
              <Text style={styles.musicHintText}>La música se detendrá en esta página</Text>
            </View>
          )}
        </View>

        {/* Efecto de sonido */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Efecto de sonido</Text>
          <Text style={styles.sectionHint}>
            Suena una vez al llegar a esta página (una puerta, un trueno…). No se hereda.
          </Text>
          {sfxUrl ? (
            <>
              <View style={styles.musicTrackRow}>
                <MaterialIcons name="graphic-eq" size={14} color={Colors.aqua} />
                <Text style={styles.musicTrackName} numberOfLines={1}>{sfxFileName || 'Efecto de sonido'}</Text>
                <TouchableOpacity
                  onPress={() => { setSfxUrl(''); setSfxFileName(''); }}
                  style={{ padding: 6 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialIcons name="close" size={15} color="#FF6B6B" />
                </TouchableOpacity>
              </View>
              <VolumeRow
                value={sfxVolume} min={MUSIC_VOLUME_MIN} max={SFX_VOLUME_MAX}
                onStep={changeSfxVolume}
                playing={previewingSfx} onTogglePlay={toggleSfxPreview}
              />
            </>
          ) : (
            <>
              <View style={styles.sourceToggleRow}>
                {(['file', 'url'] as const).map(src => (
                  <TouchableOpacity
                    key={src}
                    style={[styles.sourceBtn, sfxSource === src && styles.sourceBtnActive]}
                    onPress={() => setSfxSource(src)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={src === 'file' ? 'upload-file' : 'link'} size={13} color={sfxSource === src ? '#000' : Colors.textSecondary} />
                    <Text style={[styles.sourceBtnText, sfxSource === src && styles.sourceBtnTextActive]}>
                      {src === 'file' ? 'Archivo' : 'URL / Drive'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {sfxSource === 'file' ? (
                <TouchableOpacity
                  style={[styles.pickBtn, uploadingSfx && { opacity: 0.5 }]}
                  onPress={handlePickSfx}
                  disabled={uploadingSfx}
                  activeOpacity={0.7}
                >
                  {uploadingSfx
                    ? <ActivityIndicator size="small" color={Colors.aqua} />
                    : <MaterialIcons name="upload-file" size={16} color={Colors.textSecondary} />
                  }
                  <Text style={styles.pickBtnText}>
                    {uploadingSfx ? 'Subiendo…' : 'Elegir archivo de sonido'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.urlRow}>
                  <TextInput
                    style={styles.urlInput}
                    defaultValue={sfxUrlInput}
                    onChangeText={setSfxUrlInput}
                    placeholder="Link de Drive o URL directa a audio…"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={[styles.urlConfirmBtn, !sfxUrlInput.trim() && { opacity: 0.4 }]}
                    onPress={handleUseSfxUrl}
                    disabled={!sfxUrlInput.trim()}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.urlConfirmText}>Usar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Personajes ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Personajes</Text>
          <Text style={styles.sectionHint}>
            Nombres que aparecen sobre el recuadro de texto. Se heredan de página en página.
          </Text>
          {/* Slot izquierda — POV / Protagonista */}
          <View style={styles.charSlot}>
            <Text style={styles.charSlotLabel}>POV / Protagonista</Text>
            <View style={styles.charModeRow}>
              {([
                { value: 'inherit' as CharMode, icon: 'redo',      label: 'Heredar' },
                { value: 'show'    as CharMode, icon: 'person',     label: 'Nombre'  },
                { value: 'hide'    as CharMode, icon: 'person-off', label: 'Ocultar' },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.charModeBtn, leftCharMode === opt.value && styles.charModeBtnActive]}
                  onPress={() => chooseLeftCharMode(opt.value)}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name={opt.icon as any} size={12} color={leftCharMode === opt.value ? '#000' : Colors.textSecondary} />
                  <Text style={[styles.charModeBtnText, leftCharMode === opt.value && styles.charModeBtnTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {leftCharMode === 'show' && (
              <Pressable onPress={() => lcInputRef.current?.focus()}>
                <TextInput
                  ref={lcInputRef}
                  key={`lc-${storyId}-${pageId ?? pageOrder}-${draftNonce}`}
                  style={styles.charNameInput}
                  defaultValue={leftCharName}
                  onChangeText={setLeftCharName}
                  placeholder="Nombre del personaje…"
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="words"
                  returnKeyType="done"
                  maxLength={30}
                />
              </Pressable>
            )}
            {leftCharMode === 'inherit' && (
              <View style={styles.musicHint}>
                <MaterialIcons name="redo" size={12} color={Colors.textMuted} />
                <Text style={styles.musicHintText}>Toma el nombre de la página anterior</Text>
              </View>
            )}
            {leftCharMode === 'hide' && (
              <View style={styles.musicHint}>
                <MaterialIcons name="person-off" size={12} color={Colors.textMuted} />
                <Text style={styles.musicHintText}>Oculta el nombre aunque venga heredado</Text>
              </View>
            )}
          </View>

          {/* Slot derecha — Otro personaje */}
          <View style={styles.charSlot}>
            <Text style={styles.charSlotLabel}>Otro personaje</Text>
            <View style={styles.charModeRow}>
              {([
                { value: 'inherit' as CharMode, icon: 'redo',      label: 'Heredar' },
                { value: 'show'    as CharMode, icon: 'person',     label: 'Nombre'  },
                { value: 'hide'    as CharMode, icon: 'person-off', label: 'Ocultar' },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.charModeBtn, rightCharMode === opt.value && styles.charModeBtnActive]}
                  onPress={() => chooseRightCharMode(opt.value)}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name={opt.icon as any} size={12} color={rightCharMode === opt.value ? '#000' : Colors.textSecondary} />
                  <Text style={[styles.charModeBtnText, rightCharMode === opt.value && styles.charModeBtnTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {rightCharMode === 'show' && (
              <Pressable onPress={() => rcInputRef.current?.focus()}>
                <TextInput
                  ref={rcInputRef}
                  key={`rc-${storyId}-${pageId ?? pageOrder}-${draftNonce}`}
                  style={styles.charNameInput}
                  defaultValue={rightCharName}
                  onChangeText={setRightCharName}
                  placeholder="Nombre del personaje…"
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="words"
                  returnKeyType="done"
                  maxLength={30}
                />
              </Pressable>
            )}
            {rightCharMode === 'inherit' && (
              <View style={styles.musicHint}>
                <MaterialIcons name="redo" size={12} color={Colors.textMuted} />
                <Text style={styles.musicHintText}>Toma el nombre de la página anterior</Text>
              </View>
            )}
            {rightCharMode === 'hide' && (
              <View style={styles.musicHint}>
                <MaterialIcons name="person-off" size={12} color={Colors.textMuted} />
                <Text style={styles.musicHintText}>Oculta el nombre aunque venga heredado</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Palabras enlazadas ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Palabras enlazadas</Text>
          <Text style={styles.sectionHint}>
            El lector podrá tocar estas palabras para saltar a otra página.
          </Text>

          {/* Chips de enlaces existentes */}
          {links.length > 0 && (
            <View style={styles.linkChipsRow}>
              {links.map((link, idx) => (
                <View key={idx} style={[styles.linkChip, { borderColor: link.color + '70', backgroundColor: link.color + '18' }]}>
                  <Text style={[styles.linkChipWord, { color: link.color }]}>{link.word}</Text>
                  <Text style={styles.linkChipPage}>{linkTargetLabel(link)}</Text>
                  <TouchableOpacity
                    onPress={() => setLinks(prev => prev.filter((_, i) => i !== idx))}
                    style={{ padding: 4 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="close" size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Botón añadir enlace — solo cuando el panel está cerrado */}
          {!linkMode && (
            <TouchableOpacity
              style={styles.linkAddBtn}
              onPress={() => {
                setLinkMode(true);
                setPendingWord('');
                setPendingLinkTarget(null);
                setPendingLinkColor('#FFD700');
              }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="add-link" size={16} color={Colors.emerald} />
              <Text style={styles.linkAddText}>Añadir enlace</Text>
            </TouchableOpacity>
          )}

          {/* Panel de configuración — aparece al tocar "Añadir enlace" */}
          {linkMode && (
            <View style={styles.linkPendingPanel}>
              <View style={styles.linkPendingHeader}>
                <Text style={styles.linkPendingTitle}>Nuevo enlace</Text>
                <TouchableOpacity
                  onPress={() => { setLinkMode(false); setPendingWord(''); setPendingLinkTarget(null); }}
                  style={{ padding: 4 }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Palabra — escribir o seleccionar en el preview */}
              <View style={styles.linkPagePickerRow}>
                <Text style={styles.linkColorPickerLabel}>Palabra:</Text>
                <TextInput
                  style={[styles.linkPageInputFull, pendingWord ? { color: pendingLinkColor } : {}]}
                  value={pendingWord}
                  onChangeText={setPendingWord}
                  placeholder="Escribe o selecciónala arriba…"
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="next"
                />
              </View>

              {/* Selector de color */}
              <View style={styles.linkColorPickerRow}>
                <Text style={styles.linkColorPickerLabel}>Color:</Text>
                <View style={styles.linkColorPickerDots}>
                  {LINK_COLORS.map(c => (
                    <TouchableOpacity
                      key={c.hex}
                      style={[styles.linkColorDot, { backgroundColor: c.hex }, pendingLinkColor === c.hex && styles.linkColorDotActive]}
                      onPress={() => setPendingLinkColor(c.hex)}
                    />
                  ))}
                </View>
              </View>

              {/* Página destino */}
              <View style={styles.linkPagePickerRow}>
                <Text style={styles.linkColorPickerLabel}>Saltar a página:</Text>
                <TouchableOpacity
                  style={styles.linkPageSelector}
                  onPress={openPagePicker}
                  activeOpacity={0.75}
                >
                  {pendingLinkTarget ? (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linkPageSelectorValue}>
                        Pág. {pendingLinkTarget.pageOrder}
                      </Text>
                      <Text style={styles.linkPageSelectorChapter} numberOfLines={1}>
                        {pendingLinkTarget.chapterTitle}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.linkPageSelectorPlaceholder}>
                      Toca para elegir página…
                    </Text>
                  )}
                  <MaterialIcons
                    name={pagePickerOpen ? 'expand-less' : 'expand-more'}
                    size={20}
                    color={Colors.textMuted}
                  />
                </TouchableOpacity>

                {/* Lista inline — se despliega bajo el botón */}
                {pagePickerOpen && (
                  <View style={styles.pickerInline}>
                    {/* Buscador */}
                    <View style={styles.pickerSearchRow}>
                      <MaterialIcons name="search" size={15} color={Colors.textMuted} />
                      <TextInput
                        style={styles.pickerSearchInput}
                        value={pagePickerSearch}
                        onChangeText={setPagePickerSearch}
                        placeholder="Buscar por número o capítulo…"
                        placeholderTextColor={Colors.textMuted}
                        autoCorrect={false}
                        clearButtonMode="while-editing"
                      />
                      <TouchableOpacity
                        onPress={() => setPagePickerOpen(false)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>

                    {/* Crear nueva página — solo si el capítulo no está publicado */}
                    {currentChapterPublished ? (
                      <View style={styles.pickerPublishedNotice}>
                        <MaterialIcons name="lock" size={13} color={Colors.textMuted} />
                        <Text style={styles.pickerPublishedNoticeText}>
                          El capítulo está publicado — no se pueden añadir páginas nuevas
                        </Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.pickerCreateBtn}
                        onPress={handleCreateNewPage}
                        disabled={creatingNewPage}
                        activeOpacity={0.75}
                      >
                        {creatingNewPage
                          ? <ActivityIndicator size="small" color={Colors.emerald} />
                          : <MaterialIcons name="add-circle-outline" size={16} color={Colors.emerald} />
                        }
                        <Text style={styles.pickerCreateBtnText}>
                          {creatingNewPage ? 'Creando página…' : 'Crear nueva página en este capítulo'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {loadingPageOptions ? (
                      <View style={styles.pickerLoading}>
                        <ActivityIndicator color={Colors.emerald} size="small" />
                        <Text style={styles.pickerLoadingText}>Cargando páginas…</Text>
                      </View>
                    ) : (() => {
                      const filtered = pageOptions.filter(opt => {
                        if (!pagePickerSearch.trim()) return true;
                        const q = pagePickerSearch.trim().toLowerCase();
                        return (
                          String(opt.pageOrder).includes(q) ||
                          opt.chapterTitle.toLowerCase().includes(q) ||
                          opt.pageText.toLowerCase().includes(q)
                        );
                      });
                      return (
                        <ScrollView style={styles.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                          {filtered.length === 0 ? (
                            <View style={styles.pickerEmpty}>
                              <Text style={styles.pickerEmptyText}>
                                {pageOptions.length === 0 ? 'Este libro aún no tiene páginas' : 'Sin resultados'}
                              </Text>
                            </View>
                          ) : filtered.map(item => {
                            const isSelected =
                              pendingLinkTarget?.pageId === item.pageId &&
                              pendingLinkTarget?.chapterId === item.chapterId;
                            return (
                              <TouchableOpacity
                                key={`${item.chapterId}-${item.pageId}`}
                                style={[styles.pickerItem, isSelected && styles.pickerItemActive]}
                                onPress={() => { setPendingLinkTarget(item); setPagePickerOpen(false); }}
                                activeOpacity={0.7}
                              >
                                <View style={[styles.pickerPageBadge, isSelected && { backgroundColor: Colors.emerald }]}>
                                  <Text style={[styles.pickerPageBadgeText, isSelected && { color: '#000' }]}>
                                    {item.pageOrder}
                                  </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={[styles.pickerChapterName, isSelected && { color: Colors.emerald }]} numberOfLines={1}>
                                    {item.chapterTitle}
                                  </Text>
                                  {item.pageText ? (
                                    <Text style={styles.pickerPagePreview} numberOfLines={1}>{item.pageText}</Text>
                                  ) : null}
                                </View>
                                {isSelected && <MaterialIcons name="check" size={15} color={Colors.emerald} />}
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      );
                    })()}
                  </View>
                )}
              </View>

              {/* Acciones */}
              <View style={styles.linkPendingActions}>
                <TouchableOpacity
                  style={styles.linkCancelBtn}
                  onPress={() => { setLinkMode(false); setPendingWord(''); setPendingLinkTarget(null); }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.linkCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.linkConfirmBtn,
                    { backgroundColor: pendingLinkColor },
                    (!pendingWord.trim() || !pendingLinkTarget) && { opacity: 0.4 },
                  ]}
                  onPress={() => {
                    if (!pendingWord.trim() || !pendingLinkTarget) return;
                    const isCurrentChapter = pendingLinkTarget.chapterId === chapterId;
                    setLinks(prev => [...prev, {
                      word: pendingWord.trim(),
                      color: pendingLinkColor,
                      targetPageId: pendingLinkTarget.pageId,
                      targetPageIndex: pendingLinkTarget.pageIndex,
                      ...(isCurrentChapter ? {} : {
                        targetChapterId: pendingLinkTarget.chapterId,
                        targetChapterTitle: pendingLinkTarget.chapterTitle,
                      }),
                    }]);
                    setLinkMode(false);
                    setPendingWord('');
                    setPendingLinkTarget(null);
                  }}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name="check" size={15} color="#000" />
                  <Text style={styles.linkConfirmText}>Añadir</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* ── Redirección de página ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Al pasar la página</Text>
          <Text style={styles.sectionHint}>
            Por defecto avanza a la siguiente. Puedes redirigir a cualquier otra.
          </Text>
          <View style={styles.nextPageRow}>
            <TouchableOpacity
              style={[styles.nextPageBtn, !jumpEnabled && styles.nextPageBtnActive]}
              onPress={() => { setJumpEnabled(false); setNextPageInput(''); }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="arrow-forward" size={14} color={!jumpEnabled ? '#000' : Colors.textSecondary} />
              <Text style={[styles.nextPageBtnText, !jumpEnabled && styles.nextPageBtnTextActive]}>
                Siguiente
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextPageBtn, jumpEnabled && styles.nextPageBtnActive]}
              onPress={() => { if (!jumpEnabled) { setJumpEnabled(true); setNextPageInput('1'); } }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="call-split" size={14} color={jumpEnabled ? '#000' : Colors.textSecondary} />
              <Text style={[styles.nextPageBtnText, jumpEnabled && styles.nextPageBtnTextActive]}>
                Saltar a
              </Text>
            </TouchableOpacity>
            {jumpEnabled && (
              <View style={styles.nextPageInputWrap}>
                <Text style={styles.nextPageInputLabel}>pág.</Text>
                <TextInput
                  style={styles.nextPageInput}
                  value={nextPageInput}
                  onChangeText={v => setNextPageInput(v.replace(/[^0-9]/g, ''))}
                  placeholder="1"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={3}
                  autoFocus
                />
              </View>
            )}
          </View>
          {jumpEnabled && (
            <Text style={styles.nextPageHint}>
              {chapterPageIds[parseInt(nextPageInput, 10) - 1]
                ? `Al pasar esta página el lector saltará a la página ${nextPageInput}`
                : `El capítulo tiene ${chapterPageIds.length} página${chapterPageIds.length === 1 ? '' : 's'}: elige una de ellas`}
            </Text>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.emerald,
  },
  headerBack:  { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  saveBtn:     { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 6, backgroundColor: '#000', minWidth: 80, alignItems: 'center' },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: Colors.emerald, letterSpacing: 0.4 },

  // Preview — misma proporción que la pantalla de referencia del lector
  preview: {
    width: '100%',
    aspectRatio: REF_SCREEN.width / REF_SCREEN.height,
    backgroundColor: '#000',
    overflow: 'hidden', // evita que los GestureDetector de labels intercepten taps fuera del preview
  },
  previewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },

  // Cuadro de texto redimensionable
  tbBox: {
    backgroundColor: 'rgba(22,24,30,0.82)',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.emerald + '70',
    borderStyle: 'dashed',
    overflow: 'visible',
    zIndex: 2,
  },
  tbMoveBar: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 18,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', zIndex: 5,
  },
  tbHandle:  { position: 'absolute', width: 11, height: 11, borderRadius: 3, backgroundColor: Colors.emerald, zIndex: 5 },
  tbN:  { top: -5.5,    left: '50%', marginLeft: -5.5 },
  tbS:  { bottom: -5.5, left: '50%', marginLeft: -5.5 },
  tbE:  { right: -5.5,  top: '50%',  marginTop: -5.5  },
  tbW:  { left: -5.5,   top: '50%',  marginTop: -5.5  },
  tbNE: { top: -5.5,    right: -5.5  },
  tbNW: { top: -5.5,    left: -5.5   },
  tbSE: { bottom: -5.5, right: -5.5  },
  tbSW: { bottom: -5.5, left: -5.5   },

  previewInput: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.5,
    textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2,
    textAlignVertical: 'top',
  },
  charCountBadge: {
    position: 'absolute', bottom: 6, right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  charCountText: { fontSize: 10, color: 'rgba(255,255,255,0.6)' },
  resetTbBtn: {
    position: 'absolute', top: 6, right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 4, padding: 4,
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 10,
  },
  uploadingText: { fontSize: 12, color: Colors.emerald, fontWeight: '600' },

  // Config scrollable
  config:        { flex: 1 },
  configContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 24 },

  section:      { gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },

  // Tamaño texto
  textSizeRow:         { flexDirection: 'row', gap: 8 },
  textSizeBtn:         { width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  textSizeBtnActive:   { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  textSizeBtnLabel:    { fontWeight: '700', color: Colors.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  textSizeBtnLabelActive: { color: '#000' },

  // Imagen
  bgActiveRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderColor: Colors.emerald + '55', borderRadius: 6, backgroundColor: Colors.emerald + '12' },
  bgActiveText: { flex: 1, fontSize: 13, color: Colors.emerald, fontWeight: '600' },
  bgRemoveBtn:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bgRemoveText: { fontSize: 13, color: '#FF6B6B' },
  fitRow:       { flexDirection: 'row', gap: 8 },
  fitBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  fitBtnActive: { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  fitBtnText:   { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  fitBtnTextActive: { color: '#000' },
  anchorRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  anchorLabel:  { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  anchorBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  anchorBtnActive:   { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  anchorBtnText:     { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  anchorBtnTextActive: { color: '#000' },
  blurBlock:     { gap: 8 },
  blurStepBtn:   { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  blurValue:     { minWidth: 28, textAlign: 'center', fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  blurPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sourceToggleRow:   { flexDirection: 'row', gap: 8 },
  sourceBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  sourceBtnActive:   { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  sourceBtnText:     { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  sourceBtnTextActive: { color: '#000' },
  pickBtn:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, borderStyle: 'dashed' },
  pickBtnText: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  urlRow:       { flexDirection: 'row', gap: 8, alignItems: 'center' },
  urlInput:     { flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary, fontSize: 13 },
  urlConfirmBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, backgroundColor: Colors.emerald },
  urlConfirmText: { fontSize: 13, fontWeight: '700', color: '#000' },

  // Música
  musicModeRow:        { flexDirection: 'row', gap: 8 },
  musicModeBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  musicModeBtnActive:  { backgroundColor: Colors.aqua, borderColor: Colors.aqua },
  musicModeBtnText:    { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  musicModeBtnTextActive: { color: '#000' },
  musicTrackRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, backgroundColor: Colors.aqua + '14', borderWidth: 1, borderColor: Colors.aqua + '40' },
  musicTrackName: { flex: 1, fontSize: 12, color: Colors.aqua, fontWeight: '500' },
  musicHint:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  musicHintText:  { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },

  // ── Sección común ─────────────────────────────────────────────────────────
  sectionHint: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, marginTop: -4 },

  // ── Palabras enlazadas ────────────────────────────────────────────────────
  tbBoxLinkMode: { borderColor: '#FFD700', borderWidth: 2 },

  linkChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linkChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  linkChipWord: { fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  linkChipPage: { fontSize: 11, color: Colors.textMuted },

  linkAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 14,
    borderWidth: 1, borderColor: Colors.emerald + '50',
    borderRadius: 6, borderStyle: 'dashed', alignSelf: 'flex-start',
  },
  linkAddText: { fontSize: 13, color: Colors.emerald, fontWeight: '600' },

  linkPendingPanel: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    backgroundColor: Colors.card, padding: 14, gap: 12,
  },
  linkPendingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkPendingTitle:  { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },

  linkColorPickerRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkColorPickerLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: '600', minWidth: 45 },
  linkColorPickerDots:  { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  linkColorDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  linkColorDotActive: { borderColor: '#fff', transform: [{ scale: 1.2 }] },

  linkPagePickerRow: { gap: 6 },
  linkPageSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 6, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48,
  },
  linkPageSelectorValue:       { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  linkPageSelectorChapter:     { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  linkPageSelectorPlaceholder: { flex: 1, fontSize: 13, color: Colors.textMuted },

  // ── Picker inline ─────────────────────────────────────────────────────────
  pickerInline: {
    marginTop: 6,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 8,
    backgroundColor: Colors.card, overflow: 'hidden',
  },
  pickerSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  pickerSearchInput: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  pickerList:   { maxHeight: 260, flexGrow: 0 },
  pickerCreateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.emerald + '10',
  },
  pickerCreateBtnText: { fontSize: 13, fontWeight: '600', color: Colors.emerald },
  pickerPublishedNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  pickerPublishedNoticeText: { flex: 1, fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },
  pickerLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  pickerLoadingText: { fontSize: 12, color: Colors.textMuted },
  pickerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '50',
  },
  pickerItemActive: { backgroundColor: Colors.emerald + '14' },
  pickerPageBadge: {
    width: 30, height: 30, borderRadius: 6,
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerPageBadgeText:  { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  pickerChapterName:    { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  pickerPagePreview:    { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  pickerEmpty:          { alignItems: 'center', paddingVertical: 24 },
  pickerEmptyText:      { fontSize: 12, color: Colors.textMuted },

  linkPendingActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  linkCancelBtn: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg,
  },
  linkCancelText:  { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  linkConfirmBtn:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 6 },
  linkConfirmText: { fontSize: 13, fontWeight: '700', color: '#000' },

  // ── Redirección de página ──────────────────────────────────────────────────
  nextPageRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  nextPageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  nextPageBtnActive: { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  nextPageBtnText:   { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  nextPageBtnTextActive: { color: '#000' },
  nextPageInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.emerald,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  nextPageInputLabel: { fontSize: 13, color: Colors.textMuted },
  nextPageInput: {
    width: 40,
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  nextPageHint: { fontSize: 11, color: Colors.emerald, fontStyle: 'italic' },

  // ── Personajes ────────────────────────────────────────────────────────────
  charSlot: {
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border + '40',
  },
  charSlotLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  charModeRow: { flexDirection: 'row', gap: 6 },
  charModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  charModeBtnActive:     { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  charModeBtnText:       { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  charModeBtnTextActive: { color: '#000' },
  charNameInput: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },

  // Labels de personaje en el preview del editor
  // Los bordes y radios de esquina se calculan dinámicamente en lcAnimStyle/rcAnimStyle
  linkPageInputFull: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
   borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },

  // Padding y tamaño de letra se escalan desde CHAR_LABEL (medidas del lector)
  previewCharLabel: {
    backgroundColor: 'rgba(22,24,30,0.88)',
    borderColor: Colors.emerald + '60',
  },
  previewCharLabelText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: '700',
    color: Colors.emerald,
    flexShrink: 1,
  },
});

