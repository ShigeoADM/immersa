import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  collection, addDoc, doc, updateDoc, getDoc, getDocs,
  deleteField,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
// TouchableOpacity de RNGH: necesario para que los botones dentro del ScrollView funcionen
// correctamente junto con los GestureDetectors del preview.
// Para los TextInput de nombre usamos refs + .focus() programático que bypasea el sistema de gestos.
import { GestureDetector, Gesture, TouchableOpacity } from 'react-native-gesture-handler';

// ─── Tipos ───────────────────────────────────────────────────────────────────
type ImageAnchor   = 'top' | 'center' | 'bottom';
type ImageFit      = 'cover' | 'contain';
type MusicMode     = 'inherit' | 'play' | 'silence';
type CharMode      = 'inherit' | 'show' | 'hide';
type TextSize      = 'xs' | 'sm' | 'md' | 'lg';
type TextBoxLayout = { x: number; y: number; w: number; h: number };

const DEFAULT_TB: TextBoxLayout = { x: 11, y: 23, w: 78, h: 53 };

// ─── Enlace de texto ──────────────────────────────────────────────────────────
type PageLink = {
  word: string;
  color: string;
  targetPageIndex: number;
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

const TEXT_SIZE_OPTIONS: { value: TextSize | 'auto'; label: string; previewSize: number }[] = [
  { value: 'auto', label: 'Auto', previewSize: 9  },
  { value: 'xs',   label: 'XS',   previewSize: 7  },
  { value: 'sm',   label: 'S',    previewSize: 8  },
  { value: 'md',   label: 'M',    previewSize: 9  },
  { value: 'lg',   label: 'L',    previewSize: 11 },
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
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: confirmText, style: 'destructive', onPress: onConfirm },
    ]);
  }
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
  const [uploadingBg, setUploadingBg]   = useState(false);
  const [imageSource, setImageSource]   = useState<'file' | 'url'>('file');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [musicMode, setMusicMode]       = useState<MusicMode>('inherit');
  const [editMusicUrl, setEditMusicUrl] = useState('');
  const [musicFileName, setMusicFileName] = useState('');
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [musicSource, setMusicSource]   = useState<'file' | 'url'>('file');
  const [musicUrlInput, setMusicUrlInput] = useState('');
  const [textSize, setTextSize]         = useState<TextSize | undefined>(undefined);
  const [tbLayout, setTbLayout]         = useState<TextBoxLayout>(DEFAULT_TB);
  const [links, setLinks]               = useState<PageLink[]>([]);
  const [nextPageIndex, setNextPageIndex] = useState<number | null>(null);
  const [nextPageInput, setNextPageInput] = useState('');
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
  const lcSide      = useSharedValue(1); // 0=libre,1=arriba,2=abajo,3=izq,4=der
  const lcStartSide = useSharedValue(0); // side al inicio del gesto actual
  const lcLabelW    = useSharedValue(80); // ancho real del label (px), medido en onLayout
  const rcX         = useSharedValue(62);
  const rcY         = useSharedValue(16);
  const rcSX        = useSharedValue(62);
  const rcSY        = useSharedValue(16);
  const rcSide      = useSharedValue(1);
  const rcStartSide = useSharedValue(0);
  const rcLabelW    = useSharedValue(80); // ancho real del label (px)

  const tbAnimStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left:   (tbX.value / 100) * pvW.value,
    top:    (tbY.value / 100) * pvH.value,
    width:  (tbW.value / 100) * pvW.value,
    height: (tbH.value / 100) * pvH.value,
  }));

  // ── Constantes del label en el preview ───────────────────────────────────
  // Altura real del label = paddingV×2 + lineHeight(fontSize=7) ≈ 4 + 9 = 13 px
  const LABEL_H = 13; // px en el preview

  // ── Función de posición compartida (worklet helper) ───────────────────────
  // Para sides 3/4 la rotación ocurre alrededor del CENTRO del layout.
  // Visual:  width_visual = LABEL_H,  height_visual = labelWidth
  // Para que el borde visual quede exactamente en el borde del bloque de texto:
  //   side=3 (izq, −90°): visual_right = tbX_px  →  center_x = tbX_px − LABEL_H/2
  //   side=4 (der, +90°): visual_left  = (tbX+tbW)_px → center_x = (tbX+tbW)_px + LABEL_H/2
  //   center_x = layout_left + labelWidth/2  →  layout_left = center_x − labelWidth/2

  const lcAnimStyle = useAnimatedStyle(() => {
    'worklet';
    const s   = lcSide.value;
    const lW  = lcLabelW.value;           // ancho real del label en px
    const tbXp = (tbX.value / 100) * pvW.value;
    const tbYp = (tbY.value / 100) * pvH.value;
    const tbRp = ((tbX.value + tbW.value) / 100) * pvW.value;
    const tbBp = ((tbY.value + tbH.value) / 100) * pvH.value;

    let left: number, top: number;
    if (s === 1) {         // arriba: X libre, parte de abajo toca borde superior
      left = (lcX.value / 100) * pvW.value;
      top  = tbYp - LABEL_H;
    } else if (s === 2) { // abajo: X libre, parte de arriba toca borde inferior
      left = (lcX.value / 100) * pvW.value;
      top  = tbBp;
    } else if (s === 3) { // izq, −90°: borde visual derecho = borde izq del bloque
      const cx = tbXp - LABEL_H / 2;
      left = cx - lW / 2;
      top  = (lcY.value / 100) * pvH.value;
    } else if (s === 4) { // der, +90°: borde visual izq = borde der del bloque
      const cx = tbRp + LABEL_H / 2;
      left = cx - lW / 2;
      top  = (lcY.value / 100) * pvH.value;
    } else {               // libre
      left = (lcX.value / 100) * pvW.value;
      top  = (lcY.value / 100) * pvH.value;
    }
    const rot = s === 3 ? '-90deg' : s === 4 ? '90deg' : '0deg';
    return {
      position: 'absolute' as const,
      left, top,
      transform: [{ rotate: rot }],
      borderTopWidth:          s === 2 ? 0 : 1,
      // Layout BOTTOM → visual RIGHT (s=3, −90°) y visual LEFT (s=4, +90°): es el lado pegado
      borderBottomWidth:       (s === 1 || s === 3 || s === 4) ? 0 : 1,
      borderLeftWidth:         1,
      borderRightWidth:        1,
      borderTopLeftRadius:     s === 2 ? 0 : 4,
      borderTopRightRadius:    s === 2 ? 0 : 4,
      borderBottomLeftRadius:  (s === 1 || s === 3 || s === 4) ? 0 : 4,
      borderBottomRightRadius: (s === 1 || s === 3 || s === 4) ? 0 : 4,
    };
  });

  const rcAnimStyle = useAnimatedStyle(() => {
    'worklet';
    const s   = rcSide.value;
    const lW  = rcLabelW.value;
    const tbXp = (tbX.value / 100) * pvW.value;
    const tbYp = (tbY.value / 100) * pvH.value;
    const tbRp = ((tbX.value + tbW.value) / 100) * pvW.value;
    const tbBp = ((tbY.value + tbH.value) / 100) * pvH.value;

    let left: number, top: number;
    if (s === 1) {
      left = (rcX.value / 100) * pvW.value;
      top  = tbYp - LABEL_H;
    } else if (s === 2) {
      left = (rcX.value / 100) * pvW.value;
      top  = tbBp;
    } else if (s === 3) {
      const cx = tbXp - LABEL_H / 2;
      left = cx - lW / 2;
      top  = (rcY.value / 100) * pvH.value;
    } else if (s === 4) {
      const cx = tbRp + LABEL_H / 2;
      left = cx - lW / 2;
      top  = (rcY.value / 100) * pvH.value;
    } else {
      left = (rcX.value / 100) * pvW.value;
      top  = (rcY.value / 100) * pvH.value;
    }
    const rot = s === 3 ? '-90deg' : s === 4 ? '90deg' : '0deg';
    return {
      position: 'absolute' as const,
      left, top,
      transform: [{ rotate: rot }],
      borderTopWidth:          s === 2 ? 0 : 1,
      // Layout BOTTOM → visual RIGHT (s=3, −90°) y visual LEFT (s=4, +90°): es el lado pegado
      borderBottomWidth:       (s === 1 || s === 3 || s === 4) ? 0 : 1,
      borderLeftWidth:         1,
      borderRightWidth:        1,
      borderTopLeftRadius:     s === 2 ? 0 : 4,
      borderTopRightRadius:    s === 2 ? 0 : 4,
      borderBottomLeftRadius:  (s === 1 || s === 3 || s === 4) ? 0 : 4,
      borderBottomRightRadius: (s === 1 || s === 3 || s === 4) ? 0 : 4,
    };
  });

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
    // px,py = posición top-left del label en %.
    // Usamos el CENTRO aproximado del label (el usuario arrastra intuitivamente
    // hacia un lado del bloque, no hacia una esquina específica).
    // El centro se aproxima como label_W_pct/2 en X y label_H_pct/2 en Y.
    // Con pvW≈300 y pvH≈200 y label≈80×13px: HALF_W≈13%, HALF_H≈3%.
    // Zona de snap: 20% alrededor de cada borde del bloque de texto.
    // El lado se determina por cuál borde está más cerca del centro del label.
    const computeSide = (px: number, py: number, lW: number): number => {
      'worklet';
      // Centro del label en % del preview
      const HALF_W = (lW / pvW.value) * 50;       // label_W_px / pvW * 100 / 2
      const HALF_H = (13 / pvH.value) * 50;        // label height ≈ 13px
      const cx = px + HALF_W;
      const cy = py + HALF_H;

      const x1 = tbX.value, x2 = tbX.value + tbW.value;
      const y1 = tbY.value, y2 = tbY.value + tbH.value;

      // Zona de snap: 20% fuera de cada borde
      const MARGIN = 20;
      if (cx < x1 - MARGIN || cx > x2 + MARGIN) return 0;
      if (cy < y1 - MARGIN || cy > y2 + MARGIN) return 0;

      // El borde más cercano determina el lado
      const dTop    = Math.abs(cy - y1);
      const dBottom = Math.abs(cy - y2);
      const dLeft   = Math.abs(cx - x1);
      const dRight  = Math.abs(cx - x2);
      const minD    = Math.min(dTop, dBottom, dLeft, dRight);
      if (minD === dTop)    return 1;
      if (minD === dBottom) return 2;
      if (minD === dLeft)   return 3;
      return 4;
    };

    // ── Gesto izquierdo ────────────────────────────────────────────────────────
    const leftGesture = Gesture.Pan()
      .minDistance(4)
      .onBegin(() => {
        'worklet';
        const ss = lcSide.value;
        lcStartSide.value = ss;
        // Sincronizar lcX/lcY con la posición REAL que muestra el animated style,
        // para que rawX/rawY sean coherentes con la posición visual al iniciar el drag.
        if (ss === 1) lcY.value = tbY.value - (13 / pvH.value) * 100;
        if (ss === 2) lcY.value = tbY.value + tbH.value;
        // Sides 3/4: el layout_left depende del ancho real del label.
        // Guardamos ese layout_left% para que rawX sea coherente al arrastrar.
        if (ss === 3) {
          const cx = (tbX.value / 100) * pvW.value - 6.5; // center_x en px
          lcX.value = ((cx - lcLabelW.value / 2) / pvW.value) * 100;
        }
        if (ss === 4) {
          const cx = ((tbX.value + tbW.value) / 100) * pvW.value + 6.5;
          lcX.value = ((cx - lcLabelW.value / 2) / pvW.value) * 100;
        }
        lcSX.value = lcX.value;
        lcSY.value = lcY.value;
        // Sin rotación mientras se arrastra: se verá siempre horizontal
        lcSide.value = 0;
      })
      .onUpdate(e => {
        'worklet';
        const dx = (e.translationX / pvW.value) * 100;
        const dy = (e.translationY / pvH.value) * 100;
        const rawX = lcSX.value + dx;
        const rawY = lcSY.value + dy;
        const ss   = lcStartSide.value;

        if (ss === 0) {
          // Libre: movimiento completo
          lcX.value = Math.max(0, Math.min(95, rawX));
          lcY.value = Math.max(0, Math.min(95, rawY));
        } else {
          // Pegado: eje libre se mueve, eje restringido se deriva del bloque en el animated style.
          // Permite despegarse arrastrando > 14% en el eje perpendicular.
          const perpDist = (ss === 1 || ss === 2) ? Math.abs(dy) : Math.abs(dx);
          if (perpDist >= 14) {
            // Despegar
            lcX.value         = Math.max(0, Math.min(95, rawX));
            lcY.value         = Math.max(0, Math.min(95, rawY));
            lcStartSide.value = 0; // ya libre: si vuelve a estar cerca se re-pegará al soltar
          } else if (ss === 1 || ss === 2) {
            lcX.value = Math.max(0, Math.min(95, rawX)); // solo X libre
            // Y no se toca: el animated style lo pone en tbY directamente
          } else {
            lcY.value = Math.max(0, Math.min(95, rawY)); // solo Y libre
            // X no se toca: el animated style lo pone en tbX directamente
          }
        }
      })
      .onFinalize(() => {
        'worklet';
        // Detectar el side final y restaurar la rotación correcta
        const s = computeSide(lcX.value, lcY.value, lcLabelW.value);
        lcSide.value = s;
        runOnJS(syncLcPos)(lcX.value, lcY.value, s);
      });

    // ── Gesto derecho (mismo patrón con rc* vars) ─────────────────────────────
    const rightGesture = Gesture.Pan()
      .minDistance(4)
      .onBegin(() => {
        'worklet';
        const ss = rcSide.value;
        rcStartSide.value = ss;
        if (ss === 1) rcY.value = tbY.value - (13 / pvH.value) * 100;
        if (ss === 2) rcY.value = tbY.value + tbH.value;
        if (ss === 3) {
          const cx = (tbX.value / 100) * pvW.value - 6.5;
          rcX.value = ((cx - rcLabelW.value / 2) / pvW.value) * 100;
        }
        if (ss === 4) {
          const cx = ((tbX.value + tbW.value) / 100) * pvW.value + 6.5;
          rcX.value = ((cx - rcLabelW.value / 2) / pvW.value) * 100;
        }
        rcSX.value   = rcX.value;
        rcSY.value   = rcY.value;
        rcSide.value = 0;
      })
      .onUpdate(e => {
        'worklet';
        const dx = (e.translationX / pvW.value) * 100;
        const dy = (e.translationY / pvH.value) * 100;
        const rawX = rcSX.value + dx;
        const rawY = rcSY.value + dy;
        const ss   = rcStartSide.value;

        if (ss === 0) {
          rcX.value = Math.max(0, Math.min(95, rawX));
          rcY.value = Math.max(0, Math.min(95, rawY));
        } else {
          const perpDist = (ss === 1 || ss === 2) ? Math.abs(dy) : Math.abs(dx);
          if (perpDist >= 14) {
            rcX.value         = Math.max(0, Math.min(95, rawX));
            rcY.value         = Math.max(0, Math.min(95, rawY));
            rcStartSide.value = 0;
          } else if (ss === 1 || ss === 2) {
            rcX.value = Math.max(0, Math.min(95, rawX));
          } else {
            rcY.value = Math.max(0, Math.min(95, rawY));
          }
        }
      })
      .onFinalize(() => {
        'worklet';
        const s = computeSide(rcX.value, rcY.value, rcLabelW.value);
        rcSide.value = s;
        runOnJS(syncRcPos)(rcX.value, rcY.value, s);
      });

    return { left: leftGesture, right: rightGesture };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Focus en campos de nombre al activar modo "show" ──────────────────────
  useEffect(() => {
    if (leftCharMode === 'show') {
      const t = setTimeout(() => lcInputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [leftCharMode]);

  useEffect(() => {
    if (rightCharMode === 'show') {
      const t = setTimeout(() => rcInputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [rightCharMode]);

  // ── Cargar página si estamos editando ─────────────────────────────────────
  useEffect(() => {
    if (!isEditing || !pageId) return;
    (async () => {
      try {
        const snap = await getDoc(
          doc(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages', pageId as string)
        );
        if (!snap.exists()) return;
        const p = snap.data();
        setPageText(p.text ?? '');
        setBgUri(p.backgroundUrl || null);
        setBgUrl(p.backgroundUrl || '');
        setImageAnchor(p.imageAnchor ?? 'center');
        setImageFit(p.imageFit ?? 'cover');
        setTextSize(p.textSize ?? undefined);
        const tbl = p.textBoxLayout ?? DEFAULT_TB;
        setTbLayout(tbl); applyTbShared(tbl);
        if (p.musicUrl === undefined)    { setMusicMode('inherit'); }
        else if (p.musicUrl === null)    { setMusicMode('silence'); }
        else { setMusicMode('play'); setEditMusicUrl(p.musicUrl); setMusicFileName(decodeURIComponent(p.musicUrl.split('/').pop()?.split('?')[0] ?? 'Pista')); }
        setLinks(p.links ?? []);
        const npi = p.nextPageIndex ?? null;
        setNextPageIndex(npi);
        setNextPageInput(npi !== null ? String(npi + 1) : '');
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
      const perChapter = await Promise.all(
        chaptersSnap.docs.map(async chDoc => {
          const chTitle = (chDoc.data().title as string) ?? 'Capítulo';
          const pagesSnap = await getDocs(
            collection(db, 'stories', storyId as string, 'chapters', chDoc.id, 'pages')
          );
          return pagesSnap.docs.map((pDoc, idx): ChapterPageOption => ({
            chapterId: chDoc.id,
            chapterTitle: chTitle,
            pageId: pDoc.id,
            pageOrder: (pDoc.data().order as number) ?? idx + 1,
            pageIndex: idx,
            pageText: (pDoc.data().text as string) ?? '',
          }));
        })
      );
      // Ordenar en memoria: capítulos por createdAt si existe, páginas por order
      const flat = perChapter.flat();
      flat.sort((a, b) => {
        if (a.chapterId !== b.chapterId) return 0; // mantener orden de capítulos
        return a.pageOrder - b.pageOrder;
      });
      setPageOptions(flat);
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
    if (status !== 'granted') { Alert.alert('Permiso denegado', 'Necesitamos acceso a tu galería.'); return; }
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
        Alert.alert('Error al subir', e?.message ?? 'Inténtalo de nuevo.');
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
          const filename   = `music/${storyId}/${chapterId}/${Date.now()}.${ext}`;
          const storageRef = ref(storage, filename);
          const blob: Blob = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload  = () => resolve(xhr.response);
            xhr.onerror = () => reject(new Error('No se pudo leer el archivo'));
            xhr.responseType = 'blob'; xhr.open('GET', asset.uri, true); xhr.send(null);
          });
          await uploadBytes(storageRef, blob);
          const url = await getDownloadURL(storageRef);
          setEditMusicUrl(url); setMusicFileName(asset.name); setMusicMode('play');
        } catch (e: any) { Alert.alert('Error al subir música', e?.message ?? 'Inténtalo de nuevo.'); }
        finally { setUploadingMusic(false); }
      }
    } catch (e: any) { Alert.alert('Error', e?.message ?? 'No se pudo abrir el selector.'); }
  };

  // ── Guardar ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (saving || uploadingBg || uploadingMusic) return;
    setSaving(true);
    try {
      const musicForStore: string | null | undefined =
        musicMode === 'inherit' ? undefined : musicMode === 'silence' ? null : editMusicUrl;

      const cleanLinks = links.filter(l => l.word.trim());

      if (isEditing) {
        const updateData: any = {
          text: pageText, backgroundUrl: bgUrl, imageAnchor, imageFit,
          textBoxLayout: tbLayout,
          links: cleanLinks,
        };
        if (nextPageIndex !== null) updateData.nextPageIndex = nextPageIndex;
        else updateData.nextPageIndex = deleteField();
        if (textSize === undefined) updateData.textSize = deleteField();
        else updateData.textSize = textSize;
        if (musicMode === 'inherit')  updateData.musicUrl = deleteField();
        else if (musicMode === 'silence') updateData.musicUrl = null;
        else updateData.musicUrl = editMusicUrl;
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
        const newData: any = {
          text: pageText, backgroundUrl: bgUrl, imageAnchor, imageFit,
          textBoxLayout: tbLayout, order: pageNum,
          createdAt: new Date().toISOString(),
          links: cleanLinks,
        };
        if (nextPageIndex !== null) newData.nextPageIndex = nextPageIndex;
        if (textSize !== undefined) newData.textSize = textSize;
        if (musicMode === 'silence') newData.musicUrl = null;
        else if (musicMode === 'play' && editMusicUrl) newData.musicUrl = editMusicUrl;
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
      router.back();
    } catch (e) { console.error('Error guardando página:', e); }
    finally     { setSaving(false); }
  };

  // ── Tamaño de texto — opciones ────────────────────────────────────────────
  const previewFontSize = TEXT_SIZE_OPTIONS.find(o => o.value === (textSize ?? 'auto'))?.previewSize ?? 9;

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
        <TouchableOpacity
          style={[styles.saveBtn, (saving || uploadingBg || uploadingMusic) && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={saving || uploadingBg || uploadingMusic}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={styles.saveBtnText}>Guardar</Text>
          }
        </TouchableOpacity>
      </View>

      {/* ── Preview — ancho completo, ratio 16:9 ── */}
      <View
        style={styles.preview}
        onLayout={e => {
          pvW.value = e.nativeEvent.layout.width;
          pvH.value = e.nativeEvent.layout.height;
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
              />
            </View>
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        }
        <View style={styles.previewOverlay} />

        {/* Cuadro de texto redimensionable */}
        <Animated.View style={[styles.tbBox, linkMode && styles.tbBoxLinkMode, tbAnimStyle]}>
          <TextInput
            style={[styles.previewInput, {
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              paddingTop: 16, paddingHorizontal: 12, paddingBottom: 6,
              fontSize: previewFontSize,
              lineHeight: previewFontSize * 1.6,
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
              onLayout={e => { lcLabelW.value = e.nativeEvent.layout.width; }}
              style={[styles.previewCharLabel, lcAnimStyle]}
            >
              <MaterialIcons name="drag-indicator" size={8} color={Colors.emerald + 'AA'} />
              <Text style={[styles.previewCharLabelText, !leftCharName.trim() && { opacity: 0.4 }]} numberOfLines={1}>
                {leftCharName.trim() || 'POV / Protagonista'}
              </Text>
            </Animated.View>
          </GestureDetector>
        )}
        {rightCharMode === 'show' && (
          <GestureDetector gesture={charGestures.right}>
            <Animated.View
              onLayout={e => { rcLabelW.value = e.nativeEvent.layout.width; }}
              style={[styles.previewCharLabel, rcAnimStyle]}
            >
              <MaterialIcons name="drag-indicator" size={8} color={Colors.emerald + 'AA'} />
              <Text style={[styles.previewCharLabelText, !rightCharName.trim() && { opacity: 0.4 }]} numberOfLines={1}>
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

        {/* Botón reset layout — esquina superior derecha del preview */}
        <TouchableOpacity
          style={styles.resetTbBtn}
          onPress={() => { setTbLayout(DEFAULT_TB); applyTbShared(DEFAULT_TB); }}
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
                  onPress={() => setLeftCharMode(opt.value)}
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
                  key={`lc-${storyId}-${pageId ?? pageOrder}`}
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
                  onPress={() => setRightCharMode(opt.value)}
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
                  key={`rc-${storyId}-${pageId ?? pageOrder}`}
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
                  <Text style={styles.linkChipPage}>
                    {link.targetChapterId
                      ? `→ ${link.targetChapterTitle ?? 'Cap.'} p.${link.targetPageIndex + 1}`
                      : `→ p.${link.targetPageIndex + 1}`}
                  </Text>
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
              style={[styles.nextPageBtn, nextPageIndex === null && styles.nextPageBtnActive]}
              onPress={() => { setNextPageIndex(null); setNextPageInput(''); }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="arrow-forward" size={14} color={nextPageIndex === null ? '#000' : Colors.textSecondary} />
              <Text style={[styles.nextPageBtnText, nextPageIndex === null && styles.nextPageBtnTextActive]}>
                Siguiente
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextPageBtn, nextPageIndex !== null && styles.nextPageBtnActive]}
              onPress={() => { if (nextPageIndex === null) { setNextPageIndex(0); setNextPageInput('1'); } }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="call-split" size={14} color={nextPageIndex !== null ? '#000' : Colors.textSecondary} />
              <Text style={[styles.nextPageBtnText, nextPageIndex !== null && styles.nextPageBtnTextActive]}>
                Saltar a
              </Text>
            </TouchableOpacity>
            {nextPageIndex !== null && (
              <View style={styles.nextPageInputWrap}>
                <Text style={styles.nextPageInputLabel}>pág.</Text>
                <TextInput
                  style={styles.nextPageInput}
                  value={nextPageInput}
                  onChangeText={v => {
                    setNextPageInput(v);
                    const n = parseInt(v, 10);
                    if (!isNaN(n) && n >= 1) setNextPageIndex(n - 1);
                  }}
                  placeholder="1"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={3}
                  autoFocus
                />
              </View>
            )}
          </View>
          {nextPageIndex !== null && (
            <Text style={styles.nextPageHint}>
              Al pasar esta página el lector saltará a la página {nextPageIndex + 1}
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
  saveBtn:     { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 6, backgroundColor: '#000', minWidth: 80, alignItems: 'center' },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: Colors.emerald, letterSpacing: 0.4 },

  // Preview — 16:9
  preview: {
    width: '100%',
    aspectRatio: 16 / 9,
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

  previewCharLabel: {
    backgroundColor: 'rgba(22,24,30,0.88)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderColor: Colors.emerald + '60',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: 140,
  },
  previewCharLabelText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 7,
    fontWeight: '700',
    color: Colors.emerald,
    flexShrink: 1,
  },
});

