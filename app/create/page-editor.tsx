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
  PanResponder,
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
import { db } from '@/config/firebase';
import { uploadImage, uploadLocalFile, mediaDisplayName, rememberMediaNames } from '@/services/media';
import { sortChapters } from '@/services/stories';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS, type SharedValue } from 'react-native-reanimated';
// TouchableOpacity de RNGH: necesario para que los botones dentro del ScrollView funcionen
// correctamente junto con los GestureDetectors del preview.
// Para los TextInput de nombre usamos refs + .focus() programático que bypasea el sistema de gestos.
import { GestureDetector, Gesture, TouchableOpacity } from 'react-native-gesture-handler';
import { STORY_FONT,
  REF_SCREEN, FONT_SIZES, TEXT_BOX, CHAR_LABEL, BG_BLUR_DEFAULT, BG_BLUR_MAX, BG_BLUR_PRESETS,
  MUSIC_VOLUME_MIN, MUSIC_VOLUME_MAX, MUSIC_VOLUME_STEP, SFX_VOLUME_MAX,
  musicPlaybackVolume, sfxPlaybackVolume, pageSfxCues, splitParagraphs,
  PAGE_TRANSITIONS, type PageTransition,
  pageExtraBoxes, EXTRA_BOX_MAX, EXTRA_BOX_STYLE, EXTRA_BOX_SLIDES, EXTRA_BOX_WIPES, type ExtraBoxAnimation,
  charLabelPos, charLabelSideStyle,
  type TextSize,
} from '@/constants/reader-layout';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { deleteUnusedMedia } from '@/services/stories';
import { useSaveShortcut } from '@/hooks/use-save-shortcut';
import { useLeaveWarning } from '@/hooks/use-leave-warning';
import { withUploadNotice } from '@/components/upload-notice';
import { tutorialZone } from '@/components/tutorial';
import { ts, useT } from '@/i18n';

// ─── Tipos ───────────────────────────────────────────────────────────────────
type ImageAnchor   = 'top' | 'center' | 'bottom';
type ImageFit      = 'cover' | 'contain';
type MusicMode     = 'inherit' | 'play' | 'silence';
type CharMode      = 'inherit' | 'show' | 'hide';
type TextBoxLayout = { x: number; y: number; w: number; h: number };

const DEFAULT_TB: TextBoxLayout = { x: 11, y: 23, w: 78, h: 53 };
const TB_CLIPBOARD_KEY = 'immersa_textbox_clipboard';

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
      { text: ts('Cancelar'), style: 'cancel' },
      { text: confirmText, style: 'destructive', onPress: onConfirm },
    ]);
  }
}

// De dónde sale un fondo, una pista o un sonido
const MEDIA_SOURCES = ['file', 'url', 'library'] as const;
type MediaSource = typeof MEDIA_SOURCES[number];
const MEDIA_SOURCE_ICON  = { file: 'upload-file', url: 'link', library: 'collections' } as const;
const MEDIA_SOURCE_LABEL = { file: 'Archivo', url: 'URL / Drive', library: 'Ya subidos' } as const;

// Archivos ya usados en la historia (para reutilizarlos sin volver a subirlos)
type MediaLibrary = { images: string[]; music: string[]; sfx: string[] };
type PreviewBg = { uri: string; anchor: ImageAnchor; fit: ImageFit; blur: number };
// Cuadro de texto extra en edición (id solo para la lista; target = nº de página o '')
type EditorExtraBox = {
  id: string; text: string; x: number; y: number; w: number;
  h: number | null;          // null = alto automático (se ajusta al texto)
  rotation: number; paragraph: number; target: string;
  animation: ExtraBoxAnimation;
};
let extraBoxSeq = 0;
const ROTATION_PRESETS = [
  { value: 0, label: 'Recto' }, { value: -90, label: 'Vertical ↑' }, { value: 90, label: 'Vertical ↓' },
  { value: -20, label: 'Diagonal ↗' }, { value: 20, label: 'Diagonal ↘' },
];
// Un cuadro girado puede necesitar salirse del escenario para llegar a los bordes
// (gira sobre su centro), así que la posición admite valores negativos
const clampPos = (v: number) => Math.max(-80, Math.min(100, Math.round(v * 10) / 10));
const clampSize = (v: number, min: number) => Math.max(min, Math.min(100, Math.round(v * 10) / 10));

// Cuadro extra en la vista previa: se arrastra para moverlo y se estira desde su
// esquina inferior derecha para cambiarle el tamaño, como el cuadro principal.
function PreviewExtraBox({ box, pvWidth, pvHeight, pvScale, fontSize, onChange }: {
  box: EditorExtraBox; pvWidth: number; pvHeight: number; pvScale: number; fontSize: number;
  onChange: (patch: Partial<EditorExtraBox>) => void;
}) {
  const live = useRef({ box, pvWidth, pvHeight, onChange, measuredH: 0 });
  live.current.box = box; live.current.pvWidth = pvWidth; live.current.pvHeight = pvHeight; live.current.onChange = onChange;
  const start = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const movePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current.x = live.current.box.x; start.current.y = live.current.box.y; },
    onPanResponderMove: (_e, g) => {
      const { pvWidth: w, pvHeight: h, onChange: change } = live.current;
      if (!w || !h) return;
      change({ x: clampPos(start.current.x + (g.dx / w) * 100), y: clampPos(start.current.y + (g.dy / h) * 100) });
    },
  })).current;

  const resizePan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      const { box: b, pvHeight: h, measuredH } = live.current;
      start.current.w = b.w;
      start.current.h = b.h ?? (h ? (measuredH / h) * 100 : 20);
    },
    onPanResponderMove: (_e, g) => {
      const { box: b, pvWidth: w, pvHeight: h, onChange: change } = live.current;
      if (!w || !h) return;
      // El arrastre se pasa a los ejes del cuadro, que puede estar girado
      const a = (-b.rotation * Math.PI) / 180;
      const dx = g.dx * Math.cos(a) - g.dy * Math.sin(a);
      const dy = g.dx * Math.sin(a) + g.dy * Math.cos(a);
      change({
        w: clampSize(start.current.w + (dx / w) * 100, 6),
        h: clampSize(start.current.h + (dy / h) * 100, 5),
      });
    },
  })).current;

  // Mismo margen interior que deja el texto con borde en el lector
  const outlinePad = Math.max(1.5, 2 * pvScale) + 1;
  return (
    <View
      {...movePan.panHandlers}
      onLayout={e => { live.current.measuredH = e.nativeEvent.layout.height; }}
      style={{
        position: 'absolute',
        left: (box.x / 100) * pvWidth,
        top: (box.y / 100) * pvHeight,
        width: (box.w / 100) * pvWidth,
        height: box.h ? (box.h / 100) * pvHeight : undefined,
        transform: [{ rotate: `${box.rotation}deg` }],
        backgroundColor: 'rgba(22,24,30,0.82)',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: Colors.aqua,
        borderRadius: EXTRA_BOX_STYLE.radius * pvScale,
        paddingHorizontal: EXTRA_BOX_STYLE.paddingHorizontal * pvScale + outlinePad,
        paddingVertical: EXTRA_BOX_STYLE.paddingVertical * pvScale,
        ...(Platform.OS === 'web' ? ({ cursor: 'move', userSelect: 'none' } as any) : null),
      }}
    >
      <View style={{ flex: box.h ? 1 : undefined, overflow: 'hidden' }}>
        <Text
          style={{
            color: '#fff', fontWeight: '700', fontSize, lineHeight: fontSize * 1.5,
            letterSpacing: TEXT_BOX.letterSpacing * pvScale,
            fontFamily: STORY_FONT,
          }}
        >
          {box.text || ts('Texto…')}
        </Text>
      </View>
      {/* Tirador para cambiar el tamaño */}
      <View
        {...resizePan.panHandlers}
        style={{
          position: 'absolute', right: -7, bottom: -7, width: 14, height: 14, borderRadius: 4,
          backgroundColor: Colors.aqua,
          ...(Platform.OS === 'web' ? ({ cursor: 'nwse-resize' } as any) : null),
        }}
        hitSlop={10}
      />
    </View>
  );
}

// Efecto de sonido en edición (id solo para la lista de la pantalla)
type EditorSfxCue = { id: string; paragraph: number; url: string; name: string; volume: number };
let sfxCueSeq = 0;
const newSfxCue = (url: string, name: string, paragraph = 1, volume = 1): EditorSfxCue =>
  ({ id: `cue${++sfxCueSeq}`, paragraph, url, name, volume });

// Lista de archivos ya usados en la historia, para elegir uno
function MediaLibraryPicker({ kind, loading, urls, onPick }: {
  kind: 'image' | 'audio';
  loading: boolean;
  urls: string[];
  onPick: (url: string) => void;
}) {
  useT();
  if (loading) {
    return <ActivityIndicator color={Colors.emerald} style={{ marginVertical: 12 }} />;
  }
  if (urls.length === 0) {
    return (
      <Text style={styles.libraryEmpty}>
        {kind === 'image'
          ? ts('Todavía no hay imágenes en esta historia.')
          : ts('Todavía no hay audios de este tipo en esta historia.')}
      </Text>
    );
  }
  if (kind === 'image') {
    return (
      <View style={styles.libraryGrid}>
        {urls.map(url => (
          <TouchableOpacity key={url} style={styles.libraryThumb} onPress={() => onPick(url)} activeOpacity={0.8}>
            <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          </TouchableOpacity>
        ))}
      </View>
    );
  }
  return (
    <View>
      {urls.map(url => (
        <TouchableOpacity key={url} style={styles.libraryRow} onPress={() => onPick(url)} activeOpacity={0.8}>
          <MaterialIcons name="audiotrack" size={14} color={Colors.aqua} />
          <Text style={styles.libraryRowText} numberOfLines={1}>{fileNameFromUrl(url, 'Audio')}</Text>
          <Text style={styles.libraryRowUse}>{ts('Usar')}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Nombre para mostrar de un archivo: el que le puso el autor en el gestor de archivos o,
// si no, el del propio archivo (sin la carpeta ni la marca de tiempo).
const fileNameFromUrl = mediaDisplayName;
// Nombre con el que se guarda un archivo subido: una marca de tiempo (para que no choque
// con otro igual) seguida de su nombre original, que es el que se enseña después.
const storedFileName = (originalName: string, fallbackExt: string) => {
  const clean = originalName.trim().replace(/[\/#?%*:|"<>\[\]]/g, '_').slice(-80);
  return `${Date.now()}_${clean.includes('.') ? clean : `${clean || 'archivo'}.${fallbackExt}`}`;
};

// Fila "Volumen: − 100% +  [Escuchar]" (música y efecto de sonido).
// Ajusta cómo suena en el lector; no modifica el archivo de audio.
function VolumeRow({ value, min, max, onStep, playing, onTogglePlay }: {
  value: number; min: number; max: number;
  onStep: (delta: number) => void;
  playing: boolean; onTogglePlay: () => void;
}) {
  useT();
  return (
    <View style={styles.anchorRow}>
      <Text style={styles.anchorLabel}>{ts('Volumen:')}</Text>
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
          {playing ? ts('Parar') : ts('Escuchar')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────
export default function PageEditorScreen() {
  useT();
  const isDesktop = useIsDesktop();
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
  // Sin imagen: heredar la de la página anterior (false) o dejar el fondo en negro (true)
  const [bgNone, setBgNone]             = useState(false);
  // Fondo que esta página heredaría de las anteriores del capítulo (para la vista previa)
  const [inheritedBg, setInheritedBg]   = useState<PreviewBg | null>(null);
  const [uploadingBg, setUploadingBg]   = useState(false);
  const [imageSource, setImageSource]   = useState<MediaSource>('file');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [musicMode, setMusicMode]       = useState<MusicMode>('inherit');
  const [editMusicUrl, setEditMusicUrl] = useState('');
  const [musicFileName, setMusicFileName] = useState('');
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [musicSource, setMusicSource]   = useState<MediaSource>('file');
  const [musicUrlInput, setMusicUrlInput] = useState('');
  const [musicVolume, setMusicVolume]   = useState(1);       // ajuste del autor (1 = 100 %)
  // Párrafo en el que empieza la música de esta página (1 = al llegar) y qué suena antes
  const [musicParagraph, setMusicParagraph] = useState(1);
  const [musicBeforeSilence, setMusicBeforeSilence] = useState(false);
  // Silencio momentáneo: la música se calla entre dos párrafos (sea propia o heredada)
  const [quietOn, setQuietOn]           = useState(false);
  const [quietFrom, setQuietFrom]       = useState(1);
  const [quietTo, setQuietTo]           = useState(1);
  const [previewingMusic, setPreviewingMusic] = useState(false);
  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const [textSize, setTextSize]         = useState<TextSize | undefined>(undefined);
  const [tbLayout, setTbLayout]         = useState<TextBoxLayout>(DEFAULT_TB);
  // Ancho real de la preview: escala del lector (pantalla de referencia) a la preview
  const [pvWidth, setPvWidth]           = useState(390);
  const [links, setLinks]               = useState<PageLink[]>([]);
  // "Al pasar la página": saltar a otra página del capítulo (se guarda su id)
  const [jumpEnabled, setJumpEnabled]   = useState(false);
  // Página de solo ilustración: se ve el fondo, sin cuadro de texto
  const [hideTextBox, setHideTextBox]   = useState(false);
  // Cuadro de texto copiado (se guarda en el dispositivo: sirve entre páginas,
  // capítulos e historias)
  const [tbClipboard, setTbClipboard]   = useState<TextBoxLayout | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(TB_CLIPBOARD_KEY)
      .then(raw => { if (raw) setTbClipboard(JSON.parse(raw)); })
      .catch(() => {});
  }, []);
  const copyTextBox = () => {
    setTbClipboard(tbLayout);
    AsyncStorage.setItem(TB_CLIPBOARD_KEY, JSON.stringify(tbLayout)).catch(() => {});
  };
  const pasteTextBox = () => {
    if (!tbClipboard) return;
    setTbLayout(tbClipboard);
    applyTbShared(tbClipboard);
  };
  // Animación al pasar esta página (undefined = heredar de la página anterior)
  const [transition, setTransition]     = useState<PageTransition | undefined>(undefined);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const transitionOption = PAGE_TRANSITIONS.find(o => o.value === transition)
    ?? { label: ts('Heredar'), icon: 'subdirectory-arrow-right' };
  const [nextPageInput, setNextPageInput] = useState('');
  // Ids de las páginas del capítulo en orden: traduce número de página ↔ id
  const [chapterPageIds, setChapterPageIds] = useState<string[]>([]);
  // Efecto de sonido (se reproduce una vez al llegar a la página; no se hereda)
  // Efectos de sonido: varios por página, cada uno ligado al párrafo en el que suena
  const [sfxCues, setSfxCues]           = useState<EditorSfxCue[]>([]);
  const [uploadingSfx, setUploadingSfx] = useState(false);
  const [sfxSource, setSfxSource]       = useState<MediaSource>('file');
  const [sfxUrlInput, setSfxUrlInput]   = useState('');
  const [previewingSfxId, setPreviewingSfxId] = useState<string | null>(null);
  // Cuadros de texto extra (voces de fondo, rótulos, decisiones)
  const [extraBoxes, setExtraBoxes]     = useState<EditorExtraBox[]>([]);
  const addExtraBox = () => setExtraBoxes(list => list.length >= EXTRA_BOX_MAX ? list : [
    ...list,
    {
      id: `box${++extraBoxSeq}`, text: '', x: 8 + list.length * 6, y: 6 + list.length * 8, w: 30, h: null,
      rotation: 0, paragraph: 1, target: '', animation: 'fade',
    },
  ]);
  const updateExtraBox = (id: string, patch: Partial<EditorExtraBox>) =>
    setExtraBoxes(list => list.map(b => (b.id === id ? { ...b, ...patch } : b)));
  const removeExtraBox = (id: string) => setExtraBoxes(list => list.filter(b => b.id !== id));
  const sfxPreviewRef = useRef<Audio.Sound | null>(null);
  // Archivos ya usados en la historia: se cargan la primera vez que se elige "Ya subidos"
  const [mediaLibrary, setMediaLibrary]     = useState<MediaLibrary | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
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
          // (y, de paso, los nombres que el autor ha puesto a sus archivos)
          getDoc(doc(db, 'stories', storyId as string))
            .then(s => rememberMediaNames(s.data()?.mediaNames)).catch(() => {})
            .then(() => (isEditing && pageId
            ? getDoc(doc(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages', pageId as string))
            : null)),
          getDocs(query(
            collection(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages'),
            orderBy('order', 'asc'),
          )),
        ]);
        const ids = pagesSnap.docs.map(d => d.id);
        setChapterPageIds(ids);
        // Fondo heredado: el de la página anterior más cercana que lo defina. Una página
        // "sin fondo" corta la herencia. (Una página nueva va al final del capítulo.)
        const here = isEditing && pageId ? ids.indexOf(pageId as string) : ids.length;
        for (let i = (here < 0 ? ids.length : here) - 1; i >= 0; i--) {
          const prev = pagesSnap.docs[i].data();
          if (prev.backgroundUrl) {
            setInheritedBg({
              uri: prev.backgroundUrl,
              anchor: prev.imageAnchor ?? 'center',
              fit: prev.imageFit ?? 'cover',
              blur: prev.bgBlur ?? BG_BLUR_DEFAULT,
            });
            break;
          }
          if (prev.bgNone) break;
        }
        if (!snap || !snap.exists()) return;
        const p = snap.data();
        setPageText(p.text ?? '');
        setBgUri(p.backgroundUrl || null);
        setBgUrl(p.backgroundUrl || '');
        setImageAnchor(p.imageAnchor ?? 'center');
        setImageFit(p.imageFit ?? 'cover');
        setBgBlur(p.bgBlur ?? BG_BLUR_DEFAULT);
        setBgNone(p.bgNone === true);
        setTextSize(p.textSize ?? undefined);
        const tbl = p.textBoxLayout ?? DEFAULT_TB;
        setTbLayout(tbl); applyTbShared(tbl);
        if (p.musicUrl === undefined)    { setMusicMode('inherit'); }
        else if (p.musicUrl === null)    { setMusicMode('silence'); }
        else { setMusicMode('play'); setMusicVolume(p.musicVolume ?? 1);
          setMusicParagraph(p.musicParagraph ?? 1); setMusicBeforeSilence(p.musicBefore === 'silence');
          setEditMusicUrl(p.musicUrl); setMusicFileName(fileNameFromUrl(p.musicUrl, 'Pista')); }
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
        setHideTextBox(p.hideTextBox === true);
        setExtraBoxes(pageExtraBoxes(p).map(b => {
          const targetIdx = b.targetPageId ? ids.indexOf(b.targetPageId) : -1;
          return {
            id: `box${++extraBoxSeq}`, text: b.text, x: b.x, y: b.y, w: b.w, h: b.h ?? null,
            rotation: b.rotation ?? 0, paragraph: b.paragraph ?? 1, animation: b.animation ?? 'fade',
            target: targetIdx >= 0 ? String(targetIdx + 1) : '',
          };
        }));
        setTransition(p.transition ?? undefined);
        if (p.musicQuiet) {
          setQuietOn(true); setQuietFrom(p.musicQuiet.from ?? 1); setQuietTo(p.musicQuiet.to ?? p.musicQuiet.from ?? 1);
        }
        setSfxCues(pageSfxCues(p).map(c =>
          newSfxCue(c.url, fileNameFromUrl(c.url, 'Efecto'), c.paragraph, c.volume ?? 1)));
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
          const chTitle = (chDoc.data().title as string) ?? ts('Capítulo');
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
        chapterTitle = (chSnap.data()?.title as string) ?? ts('Capítulo');
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

  const handlePickImage = () => withUploadNotice(pickImage);
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { AppAlert.alert(ts('Permiso denegado'), ts('Necesitamos acceso a tu galería.')); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      setBgUri(localUri);
      setUploadingBg(true);
      try {
        const url = await uploadImage(localUri, `pages/${storyId}/${chapterId}/${Date.now()}`, 2560);
        setBgUrl(url); setBgUri(url);
      } catch (e: any) {
        AppAlert.alert(ts('Error al subir'), e?.message ?? ts('Inténtalo de nuevo.'));
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

  const handlePickAudio = () => withUploadNotice(pickAudio);
  const pickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setUploadingMusic(true);
        try {
          const url = await uploadLocalFile(asset.uri, `music/${storyId}/${chapterId}/${storedFileName(asset.name, 'mp3')}`);
          setEditMusicUrl(url); setMusicFileName(asset.name); setMusicMode('play');
        } catch (e: any) { AppAlert.alert(ts('Error al subir música'), e?.message ?? ts('Inténtalo de nuevo.')); }
        finally { setUploadingMusic(false); }
      }
    } catch (e: any) { AppAlert.alert(ts('Error'), e?.message ?? ts('No se pudo abrir el selector.')); }
  };

  // ── Escuchar la pista en el editor (con el volumen elegido) ───────────────
  // Cada "Escuchar" lleva un número de turno. Si se para (o se pide otro) mientras el
  // audio aún se está cargando, al terminar de cargar ve que su turno ya pasó y se
  // descarta. Sin esto quedaba sonando sin botón que lo parase.
  const musicPreviewTurn = useRef(0);
  const sfxPreviewTurn = useRef(0);

  const stopMusicPreview = useCallback(() => {
    musicPreviewTurn.current++;
    const s = previewSoundRef.current;
    previewSoundRef.current = null;
    setPreviewingMusic(false);
    s?.stopAsync().catch(() => {});
    s?.unloadAsync().catch(() => {});
  }, []);

  const toggleMusicPreview = async () => {
    if (previewingMusic) { stopMusicPreview(); return; }
    if (!editMusicUrl) return;
    const turn = ++musicPreviewTurn.current;
    setPreviewingMusic(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: editMusicUrl },
        { shouldPlay: true, isLooping: true, volume: musicPlaybackVolume(musicVolume) },
      );
      if (turn !== musicPreviewTurn.current) { // se paró mientras cargaba
        sound.stopAsync().catch(() => {});
        sound.unloadAsync().catch(() => {});
        return;
      }
      previewSoundRef.current = sound;
    } catch (e: any) {
      if (turn !== musicPreviewTurn.current) return;
      setPreviewingMusic(false);
      AppAlert.alert(ts('No se pudo reproducir'), e?.message ?? ts('Comprueba el archivo o el enlace.'));
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
  // ── Efectos de sonido: añadir, mover de párrafo, volumen, quitar ───────────
  const paragraphCount = Math.max(1, splitParagraphs(pageText).length);
  const addSfxCue = (url: string, name: string) =>
    setSfxCues(list => [...list, newSfxCue(url, name)]);
  const updateSfxCue = (id: string, patch: Partial<EditorSfxCue>) =>
    setSfxCues(list => list.map(c => (c.id === id ? { ...c, ...patch } : c)));
  const removeSfxCue = (id: string) => {
    if (previewingSfxId === id) stopSfxPreview();
    setSfxCues(list => list.filter(c => c.id !== id));
  };
  const changeSfxCueVolume = (cue: EditorSfxCue, delta: number) => {
    const volume = stepVolume(cue.volume, delta, SFX_VOLUME_MAX);
    updateSfxCue(cue.id, { volume });
    if (previewingSfxId === cue.id) {
      sfxPreviewRef.current?.setVolumeAsync(sfxPlaybackVolume(volume)).catch(() => {});
    }
  };

  // ── Escuchar el efecto de sonido (una vez, con el volumen elegido) ─────────
  const stopSfxPreview = useCallback(() => {
    sfxPreviewTurn.current++;
    const s = sfxPreviewRef.current;
    sfxPreviewRef.current = null;
    setPreviewingSfxId(null);
    s?.stopAsync().catch(() => {});
    s?.unloadAsync().catch(() => {});
  }, []);

  const toggleSfxPreview = async (cue: EditorSfxCue) => {
    const wasPlaying = previewingSfxId === cue.id;
    stopSfxPreview();
    if (wasPlaying) return;
    const turn = ++sfxPreviewTurn.current;
    setPreviewingSfxId(cue.id);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: cue.url },
        { shouldPlay: true, volume: sfxPlaybackVolume(cue.volume) },
      );
      if (turn !== sfxPreviewTurn.current) { // se paró mientras cargaba
        sound.stopAsync().catch(() => {});
        sound.unloadAsync().catch(() => {});
        return;
      }
      sfxPreviewRef.current = sound;
      sound.setOnPlaybackStatusUpdate(status => {
        if (status.isLoaded && status.didJustFinish) stopSfxPreview();
      });
    } catch (e: any) {
      if (turn !== sfxPreviewTurn.current) return;
      setPreviewingSfxId(null);
      AppAlert.alert(ts('No se pudo reproducir'), e?.message ?? ts('Comprueba el archivo o el enlace.'));
    }
  };

  // Al salir de la pantalla (también al ir a "Probar") se para lo que esté sonando
  useFocusEffect(useCallback(() => () => { stopMusicPreview(); stopSfxPreview(); }, [stopMusicPreview, stopSfxPreview]));

  // ── Biblioteca de archivos de la historia ─────────────────────────────────
  // Recorre las páginas de todos los capítulos y reúne los fondos, pistas y sonidos
  // que ya se usan, sin repetir. Elegir uno reutiliza el mismo archivo: no ocupa más.
  const usesLibrary = imageSource === 'library' || musicSource === 'library' || sfxSource === 'library';
  useEffect(() => {
    if (!usesLibrary || mediaLibrary || loadingLibrary || !storyId) return;
    setLoadingLibrary(true);
    (async () => {
      const images = new Set<string>(), music = new Set<string>(), sfx = new Set<string>();
      try {
        const chaptersSnap = await getDocs(collection(db, 'stories', storyId as string, 'chapters'));
        await Promise.all(chaptersSnap.docs.map(async ch => {
          const pagesSnap = await getDocs(collection(db, 'stories', storyId as string, 'chapters', ch.id, 'pages'));
          pagesSnap.docs.forEach(p => {
            const d = p.data();
            if (d.backgroundUrl) images.add(d.backgroundUrl);
            if (typeof d.musicUrl === 'string' && d.musicUrl) music.add(d.musicUrl);
            pageSfxCues(d).forEach(c => sfx.add(c.url));
          });
        }));
      } catch (e) {
        console.error('Error cargando los archivos de la historia:', e);
      }
      setMediaLibrary({ images: [...images], music: [...music], sfx: [...sfx] });
      setLoadingLibrary(false);
    })();
  }, [usesLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers de efecto de sonido ──────────────────────────────────────────
  const handleUseSfxUrl = () => {
    if (!sfxUrlInput.trim()) return;
    addSfxCue(normalizeMediaUrl(sfxUrlInput), sfxUrlInput.trim());
    setSfxUrlInput('');
  };

  const handlePickSfx = () => withUploadNotice(pickSfx);
  const pickSfx = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      setUploadingSfx(true);
      try {
        const url = await uploadLocalFile(asset.uri, `sfx/${storyId}/${chapterId}/${storedFileName(asset.name, 'mp3')}`);
        addSfxCue(url, asset.name);
      } catch (e: any) { AppAlert.alert(ts('Error al subir el sonido'), e?.message ?? ts('Inténtalo de nuevo.')); }
      finally { setUploadingSfx(false); }
    } catch (e: any) { AppAlert.alert(ts('Error'), e?.message ?? ts('No se pudo abrir el selector.')); }
  };

  // ── Cambios sin guardar ───────────────────────────────────────────────────
  // Instantánea de todo lo que se guarda; si difiere de la inicial hay cambios.
  const snapshot = JSON.stringify({
    pageText, bgUrl, imageAnchor, imageFit, bgBlur, bgNone, musicMode, musicVolume, musicParagraph, musicBeforeSilence, quietOn, quietFrom, quietTo, editMusicUrl, textSize, tbLayout, links,
    jumpEnabled, nextPageInput, hideTextBox, transition: transition ?? null,
    sfxCues: sfxCues.map(c => ({ paragraph: c.paragraph, url: c.url, volume: c.volume })),
    extraBoxes: extraBoxes.map(({ id, ...rest }) => rest),
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
  useLeaveWarning(isDirtyRef); // navegador: avisa al cerrar la pestaña con cambios

  // ── Archivos que dejan de usarse ──────────────────────────────────────────
  // Se apuntan todos los archivos que pasan por esta página mientras se edita (los que
  // tenía y los que se suben o eligen). Al guardar, los que ya no estén en la página se
  // borran del almacenamiento si no los usa ninguna otra; al salir sin guardar, se
  // borran los que se subieron en esta sesión.
  const currentMedia = [bgUrl, editMusicUrl, ...sfxCues.map(c => c.url)].filter(Boolean);
  const currentMediaKey = currentMedia.join('|');
  const seenMediaRef = useRef(new Set<string>());
  const originalMediaRef = useRef<string[] | null>(null);
  const currentMediaRef = useRef<string[]>([]);
  currentMediaRef.current = currentMedia;
  useEffect(() => {
    if (loading) return;
    if (originalMediaRef.current === null) originalMediaRef.current = currentMedia;
    currentMedia.forEach(u => seenMediaRef.current.add(u));
  }, [loading, currentMediaKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // keep: archivos que deben conservarse pase lo que pase
  const cleanUpMedia = (keep: string[]) => {
    const leftovers = [...seenMediaRef.current].filter(u => !keep.includes(u));
    // La página actual no cuenta como "uso": lo que queda en ella está en `keep`
    if (leftovers.length) deleteUnusedMedia(storyId as string, leftovers, pageId ? [pageId as string] : []);
  };

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
    setBgNone(!!d.bgNone);
    setMusicMode(d.musicMode ?? 'inherit'); setMusicVolume(d.musicVolume ?? 1);
    setMusicParagraph(d.musicParagraph ?? 1); setMusicBeforeSilence(!!d.musicBeforeSilence);
    setQuietOn(!!d.quietOn); setQuietFrom(d.quietFrom ?? 1); setQuietTo(d.quietTo ?? 1);
    setEditMusicUrl(d.editMusicUrl ?? '');
    setMusicFileName(d.editMusicUrl ? fileNameFromUrl(d.editMusicUrl, 'Pista') : '');
    setTextSize(d.textSize ?? undefined);
    if (d.tbLayout) { setTbLayout(d.tbLayout); applyTbShared(d.tbLayout); }
    setLinks(d.links ?? []);
    setJumpEnabled(!!d.jumpEnabled); setNextPageInput(d.nextPageInput ?? '');
    setHideTextBox(!!d.hideTextBox);
    setExtraBoxes(Array.isArray(d.extraBoxes)
      ? d.extraBoxes.map((b: any) => ({ h: null, animation: 'fade', ...b, id: `box${++extraBoxSeq}` }))
      : []);
    setTransition(d.transition ?? undefined);
    setSfxCues(pageSfxCues(d).map(c =>
      newSfxCue(c.url, fileNameFromUrl(c.url, 'Efecto'), c.paragraph, c.volume ?? 1)));
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
      const message = ts('Hay cambios de esta página que no llegaste a guardar. ¿Quieres recuperarlos?');
      if (Platform.OS === 'web') {
        if ((window as any).confirm(`Borrador sin guardar\n\n${message}`)) restore(); else discard();
      } else {
        AppAlert.alert(ts('Borrador sin guardar'), message, [
          { text: ts('Descartar'), style: 'destructive', onPress: discard },
          { text: ts('Recuperar'), onPress: restore },
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
        ts('Cambios sin guardar'),
        ts('Si sales ahora perderás los cambios de esta página.'),
        ts('Salir sin guardar'),
        () => {
          allowLeaveRef.current = true;
          clearDraft();
          // Lo subido en esta sesión no se llegó a guardar: se borra
          cleanUpMedia(originalMediaRef.current ?? []);
          navigation.dispatch(e.data.action);
        },
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
        ts('Cambios sin guardar'),
        ts('El lector mostrará la última versión guardada de esta página.'),
        ts('Probar igualmente'),
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
        AppAlert.alert(ts('Página no válida'), ts('El capítulo no tiene una página {n}.', { n: nextPageInput || ts('(vacía)') }));
        return;
      }
    }

    setSaving(true);
    try {
      const musicForStore: string | null | undefined =
        musicMode === 'inherit' ? undefined : musicMode === 'silence' ? null : editMusicUrl;

      const cleanLinks = links.filter(l => l.word.trim());
      // Silencio momentáneo de la música
      const quietA = Math.min(quietFrom, paragraphCount);
      const savedQuiet = quietOn
        ? { from: quietA, to: Math.max(quietA, Math.min(quietTo, paragraphCount)) }
        : null;
      // Cuadros de texto extra: solo los que tienen texto; el destino, por id de página
      const savedExtraBoxes = extraBoxes.filter(b => b.text.trim()).map(b => {
        const targetId = chapterPageIds[parseInt(b.target, 10) - 1];
        const saved: Record<string, unknown> = {
          text: b.text.trim(), x: b.x, y: b.y, w: b.w,
          paragraph: Math.min(b.paragraph, paragraphCount),
        };
        if (b.h) saved.h = b.h;
        if (b.rotation) saved.rotation = b.rotation;
        if (b.animation !== 'fade') saved.animation = b.animation;
        if (targetId) saved.targetPageId = targetId;
        return saved;
      });
      // Música que empieza en un párrafo posterior al primero
      const savedMusicParagraph = Math.min(musicParagraph, paragraphCount);
      const delayedMusic = musicMode === 'play' && !!editMusicUrl && savedMusicParagraph > 1;
      // Efectos de sonido: en orden de párrafo; el volumen solo se guarda si no es el normal
      const savedSfxCues = [...sfxCues]
        .map(c => ({ ...c, paragraph: Math.min(c.paragraph, paragraphCount) }))
        .sort((a, b) => a.paragraph - b.paragraph)
        .map(c => (c.volume !== 1
          ? { paragraph: c.paragraph, url: c.url, volume: c.volume }
          : { paragraph: c.paragraph, url: c.url }));
      const legacySfx: { url: string; volume?: number } | undefined = savedSfxCues.find(c => c.paragraph === 1);

      if (isEditing) {
        const updateData: any = {
          text: pageText, backgroundUrl: bgUrl, imageAnchor, imageFit, bgBlur,
          textBoxLayout: tbLayout,
          links: cleanLinks,
        };
        updateData.nextPageId    = nextPageId ?? deleteField();
        updateData.nextPageIndex = deleteField(); // formato antiguo (por número)
        updateData.hideTextBox   = hideTextBox ? true : deleteField();
        updateData.bgNone        = !bgUrl && bgNone ? true : deleteField();
        updateData.transition    = transition ?? deleteField();
        updateData.sfxCues       = savedSfxCues.length ? savedSfxCues : deleteField();
        updateData.extraBoxes    = savedExtraBoxes.length ? savedExtraBoxes : deleteField();
        // Formato antiguo (un solo efecto, al llegar): se mantiene para lectores sin actualizar
        updateData.sfxUrl        = legacySfx?.url ?? deleteField();
        updateData.sfxVolume     = legacySfx?.volume ?? deleteField();
        if (textSize === undefined) updateData.textSize = deleteField();
        else updateData.textSize = textSize;
        if (musicMode === 'inherit')  updateData.musicUrl = deleteField();
        else if (musicMode === 'silence') updateData.musicUrl = null;
        else updateData.musicUrl = editMusicUrl;
        updateData.musicVolume = musicMode === 'play' && musicVolume !== 1 ? musicVolume : deleteField();
        updateData.musicParagraph = delayedMusic ? savedMusicParagraph : deleteField();
        updateData.musicBefore    = delayedMusic && musicBeforeSilence ? 'silence' : deleteField();
        updateData.musicQuiet     = savedQuiet ?? deleteField();
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
        if (hideTextBox) newData.hideTextBox = true;
        if (!bgUrl && bgNone) newData.bgNone = true;
        if (transition) newData.transition = transition;
        if (savedSfxCues.length) newData.sfxCues = savedSfxCues;
        if (savedExtraBoxes.length) newData.extraBoxes = savedExtraBoxes;
        if (legacySfx) newData.sfxUrl = legacySfx.url;
        if (legacySfx?.volume !== undefined) newData.sfxVolume = legacySfx.volume;
        if (textSize !== undefined) newData.textSize = textSize;
        if (musicMode === 'silence') newData.musicUrl = null;
        else if (musicMode === 'play' && editMusicUrl) newData.musicUrl = editMusicUrl;
        if (musicMode === 'play' && editMusicUrl && musicVolume !== 1) newData.musicVolume = musicVolume;
        if (delayedMusic) newData.musicParagraph = savedMusicParagraph;
        if (delayedMusic && musicBeforeSilence) newData.musicBefore = 'silence';
        if (savedQuiet) newData.musicQuiet = savedQuiet;
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
      // Archivos que se quitaron o se sustituyeron en esta página
      cleanUpMedia(currentMediaRef.current);
      router.back();
    } catch (e) {
      console.error('Error guardando página:', e);
      AppAlert.alert(ts('Error'), ts('No se pudo guardar la página. Inténtalo de nuevo.'));
    }
    finally     { setSaving(false); }
  };

  useSaveShortcut(handleSave); // Ctrl+S en el navegador

  // Etiqueta del destino de un enlace (el número se calcula desde el id: sigue
  // siendo correcto aunque se reordenen las páginas)
  const linkTargetLabel = (link: PageLink) => {
    if (link.targetChapterId) return `→ ${link.targetChapterTitle ?? ts('Cap.')} p.${link.targetPageIndex + 1}`;
    const i = link.targetPageId ? chapterPageIds.indexOf(link.targetPageId) : link.targetPageIndex;
    return i >= 0 ? `→ p.${i + 1}` : ts('→ página borrada');
  };

  // ── Escala de la preview respecto al lector ───────────────────────────────
  // Todo lo que se pinta en la preview usa las medidas del lector × pvScale,
  // así lo que cabe aquí es lo que cabe al leer. 'Auto' = 'md', igual que en el lector.
  const pvScale         = pvWidth / REF_SCREEN.width;
  const previewBg: PreviewBg | null = bgUri
    ? { uri: bgUri, anchor: imageAnchor, fit: imageFit, blur: bgBlur }
    : bgNone ? null : inheritedBg;
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
        <Text style={styles.headerTitle}>{ts('Página {n}', { n: pageNum })}</Text>
        <View style={styles.headerActions} nativeID={tutorialZone('peSave')}>
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
              : <Text style={styles.saveBtnText}>{ts('Guardar')}</Text>
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* En móvil, la vista previa arriba y las opciones debajo. En escritorio, las
          opciones a la izquierda y la vista previa a la derecha, sin ocupar toda la ventana. */}
      <View style={isDesktop ? styles.bodyDesktop : styles.body}>
      <View style={isDesktop ? styles.previewPaneDesktop : undefined}>
      {/* ── Preview — proporción de un móvil medio en horizontal ── */}
      <View
        nativeID={tutorialZone('pePreview')}
        style={[styles.preview, isDesktop && { maxWidth: 900 }]}
        onLayout={e => {
          pvW.value = e.nativeEvent.layout.width;
          pvH.value = e.nativeEvent.layout.height;
          setPvWidth(e.nativeEvent.layout.width);
        }}
      >
        {/* Fondo: el de la página o, si no tiene, el heredado de las anteriores
            (salvo que la página esté marcada como "sin fondo") */}
        {previewBg
          ? <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
              <Image
                source={{ uri: previewBg.uri }}
                style={
                  previewBg.fit === 'contain' ? StyleSheet.absoluteFill
                  : previewBg.anchor === 'center' ? StyleSheet.absoluteFill
                  : previewBg.anchor === 'top'
                    ? { position: 'absolute', top: 0, left: 0, right: 0, aspectRatio: 16 / 9 }
                    : { position: 'absolute', bottom: 0, left: 0, right: 0, aspectRatio: 16 / 9 }
                }
                resizeMode={previewBg.fit === 'contain' ? 'contain' : 'cover'}
                // Escalado como el resto de la preview para que se vea igual que al leer
                blurRadius={previewBg.blur * pvScale}
              />
            </View>
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        }
        <View style={styles.previewOverlay} />

        {/* En una página de solo ilustración no hay cuadro de texto ni nombres */}
        {!hideTextBox && (<>
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
            placeholder={ts('Escribe el texto aquí…')}
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
                {leftCharName.trim() || ts('POV / Protagonista')}
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
                {rightCharName.trim() || ts('Otro personaje')}
              </Text>
            </Animated.View>
          </GestureDetector>
        )}

        </>)}

        {/* Cuadros de texto extra: se arrastran para colocarlos */}
        {extraBoxes.map(box => (
          <PreviewExtraBox
            key={box.id}
            box={box}
            pvWidth={pvWidth}
            pvHeight={pvWidth * REF_SCREEN.height / REF_SCREEN.width}
            pvScale={pvScale}
            fontSize={previewFontSize * EXTRA_BOX_STYLE.fontScale}
            onChange={patch => updateExtraBox(box.id, patch)}
          />
        ))}

        {/* Contador de caracteres */}
        <View style={styles.charCountBadge}>
          <Text style={styles.charCountText}>{pageText.length}/1000</Text>
        </View>

        {/* Overlay de subida */}
        {uploadingBg && (
          <View style={styles.uploadingOverlay}>
            <ActivityIndicator color={Colors.emerald} />
            <Text style={styles.uploadingText}>{ts('Subiendo imagen…')}</Text>
          </View>
        )}

        {/* Botón centrar bloque — esquina superior derecha del preview.
            En web se usa el Pressable normal: el botón de gestos no recibía el clic
            dentro de la vista previa. */}
        {Platform.OS === 'web' ? (
          <Pressable style={[styles.resetTbBtn, styles.resetTbBtnWeb]} onPress={centerTextBox}>
            <MaterialIcons name="center-focus-strong" size={18} color="rgba(255,255,255,0.75)" />
          </Pressable>
        ) : (
          <TouchableOpacity
            style={styles.resetTbBtn}
            onPress={centerTextBox}
            activeOpacity={0.7}
          >
            <MaterialIcons name="center-focus-strong" size={14} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        )}
      </View>

      </View>

      {/* ── Configuración desplazable ── */}
      <ScrollView
        style={[styles.config, isDesktop && styles.configDesktop]}
        contentContainerStyle={styles.configContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* Tipo de página */}
        <View style={styles.section} nativeID={tutorialZone('peType')}>
          <Text style={styles.sectionLabel}>{ts('Tipo de página')}</Text>
          <View style={styles.anchorRow}>
            {([
              { value: false, icon: 'notes', label: ts('Con texto') },
              { value: true,  icon: 'image', label: ts('Solo ilustración') },
            ] as const).map(opt => (
              <TouchableOpacity
                key={ts(opt.label)}
                style={[styles.anchorBtn, hideTextBox === opt.value && styles.anchorBtnActive]}
                onPress={() => setHideTextBox(opt.value)}
                activeOpacity={0.75}
              >
                <MaterialIcons name={opt.icon} size={13} color={hideTextBox === opt.value ? '#000' : Colors.textSecondary} />
                <Text style={[styles.anchorBtnText, hideTextBox === opt.value && styles.anchorBtnTextActive]}>{ts(opt.label)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {hideTextBox && (
            <Text style={styles.sectionHint}>
              Se ve solo la imagen de fondo, sin cuadro de texto ni nombres. Un toque pasa a la
              página siguiente. El texto que tuviera la página se conserva, pero no se muestra.
            </Text>
          )}
        </View>

        {/* Copiar / pegar el cuadro de texto */}
        {!hideTextBox && (
          <View style={styles.section} nativeID={tutorialZone('peTextBox')}>
            <Text style={styles.sectionLabel}>{ts('Cuadro de texto')}</Text>
            <View style={styles.anchorRow}>
              <TouchableOpacity style={styles.anchorBtn} onPress={copyTextBox} activeOpacity={0.75}>
                <MaterialIcons name="content-copy" size={13} color={Colors.textSecondary} />
                <Text style={styles.anchorBtnText}>{ts('Copiar posición y tamaño')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.anchorBtn, !tbClipboard && { opacity: 0.4 }]}
                onPress={pasteTextBox}
                disabled={!tbClipboard}
                activeOpacity={0.75}
              >
                <MaterialIcons name="content-paste" size={13} color={Colors.textSecondary} />
                <Text style={styles.anchorBtnText}>{ts('Pegar')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.sectionHint}>
              {tbClipboard
                ? ts('Hay un cuadro copiado. «Pegar» coloca el de esta página exactamente igual; sirve también en otros capítulos e historias.')
                : ts('Copia el cuadro de esta página para ponerlo idéntico en otra, aunque sea de otro capítulo.')}
            </Text>
          </View>
        )}

        {/* Animación al pasar la página */}
        <View style={styles.section} nativeID={tutorialZone('peTransition')}>
          {/* Plegable: cerrado muestra solo la opción elegida */}
          <TouchableOpacity
            style={styles.foldHeader}
            onPress={() => setTransitionOpen(v => !v)}
            activeOpacity={0.75}
          >
            <Text style={[styles.sectionLabel, { flex: 1 }]}>{ts('Animación al pasar esta página')}</Text>
            <View style={styles.foldValue}>
              <MaterialIcons name={transitionOption.icon as any} size={13} color={Colors.emerald} />
              <Text style={styles.foldValueText}>{transitionOption.label}</Text>
            </View>
            <MaterialIcons name={transitionOpen ? 'expand-less' : 'expand-more'} size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
          {transitionOpen && (<>
          <Text style={styles.sectionHint}>
            La animación que se ve al salir de esta página hacia la siguiente. «Heredar» usa la
            misma que la página anterior. Se ve al probar la página, no en esta vista previa.
          </Text>
          <View style={[styles.anchorRow, { flexWrap: 'wrap' }]}>
            <TouchableOpacity
              style={[styles.anchorBtn, transition === undefined && styles.anchorBtnActive]}
              onPress={() => setTransition(undefined)}
              activeOpacity={0.75}
            >
              <MaterialIcons name="subdirectory-arrow-right" size={13} color={transition === undefined ? '#000' : Colors.textSecondary} />
              <Text style={[styles.anchorBtnText, transition === undefined && styles.anchorBtnTextActive]}>{ts('Heredar')}</Text>
            </TouchableOpacity>
            {PAGE_TRANSITIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.anchorBtn, transition === opt.value && styles.anchorBtnActive]}
                onPress={() => setTransition(opt.value)}
                activeOpacity={0.75}
              >
                <MaterialIcons name={opt.icon as any} size={13} color={transition === opt.value ? '#000' : Colors.textSecondary} />
                <Text style={[styles.anchorBtnText, transition === opt.value && styles.anchorBtnTextActive]}>{ts(opt.label)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          </>)}
        </View>

        {/* Tamaño de texto */}
        <View style={styles.section} nativeID={tutorialZone('peTextSize')}>
          <Text style={styles.sectionLabel}>{ts('Tamaño de texto')}</Text>
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
                    {opt.value === 'auto' ? ts('Auto') : 'A'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Imagen de fondo */}
        <View style={styles.section} nativeID={tutorialZone('peBackground')}>
          <Text style={styles.sectionLabel}>{ts('Imagen de fondo')}</Text>

          {bgUri ? (
            <>
              <View style={styles.bgActiveRow}>
                <MaterialIcons name="check-circle" size={16} color={Colors.emerald} />
                <Text style={styles.bgActiveText}>{ts('Imagen añadida')}</Text>
                <TouchableOpacity onPress={() => { setBgUri(null); setBgUrl(''); }} style={styles.bgRemoveBtn}>
                  <MaterialIcons name="close" size={16} color="#FF6B6B" />
                  <Text style={styles.bgRemoveText}>{ts('Quitar')}</Text>
                </TouchableOpacity>
              </View>
              {/* Fit */}
              <View style={styles.fitRow}>
                {([{ value: 'cover', icon: 'crop-free', label: ts('Rellenar') }, { value: 'contain', icon: 'fit-screen', label: ts('Ver todo') }] as any[]).map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.fitBtn, imageFit === opt.value && styles.fitBtnActive]}
                    onPress={() => setImageFit(opt.value)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={opt.icon} size={14} color={imageFit === opt.value ? '#000' : Colors.textSecondary} />
                    <Text style={[styles.fitBtnText, imageFit === opt.value && styles.fitBtnTextActive]}>{ts(opt.label)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {/* Ancla */}
              {imageFit === 'cover' && (
                <View style={styles.anchorRow}>
                  <Text style={styles.anchorLabel}>{ts('Encuadre:')}</Text>
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
                        {a === 'top' ? ts('Arriba') : a === 'center' ? ts('Centro') : ts('Abajo')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {/* Desenfoque */}
              <View style={styles.blurBlock}>
                <View style={styles.anchorRow}>
                  <Text style={styles.anchorLabel}>{ts('Desenfoque:')}</Text>
                  <TouchableOpacity
                    style={[styles.blurStepBtn, bgBlur === 0 && { opacity: 0.35 }]}
                    onPress={() => setBgBlur(b => Math.max(0, b - 1))}
                    disabled={bgBlur === 0}
                    hitSlop={6}
                  >
                    <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={styles.blurValue}>{bgBlur === 0 ? ts('Sin') : bgBlur}</Text>
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
                      <Text style={[styles.anchorBtnText, bgBlur === p.value && styles.anchorBtnTextActive]}>{ts(p.label)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          ) : (
            <>
              {/* Sin imagen propia: seguir con la de la página anterior o fondo negro */}
              <View style={styles.anchorRow}>
                {([
                  { value: false, icon: 'subdirectory-arrow-right', label: ts('Heredar la anterior') },
                  { value: true,  icon: 'block', label: ts('Sin fondo (negro)') },
                ] as const).map(opt => (
                  <TouchableOpacity
                    key={ts(opt.label)}
                    style={[styles.anchorBtn, bgNone === opt.value && styles.anchorBtnActive]}
                    onPress={() => setBgNone(opt.value)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={opt.icon} size={13} color={bgNone === opt.value ? '#000' : Colors.textSecondary} />
                    <Text style={[styles.anchorBtnText, bgNone === opt.value && styles.anchorBtnTextActive]}>{ts(opt.label)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.sectionHint}>
                {bgNone
                  ? ts('Esta página se ve con el fondo en negro. Las siguientes que hereden también, hasta que una ponga imagen.')
                  : ts('Sin imagen propia, la página usa la de la anterior. O elige una nueva:')}
              </Text>
              <View style={styles.sourceToggleRow}>
                {MEDIA_SOURCES.map(src => (
                  <TouchableOpacity
                    key={src}
                    style={[styles.sourceBtn, imageSource === src && styles.sourceBtnActive]}
                    onPress={() => setImageSource(src)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={MEDIA_SOURCE_ICON[src]} size={13} color={imageSource === src ? '#000' : Colors.textSecondary} />
                    <Text style={[styles.sourceBtnText, imageSource === src && styles.sourceBtnTextActive]}>
                      {ts(MEDIA_SOURCE_LABEL[src])}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {imageSource === 'library' ? (
                <MediaLibraryPicker
                  kind="image"
                  loading={loadingLibrary}
                  urls={mediaLibrary?.images ?? []}
                  onPick={url => { setBgUri(url); setBgUrl(url); }}
                />
              ) : imageSource === 'file' ? (
                <TouchableOpacity style={styles.pickBtn} onPress={handlePickImage} disabled={uploadingBg} activeOpacity={0.7}>
                  <MaterialIcons name="add-photo-alternate" size={18} color={Colors.textSecondary} />
                  <Text style={styles.pickBtnText}>{ts('Añadir imagen de fondo')}</Text>
                  {uploadingBg && <ActivityIndicator size="small" color={Colors.emerald} />}
                </TouchableOpacity>
              ) : (
                <View style={styles.urlRow}>
                  <TextInput
                    style={styles.urlInput}
                    defaultValue={imageUrlInput}
                    onChangeText={setImageUrlInput}
                    placeholder={ts('Link de Drive o URL directa a imagen…')}
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
                    <Text style={styles.urlConfirmText}>{ts('Usar')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* Música */}
        <View style={styles.section} nativeID={tutorialZone('peMusic')}>
          <Text style={styles.sectionLabel}>{ts('Música')}</Text>
          <View style={styles.musicModeRow}>
            {([
              { value: 'inherit', icon: 'redo',       label: ts('Heredar')   },
              { value: 'play',    icon: 'audiotrack',  label: ts('Pista')     },
              { value: 'silence', icon: 'music-off',   label: ts('Silenciar') },
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
                  {ts(opt.label)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {musicMode === 'play' && (
            editMusicUrl ? (
              <>
              <View style={styles.musicTrackRow}>
                <MaterialIcons name="audiotrack" size={14} color={Colors.aqua} />
                <Text style={styles.musicTrackName} numberOfLines={1}>{musicFileName || ts('Pista de audio')}</Text>
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
              {/* Párrafo en el que empieza a sonar (1 = al llegar a la página) */}
              {(() => {
                const paragraph = Math.min(musicParagraph, paragraphCount);
                const snippet = splitParagraphs(pageText)[paragraph - 1] ?? '';
                return (
                  <>
                    <View style={styles.anchorRow}>
                      <Text style={styles.anchorLabel}>{ts('Empieza en el párrafo:')}</Text>
                      <TouchableOpacity
                        style={[styles.blurStepBtn, paragraph <= 1 && { opacity: 0.35 }]}
                        onPress={() => setMusicParagraph(Math.max(1, paragraph - 1))}
                        disabled={paragraph <= 1}
                        hitSlop={6}
                      >
                        <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                      </TouchableOpacity>
                      <Text style={styles.blurValue}>{paragraph}</Text>
                      <TouchableOpacity
                        style={[styles.blurStepBtn, paragraph >= paragraphCount && { opacity: 0.35 }]}
                        onPress={() => setMusicParagraph(Math.min(paragraphCount, paragraph + 1))}
                        disabled={paragraph >= paragraphCount}
                        hitSlop={6}
                      >
                        <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {paragraph > 1 && (
                      <>
                        {snippet ? (
                          <Text style={styles.sfxCueSnippet} numberOfLines={1}>«{snippet.replace(/\n/g, ' ')}»</Text>
                        ) : null}
                        <View style={[styles.anchorRow, { flexWrap: 'wrap' }]}>
                          <Text style={styles.anchorLabel}>{ts('Hasta entonces:')}</Text>
                          {([
                            { value: false, icon: 'subdirectory-arrow-right', label: ts('Sigue la música anterior') },
                            { value: true,  icon: 'volume-off', label: ts('Silencio') },
                          ] as const).map(opt => (
                            <TouchableOpacity
                              key={ts(opt.label)}
                              style={[styles.anchorBtn, musicBeforeSilence === opt.value && styles.anchorBtnActive]}
                              onPress={() => setMusicBeforeSilence(opt.value)}
                              activeOpacity={0.75}
                            >
                              <MaterialIcons name={opt.icon} size={13} color={musicBeforeSilence === opt.value ? '#000' : Colors.textSecondary} />
                              <Text style={[styles.anchorBtnText, musicBeforeSilence === opt.value && styles.anchorBtnTextActive]}>{ts(opt.label)}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </>
                    )}
                  </>
                );
              })()}
              </>
            ) : (
              <>
                <View style={styles.sourceToggleRow}>
                  {MEDIA_SOURCES.map(src => (
                    <TouchableOpacity
                      key={src}
                      style={[styles.sourceBtn, musicSource === src && styles.sourceBtnActive]}
                      onPress={() => setMusicSource(src)}
                      activeOpacity={0.75}
                    >
                      <MaterialIcons name={MEDIA_SOURCE_ICON[src]} size={13} color={musicSource === src ? '#000' : Colors.textSecondary} />
                      <Text style={[styles.sourceBtnText, musicSource === src && styles.sourceBtnTextActive]}>
                        {ts(MEDIA_SOURCE_LABEL[src])}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {musicSource === 'library' ? (
                  <MediaLibraryPicker
                    kind="audio"
                    loading={loadingLibrary}
                    urls={mediaLibrary?.music ?? []}
                    onPick={url => { setEditMusicUrl(url); setMusicFileName(fileNameFromUrl(url, 'Pista')); setMusicMode('play'); }}
                  />
                ) : musicSource === 'file' ? (
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
                      {uploadingMusic ? ts('Subiendo…') : ts('Elegir archivo de audio')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.urlRow}>
                    <TextInput
                      style={styles.urlInput}
                      defaultValue={musicUrlInput}
                      onChangeText={setMusicUrlInput}
                      placeholder={ts('Link de Drive o URL directa a audio…')}
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
                      <Text style={styles.urlConfirmText}>{ts('Usar')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )
          )}
          {musicMode === 'inherit' && (
            <View style={styles.musicHint}>
              <MaterialIcons name="redo" size={12} color={Colors.textMuted} />
              <Text style={styles.musicHintText}>{ts('Continúa la pista de la página anterior')}</Text>
            </View>
          )}
          {musicMode === 'silence' && (
            <View style={styles.musicHint}>
              <MaterialIcons name="music-off" size={12} color={Colors.textMuted} />
              <Text style={styles.musicHintText}>{ts('La música se detendrá en esta página')}</Text>
            </View>
          )}
        </View>

        {/* Silencio momentáneo de la música */}
        <View style={styles.section} nativeID={tutorialZone('peQuiet')}>
          <Text style={styles.sectionLabel}>{ts('Silencio momentáneo')}</Text>
          <Text style={styles.sectionHint}>
            {ts('Calla la música durante algunos párrafos de esta página, sea la suya o la heredada. Después vuelve sola, por donde iba.')}
          </Text>
          <View style={styles.anchorRow}>
            {([{ value: false, label: 'No' }, { value: true, label: ts('Callar la música') }] as const).map(opt => (
              <TouchableOpacity
                key={ts(opt.label)}
                style={[styles.anchorBtn, quietOn === opt.value && styles.anchorBtnActive]}
                onPress={() => setQuietOn(opt.value)}
                activeOpacity={0.75}
              >
                <Text style={[styles.anchorBtnText, quietOn === opt.value && styles.anchorBtnTextActive]}>{ts(opt.label)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {quietOn && (() => {
            const from = Math.min(quietFrom, paragraphCount);
            const to = Math.max(from, Math.min(quietTo, paragraphCount));
            const row = (label: string, value: number, set: (n: number) => void, min: number) => (
              <View style={styles.anchorRow}>
                <Text style={styles.anchorLabel}>{label}</Text>
                <TouchableOpacity
                  style={[styles.blurStepBtn, value <= min && { opacity: 0.35 }]}
                  onPress={() => set(Math.max(min, value - 1))}
                  disabled={value <= min}
                  hitSlop={6}
                >
                  <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
                <Text style={styles.blurValue}>{value}</Text>
                <TouchableOpacity
                  style={[styles.blurStepBtn, value >= paragraphCount && { opacity: 0.35 }]}
                  onPress={() => set(Math.min(paragraphCount, value + 1))}
                  disabled={value >= paragraphCount}
                  hitSlop={6}
                >
                  <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
            );
            return (
              <>
                {row(ts('Desde el párrafo:'), from, n => { setQuietFrom(n); if (n > quietTo) setQuietTo(n); }, 1)}
                {row(ts('Hasta el párrafo:'), to, setQuietTo, from)}
                <Text style={styles.sfxCueSnippet}>
                  {to >= paragraphCount
                    ? ts('Llega hasta el final de la página: la música vuelve al pasar a la siguiente.')
                    : ts('La música vuelve al aparecer el párrafo {n}.', { n: to + 1 })}
                </Text>
              </>
            );
          })()}
        </View>

        {/* Efecto de sonido */}
        <View style={styles.section} nativeID={tutorialZone('peSfx')}>
          <Text style={styles.sectionLabel}>{ts('Efectos de sonido')}</Text>
          <Text style={styles.sectionHint}>
            Suenan una vez cuando aparece el párrafo que elijas (una puerta, un trueno…). Puedes
            poner varios. El párrafo 1 es al llegar a la página. No se heredan.
          </Text>
          {sfxCues.map(cue => {
            const paragraph = Math.min(cue.paragraph, paragraphCount);
            const snippet = splitParagraphs(pageText)[paragraph - 1] ?? '';
            return (
              <View key={cue.id} style={styles.sfxCueCard}>
                <View style={styles.musicTrackRow}>
                  <MaterialIcons name="graphic-eq" size={14} color={Colors.aqua} />
                  <Text style={styles.musicTrackName} numberOfLines={1}>{cue.name || ts('Efecto de sonido')}</Text>
                  <TouchableOpacity
                    onPress={() => removeSfxCue(cue.id)}
                    style={{ padding: 6 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="close" size={15} color="#FF6B6B" />
                  </TouchableOpacity>
                </View>
                <View style={styles.anchorRow}>
                  <Text style={styles.anchorLabel}>{ts('Suena en el párrafo:')}</Text>
                  <TouchableOpacity
                    style={[styles.blurStepBtn, paragraph <= 1 && { opacity: 0.35 }]}
                    onPress={() => updateSfxCue(cue.id, { paragraph: Math.max(1, paragraph - 1) })}
                    disabled={paragraph <= 1}
                    hitSlop={6}
                  >
                    <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={styles.blurValue}>{paragraph}</Text>
                  <TouchableOpacity
                    style={[styles.blurStepBtn, paragraph >= paragraphCount && { opacity: 0.35 }]}
                    onPress={() => updateSfxCue(cue.id, { paragraph: Math.min(paragraphCount, paragraph + 1) })}
                    disabled={paragraph >= paragraphCount}
                    hitSlop={6}
                  >
                    <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                {snippet ? (
                  <Text style={styles.sfxCueSnippet} numberOfLines={1}>«{snippet.replace(/\n/g, ' ')}»</Text>
                ) : null}
                <VolumeRow
                  value={cue.volume} min={MUSIC_VOLUME_MIN} max={SFX_VOLUME_MAX}
                  onStep={delta => changeSfxCueVolume(cue, delta)}
                  playing={previewingSfxId === cue.id} onTogglePlay={() => toggleSfxPreview(cue)}
                />
              </View>
            );
          })}
          <Text style={styles.anchorLabel}>{sfxCues.length ? ts('Añadir otro efecto:') : ts('Añadir un efecto:')}</Text>
          {(
            <>
              <View style={styles.sourceToggleRow}>
                {MEDIA_SOURCES.map(src => (
                  <TouchableOpacity
                    key={src}
                    style={[styles.sourceBtn, sfxSource === src && styles.sourceBtnActive]}
                    onPress={() => setSfxSource(src)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={MEDIA_SOURCE_ICON[src]} size={13} color={sfxSource === src ? '#000' : Colors.textSecondary} />
                    <Text style={[styles.sourceBtnText, sfxSource === src && styles.sourceBtnTextActive]}>
                      {ts(MEDIA_SOURCE_LABEL[src])}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {sfxSource === 'library' ? (
                <MediaLibraryPicker
                  kind="audio"
                  loading={loadingLibrary}
                  urls={mediaLibrary?.sfx ?? []}
                  onPick={url => addSfxCue(url, fileNameFromUrl(url, 'Efecto'))}
                />
              ) : sfxSource === 'file' ? (
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
                    {uploadingSfx ? ts('Subiendo…') : ts('Elegir archivo de sonido')}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.urlRow}>
                  <TextInput
                    style={styles.urlInput}
                    defaultValue={sfxUrlInput}
                    onChangeText={setSfxUrlInput}
                    placeholder={ts('Link de Drive o URL directa a audio…')}
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
                    <Text style={styles.urlConfirmText}>{ts('Usar')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Cuadros de texto extra ── */}
        <View style={styles.section} nativeID={tutorialZone('peExtra')}>
          <Text style={styles.sectionLabel}>{ts('Cuadros de texto extra')}</Text>
          <Text style={styles.sectionHint}>
            {ts('Texto suelto que aparece en el párrafo que elijas: voces de fondo, un rótulo, una decisión… Hasta {n}. En la vista previa, arrástralos para colocarlos y tira de su esquina inferior derecha para cambiarles el tamaño.', { n: EXTRA_BOX_MAX })}
          </Text>
          {extraBoxes.map((box, i) => {
            const paragraph = Math.min(box.paragraph, paragraphCount);
            const stepper = (label: string, value: string, onDown: () => void, onUp: () => void) => (
              <View style={styles.anchorRow}>
                <Text style={styles.anchorLabel}>{label}</Text>
                <TouchableOpacity style={styles.blurStepBtn} onPress={onDown} hitSlop={6}>
                  <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
                <Text style={[styles.blurValue, { minWidth: 44 }]}>{value}</Text>
                <TouchableOpacity style={styles.blurStepBtn} onPress={onUp} hitSlop={6}>
                  <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>
            );
            return (
              <View key={box.id} style={styles.sfxCueCard}>
                <View style={styles.musicTrackRow}>
                  <MaterialIcons name="chat-bubble-outline" size={14} color={Colors.aqua} />
                  <Text style={styles.musicTrackName}>Cuadro {i + 1}</Text>
                  <TouchableOpacity
                    onPress={() => removeExtraBox(box.id)}
                    style={{ padding: 6 }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="close" size={15} color="#FF6B6B" />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.urlInput, { minHeight: 56, textAlignVertical: 'top' }]}
                  value={box.text}
                  onChangeText={text => updateExtraBox(box.id, { text })}
                  placeholder={ts('Texto del cuadro…')}
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  maxLength={200}
                />
                {stepper(ts('Aparece en el párrafo:'), String(paragraph),
                  () => updateExtraBox(box.id, { paragraph: Math.max(1, paragraph - 1) }),
                  () => updateExtraBox(box.id, { paragraph: Math.min(paragraphCount, paragraph + 1) }))}
                {stepper('Ancho:', `${Math.round(box.w)}%`,
                  () => updateExtraBox(box.id, { w: Math.max(6, box.w - 2) }),
                  () => updateExtraBox(box.id, { w: Math.min(100, box.w + 2) }))}
                <View style={styles.anchorRow}>
                  <Text style={styles.anchorLabel}>{ts('Alto:')}</Text>
                  <TouchableOpacity
                    style={[styles.anchorBtn, box.h === null && styles.anchorBtnActive]}
                    onPress={() => updateExtraBox(box.id, { h: null })}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.anchorBtnText, box.h === null && styles.anchorBtnTextActive]}>{ts('Según el texto')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.blurStepBtn} onPress={() => updateExtraBox(box.id, { h: Math.max(5, (box.h ?? 20) - 2) })} hitSlop={6}>
                    <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={[styles.blurValue, { minWidth: 44 }]}>{box.h === null ? '—' : `${Math.round(box.h)}%`}</Text>
                  <TouchableOpacity style={styles.blurStepBtn} onPress={() => updateExtraBox(box.id, { h: Math.min(100, (box.h ?? 20) + 2) })} hitSlop={6}>
                    <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                {stepper('Giro:', `${box.rotation}°`,
                  () => updateExtraBox(box.id, { rotation: Math.max(-180, box.rotation - 5) }),
                  () => updateExtraBox(box.id, { rotation: Math.min(180, box.rotation + 5) }))}
                <View style={[styles.anchorRow, { flexWrap: 'wrap' }]}>
                  {ROTATION_PRESETS.map(p => (
                    <TouchableOpacity
                      key={p.value}
                      style={[styles.anchorBtn, box.rotation === p.value && styles.anchorBtnActive]}
                      onPress={() => updateExtraBox(box.id, { rotation: p.value })}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.anchorBtnText, box.rotation === p.value && styles.anchorBtnTextActive]}>{ts(p.label)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Animación con la que aparece */}
                <View style={[styles.anchorRow, { flexWrap: 'wrap' }]}>
                  <Text style={styles.anchorLabel}>{ts('Aparece:')}</Text>
                  {([{ value: 'fade', label: ts('Desvanecer') }, { value: 'pop', label: ts('Pop') }] as const).map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.anchorBtn, box.animation === opt.value && styles.anchorBtnActive]}
                      onPress={() => updateExtraBox(box.id, { animation: opt.value })}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.anchorBtnText, box.animation === opt.value && styles.anchorBtnTextActive]}>{ts(opt.label)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={[styles.anchorRow, { flexWrap: 'wrap' }]}>
                  <Text style={styles.anchorLabel}>{ts('Deslizándose:')}</Text>
                  {EXTRA_BOX_SLIDES.map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.blurStepBtn, box.animation === opt.value && styles.anchorBtnActive]}
                      onPress={() => updateExtraBox(box.id, { animation: opt.value })}
                      hitSlop={4}
                    >
                      <MaterialIcons name={opt.icon as any} size={15} color={box.animation === opt.value ? '#000' : Colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={[styles.anchorRow, { flexWrap: 'wrap' }]}>
                  <Text style={styles.anchorLabel}>{ts('Con barrido:')}</Text>
                  {EXTRA_BOX_WIPES.map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.blurStepBtn, box.animation === opt.value && styles.anchorBtnActive]}
                      onPress={() => updateExtraBox(box.id, { animation: opt.value })}
                      hitSlop={4}
                    >
                      <MaterialIcons name={opt.icon as any} size={15} color={box.animation === opt.value ? '#000' : Colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.anchorRow}>
                  <Text style={styles.anchorLabel}>{ts('Al pulsarlo, ir a la página:')}</Text>
                  <TextInput
                    style={[styles.urlInput, { flex: 0, width: 64, textAlign: 'center' }]}
                    value={box.target}
                    onChangeText={t => updateExtraBox(box.id, { target: t.replace(/[^0-9]/g, '') })}
                    placeholder="—"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={3}
                  />
                </View>
                {box.target !== '' && !chapterPageIds[parseInt(box.target, 10) - 1] ? (
                  <Text style={[styles.sfxCueSnippet, { color: '#FF6B6B' }]}>
                    El capítulo no tiene una página {box.target}: el cuadro no llevará a ningún sitio.
                  </Text>
                ) : (
                  <Text style={styles.sfxCueSnippet}>
                    {box.target ? ts('Es una decisión: al pulsarlo se va a esa página.') : ts('Vacío = solo texto, no se pulsa.')}
                  </Text>
                )}
              </View>
            );
          })}
          {extraBoxes.length < EXTRA_BOX_MAX && (
            <TouchableOpacity style={styles.pickBtn} onPress={addExtraBox} activeOpacity={0.7}>
              <MaterialIcons name="add" size={16} color={Colors.textSecondary} />
              <Text style={styles.pickBtnText}>{ts('Añadir cuadro de texto')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Personajes ── */}
        <View style={styles.section} nativeID={tutorialZone('peCharacters')}>
          <Text style={styles.sectionLabel}>{ts('Personajes')}</Text>
          <Text style={styles.sectionHint}>
            Nombres que aparecen sobre el recuadro de texto. Se heredan de página en página.
          </Text>
          {/* Slot izquierda — POV / Protagonista */}
          <View style={styles.charSlot}>
            <Text style={styles.charSlotLabel}>{ts('POV / Protagonista')}</Text>
            <View style={styles.charModeRow}>
              {([
                { value: 'inherit' as CharMode, icon: 'redo',      label: ts('Heredar') },
                { value: 'show'    as CharMode, icon: 'person',     label: ts('Nombre')  },
                { value: 'hide'    as CharMode, icon: 'person-off', label: ts('Ocultar') },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.charModeBtn, leftCharMode === opt.value && styles.charModeBtnActive]}
                  onPress={() => chooseLeftCharMode(opt.value)}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name={opt.icon as any} size={12} color={leftCharMode === opt.value ? '#000' : Colors.textSecondary} />
                  <Text style={[styles.charModeBtnText, leftCharMode === opt.value && styles.charModeBtnTextActive]}>{ts(opt.label)}</Text>
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
                  placeholder={ts('Nombre del personaje…')}
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
                <Text style={styles.musicHintText}>{ts('Toma el nombre de la página anterior')}</Text>
              </View>
            )}
            {leftCharMode === 'hide' && (
              <View style={styles.musicHint}>
                <MaterialIcons name="person-off" size={12} color={Colors.textMuted} />
                <Text style={styles.musicHintText}>{ts('Oculta el nombre aunque venga heredado')}</Text>
              </View>
            )}
          </View>

          {/* Slot derecha — Otro personaje */}
          <View style={styles.charSlot}>
            <Text style={styles.charSlotLabel}>{ts('Otro personaje')}</Text>
            <View style={styles.charModeRow}>
              {([
                { value: 'inherit' as CharMode, icon: 'redo',      label: ts('Heredar') },
                { value: 'show'    as CharMode, icon: 'person',     label: ts('Nombre')  },
                { value: 'hide'    as CharMode, icon: 'person-off', label: ts('Ocultar') },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.charModeBtn, rightCharMode === opt.value && styles.charModeBtnActive]}
                  onPress={() => chooseRightCharMode(opt.value)}
                  activeOpacity={0.75}
                >
                  <MaterialIcons name={opt.icon as any} size={12} color={rightCharMode === opt.value ? '#000' : Colors.textSecondary} />
                  <Text style={[styles.charModeBtnText, rightCharMode === opt.value && styles.charModeBtnTextActive]}>{ts(opt.label)}</Text>
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
                  placeholder={ts('Nombre del personaje…')}
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
                <Text style={styles.musicHintText}>{ts('Toma el nombre de la página anterior')}</Text>
              </View>
            )}
            {rightCharMode === 'hide' && (
              <View style={styles.musicHint}>
                <MaterialIcons name="person-off" size={12} color={Colors.textMuted} />
                <Text style={styles.musicHintText}>{ts('Oculta el nombre aunque venga heredado')}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Palabras enlazadas ── */}
        <View style={styles.section} nativeID={tutorialZone('peLinks')}>
          <Text style={styles.sectionLabel}>{ts('Palabras enlazadas')}</Text>
          <Text style={styles.sectionHint}>
            {ts('El lector podrá tocar estas palabras para saltar a otra página.')}
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
              <Text style={styles.linkAddText}>{ts('Añadir enlace')}</Text>
            </TouchableOpacity>
          )}

          {/* Panel de configuración — aparece al tocar "Añadir enlace" */}
          {linkMode && (
            <View style={styles.linkPendingPanel}>
              <View style={styles.linkPendingHeader}>
                <Text style={styles.linkPendingTitle}>{ts('Nuevo enlace')}</Text>
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
                <Text style={styles.linkColorPickerLabel}>{ts('Palabra:')}</Text>
                <TextInput
                  style={[styles.linkPageInputFull, pendingWord ? { color: pendingLinkColor } : {}]}
                  value={pendingWord}
                  onChangeText={setPendingWord}
                  placeholder={ts('Escribe o selecciónala arriba…')}
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="next"
                />
              </View>

              {/* Selector de color */}
              <View style={styles.linkColorPickerRow}>
                <Text style={styles.linkColorPickerLabel}>{ts('Color:')}</Text>
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
                <Text style={styles.linkColorPickerLabel}>{ts('Saltar a página:')}</Text>
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
                        placeholder={ts('Buscar por número o capítulo…')}
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
                          {creatingNewPage ? ts('Creando página…') : ts('Crear nueva página en este capítulo')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {loadingPageOptions ? (
                      <View style={styles.pickerLoading}>
                        <ActivityIndicator color={Colors.emerald} size="small" />
                        <Text style={styles.pickerLoadingText}>{ts('Cargando páginas…')}</Text>
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
                                {pageOptions.length === 0 ? ts('Este libro aún no tiene páginas') : ts('Sin resultados')}
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
                  <Text style={styles.linkCancelText}>{ts('Cancelar')}</Text>
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
                  <Text style={styles.linkConfirmText}>{ts('Añadir')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* ── Redirección de página ── */}
        <View style={styles.section} nativeID={tutorialZone('peNext')}>
          <Text style={styles.sectionLabel}>{ts('Al pasar la página')}</Text>
          <Text style={styles.sectionHint}>
            {ts('Por defecto avanza a la siguiente. Puedes redirigir a cualquier otra.')}
          </Text>
          <View style={styles.nextPageRow}>
            <TouchableOpacity
              style={[styles.nextPageBtn, !jumpEnabled && styles.nextPageBtnActive]}
              onPress={() => { setJumpEnabled(false); setNextPageInput(''); }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="arrow-forward" size={14} color={!jumpEnabled ? '#000' : Colors.textSecondary} />
              <Text style={[styles.nextPageBtnText, !jumpEnabled && styles.nextPageBtnTextActive]}>
                {ts('Siguiente')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextPageBtn, jumpEnabled && styles.nextPageBtnActive]}
              onPress={() => { if (!jumpEnabled) { setJumpEnabled(true); setNextPageInput('1'); } }}
              activeOpacity={0.75}
            >
              <MaterialIcons name="call-split" size={14} color={jumpEnabled ? '#000' : Colors.textSecondary} />
              <Text style={[styles.nextPageBtnText, jumpEnabled && styles.nextPageBtnTextActive]}>
                {ts('Saltar a')}
              </Text>
            </TouchableOpacity>
            {jumpEnabled && (
              <View style={styles.nextPageInputWrap}>
                <Text style={styles.nextPageInputLabel}>{ts('pág.')}</Text>
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
      </View>
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
    fontFamily: STORY_FONT,
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
  // Web: por encima del cuadro de texto y sus tiradores, y con cursor de botón
  resetTbBtnWeb: { zIndex: 20, padding: 6, cursor: 'pointer' } as any,
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 10,
  },
  uploadingText: { fontSize: 12, color: Colors.emerald, fontWeight: '600' },

  // Config scrollable
  config:        { flex: 1 },
  // Cabecera de un apartado plegable
  foldHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  foldValue:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  foldValueText: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  // Tarjeta de un efecto de sonido
  sfxCueCard:    { gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  sfxCueSnippet: { fontSize: 11, color: Colors.textMuted, fontStyle: 'italic' },
  // Escritorio: dos columnas. La vista previa va primero en el código, así que la fila
  // se invierte para que quede a la derecha.
  body:               { flex: 1 },
  bodyDesktop:        { flex: 1, flexDirection: 'row-reverse' },
  previewPaneDesktop: { flex: 1, padding: 28, alignItems: 'center' },
  configDesktop:      { flexGrow: 0, flexShrink: 0, flexBasis: 480, borderRightWidth: 1, borderRightColor: Colors.border },
  configContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 24 },

  section:      { gap: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },

  // Tamaño texto
  textSizeRow:         { flexDirection: 'row', gap: 8 },
  textSizeBtn:         { width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  textSizeBtnActive:   { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  textSizeBtnLabel:    { fontWeight: '700', color: Colors.textSecondary, fontFamily: STORY_FONT },
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
  // Biblioteca de archivos ya usados
  libraryEmpty:   { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic', paddingVertical: 8 },
  libraryGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  libraryThumb:   { width: 96, height: 54, borderRadius: 4, overflow: 'hidden', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  libraryRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border + '60' },
  libraryRowText: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  libraryRowUse:  { fontSize: 12, fontWeight: '700', color: Colors.emerald },
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
    fontFamily: STORY_FONT,
    fontWeight: '700',
    color: Colors.emerald,
    flexShrink: 1,
  },
});

