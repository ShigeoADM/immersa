import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, PanResponder, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { collection, deleteField, doc, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import { withUploadNotice } from '@/components/upload-notice';
import { mediaDisplayName, uploadImage, uploadLocalFile } from '@/services/media';
import { deleteUnusedMedia, sortChapters } from '@/services/stories';
import {
  ChapterIntroView, INTRO_BACKDROPS, INTRO_DEFAULTS, INTRO_FONTS, INTRO_IMAGE_ANIMS, INTRO_SPEEDS,
  INTRO_TEXT_ANIMS, type IntroStyle,
} from '@/components/chapter-intro';
import { musicPlaybackVolume } from '@/constants/reader-layout';

// Ilustración del capítulo (editor de capítulo, formato Moderno).
//
// La ilustración sale en la ficha de la novela, en la lista de capítulos, en lugar del
// número. Además el autor puede hacer que se enseñe a pantalla completa al empezar el
// capítulo, como una transición, con una pista corta de música si quiere.
//
// Cada cambio se guarda al momento en el capítulo:
//   coverUrl · coverIntro · introMusicUrl · introMusicVolume · introStyle (diseño de la
//   transición: rótulo, posición, colores, tipografía y animaciones)

export function ChapterCoverSettings({ storyId, chapterId }: { storyId: string; chapterId: string }) {
  const [open, setOpen]             = useState(false);
  const [coverUrl, setCoverUrl]     = useState<string | null>(null);
  const [intro, setIntro]           = useState(false);
  const [musicUrl, setMusicUrl]     = useState<string | null>(null);
  const [musicName, setMusicName]   = useState('');
  const [volume, setVolume]         = useState(1);
  const [uploading, setUploading]   = useState<'image' | 'music' | null>(null);
  // Diseño de la transición, y lo necesario para su vista previa
  const [introStyle, setIntroStyle] = useState<IntroStyle>({});
  const [title, setTitle]           = useState('');
  const [number, setNumber]         = useState(1);

  const chapterRef = doc(db, 'stories', storyId, 'chapters', chapterId);

  useEffect(() => {
    getDoc(doc(db, 'stories', storyId, 'chapters', chapterId)).then(snap => {
      const d = snap.data();
      if (!d) return;
      setCoverUrl(d.coverUrl || null);
      setIntro(d.coverIntro === true);
      setMusicUrl(d.introMusicUrl || null);
      setMusicName(d.introMusicUrl ? mediaDisplayName(d.introMusicUrl, 'Pista') : '');
      setVolume(d.introMusicVolume ?? 1);
      setIntroStyle(d.introStyle ?? {});
      setTitle(d.title ?? '');
    }).catch(e => console.error('Error cargando la ilustración del capítulo:', e));
    // Número del capítulo dentro de la historia (para la vista previa)
    getDocs(collection(db, 'stories', storyId, 'chapters')).then(snap => {
      const sorted = sortChapters(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setNumber(Math.max(0, sorted.findIndex(ch => ch.id === chapterId)) + 1);
    }).catch(() => {});
  }, [storyId, chapterId]);

  // El diseño se guarda solo, un momento después del último cambio (arrastrar el rótulo
  // produce muchos seguidos). Si se sale antes, se guarda al salir.
  const pendingStyleRef = useRef<IntroStyle | null>(null);
  const styleTimerRef = useRef<any>(null);
  const flushStyle = useCallback(() => {
    clearTimeout(styleTimerRef.current);
    const pending = pendingStyleRef.current;
    pendingStyleRef.current = null;
    if (!pending) return;
    // (sin campos vacíos: Firestore no los admite)
    updateDoc(doc(db, 'stories', storyId, 'chapters', chapterId), { introStyle: JSON.parse(JSON.stringify(pending)) })
      .catch(e => console.error('Error guardando el diseño de la transición:', e));
  }, [storyId, chapterId]);
  useEffect(() => flushStyle, [flushStyle]);
  const changeStyle = (next: IntroStyle) => {
    setIntroStyle(next);
    pendingStyleRef.current = next;
    clearTimeout(styleTimerRef.current);
    styleTimerRef.current = setTimeout(flushStyle, 600);
  };

  const save = async (data: Record<string, any>) => {
    try {
      await updateDoc(chapterRef, data);
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudo guardar el cambio.');
    }
  };

  // ── Ilustración ────────────────────────────────────────────────────────────
  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { AppAlert.alert('Permiso denegado', 'Necesitamos acceso a tu galería.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading('image');
    try {
      const url = await uploadImage(result.assets[0].uri, `pages/${storyId}/${chapterId}/ilustracion_${Date.now()}`, 2560);
      const old = coverUrl;
      setCoverUrl(url);
      await save({ coverUrl: url });
      if (old) deleteUnusedMedia(storyId, [old]);
    } catch (e: any) {
      AppAlert.alert('Error al subir', e?.message ?? 'Inténtalo de nuevo.');
    } finally {
      setUploading(null);
    }
  };
  const removeImage = async () => {
    const old = coverUrl;
    setCoverUrl(null);
    await save({ coverUrl: deleteField() });
    if (old) deleteUnusedMedia(storyId, [old]);
  };

  // ── Música de la transición ────────────────────────────────────────────────
  const soundRef = useRef<Audio.Sound | null>(null);
  const turnRef = useRef(0);
  const [previewing, setPreviewing] = useState(false);
  const stopPreview = useCallback(() => {
    turnRef.current++;
    const s = soundRef.current;
    soundRef.current = null;
    setPreviewing(false);
    s?.stopAsync().catch(() => {});
    s?.unloadAsync().catch(() => {});
  }, []);
  useEffect(() => stopPreview, [stopPreview]);
  const togglePreview = async () => {
    if (previewing) { stopPreview(); return; }
    if (!musicUrl) return;
    const turn = ++turnRef.current;
    setPreviewing(true);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: musicUrl }, { shouldPlay: true, volume: musicPlaybackVolume(volume) });
      if (turn !== turnRef.current) { sound.unloadAsync().catch(() => {}); return; } // se paró mientras cargaba
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(st => { if (st.isLoaded && st.didJustFinish) stopPreview(); });
    } catch (e: any) {
      if (turn !== turnRef.current) return;
      setPreviewing(false);
      AppAlert.alert('No se pudo reproducir', e?.message ?? 'Comprueba el archivo.');
    }
  };

  const pickMusic = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      stopPreview();
      setUploading('music');
      const clean = asset.name.trim().replace(/[\/#?%*:|"<>\[\]]/g, '_').slice(-80) || 'pista.mp3';
      const url = await uploadLocalFile(asset.uri, `music/${storyId}/${chapterId}/${Date.now()}_${clean}`);
      const old = musicUrl;
      setMusicUrl(url); setMusicName(asset.name);
      await save({ introMusicUrl: url, introMusicVolume: volume });
      if (old) deleteUnusedMedia(storyId, [old]);
    } catch (e: any) {
      AppAlert.alert('Error al subir música', e?.message ?? 'Inténtalo de nuevo.');
    } finally {
      setUploading(null);
    }
  };
  const removeMusic = async () => {
    stopPreview();
    const old = musicUrl;
    setMusicUrl(null); setMusicName('');
    await save({ introMusicUrl: deleteField(), introMusicVolume: deleteField() });
    if (old) deleteUnusedMedia(storyId, [old]);
  };
  const changeVolume = (delta: number) => {
    const next = Math.min(1, Math.max(0.1, Math.round((volume + delta) * 10) / 10));
    if (next === volume) return;
    setVolume(next);
    soundRef.current?.setVolumeAsync(musicPlaybackVolume(next)).catch(() => {});
    save({ introMusicVolume: next });
  };

  const summary = !coverUrl ? 'Sin ilustración' : intro ? 'Se enseña al empezar el capítulo' : 'Solo en la lista de capítulos';

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.header} onPress={() => setOpen(v => !v)} activeOpacity={0.75}>
        {coverUrl
          ? <Image source={{ uri: coverUrl }} style={styles.headerThumb} contentFit="cover" />
          : <MaterialIcons name="image" size={18} color={Colors.textMuted} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Ilustración del capítulo</Text>
          <Text style={styles.headerSummary} numberOfLines={1}>{summary}</Text>
        </View>
        <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={22} color={Colors.textMuted} />
      </TouchableOpacity>

      {open && (
        <View style={styles.body}>
          <Text style={styles.hint}>
            Sale en la ficha de la novela, en la lista de capítulos, en lugar del número. Tocándola se ve entera.
          </Text>
          {coverUrl && <Image source={{ uri: coverUrl }} style={styles.preview} contentFit="contain" />}
          <View style={styles.row}>
            <TouchableOpacity style={styles.btn} onPress={() => withUploadNotice(pickImage)} disabled={!!uploading} activeOpacity={0.75}>
              {uploading === 'image'
                ? <ActivityIndicator size="small" color={Colors.emerald} />
                : <MaterialIcons name="upload" size={16} color={Colors.emerald} />}
              <Text style={styles.btnText}>{coverUrl ? 'Cambiar ilustración' : 'Subir ilustración'}</Text>
            </TouchableOpacity>
            {coverUrl && (
              <TouchableOpacity style={styles.btn} onPress={removeImage} disabled={!!uploading} activeOpacity={0.75}>
                <MaterialIcons name="close" size={16} color="#FF6B6B" />
                <Text style={[styles.btnText, { color: '#FF6B6B' }]}>Quitar</Text>
              </TouchableOpacity>
            )}
          </View>

          {coverUrl && (
            <>
              <Text style={styles.label}>Al empezar el capítulo</Text>
              <View style={styles.row}>
                {([{ value: false, label: 'No enseñarla' }, { value: true, label: 'Enseñarla a pantalla completa' }] as const).map(opt => (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.choice, intro === opt.value && styles.choiceActive]}
                    onPress={() => { setIntro(opt.value); save({ coverIntro: opt.value }); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.choiceText, intro === opt.value && styles.choiceTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {coverUrl && intro && (
            <>
              <Text style={styles.hint}>
                El lector ve la ilustración con el título del capítulo y toca para empezar. La música que viniera
                sonando del capítulo anterior se apaga: este capítulo empieza de cero, con la música de sus páginas.
              </Text>
              <IntroStyleEditor image={coverUrl} value={introStyle} onChange={changeStyle} number={number} title={title} />

              <Text style={styles.label}>Música de la transición (opcional)</Text>
              <Text style={styles.hint}>
                Una pista corta que suena una vez mientras se ve la ilustración. No pasa a las páginas del capítulo.
              </Text>
              {musicUrl && (
                <View style={styles.musicRow}>
                  <TouchableOpacity style={styles.playBtn} onPress={togglePreview} activeOpacity={0.75}>
                    <MaterialIcons name={previewing ? 'stop' : 'play-arrow'} size={20} color={Colors.aqua} />
                  </TouchableOpacity>
                  <Text style={styles.musicName} numberOfLines={1}>{musicName}</Text>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => changeVolume(-0.1)} hitSlop={6}>
                    <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <Text style={styles.volume}>{Math.round(volume * 100)}%</Text>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => changeVolume(0.1)} hitSlop={6}>
                    <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              )}
              <View style={styles.row}>
                <TouchableOpacity style={styles.btn} onPress={() => withUploadNotice(pickMusic)} disabled={!!uploading} activeOpacity={0.75}>
                  {uploading === 'music'
                    ? <ActivityIndicator size="small" color={Colors.emerald} />
                    : <MaterialIcons name="music-note" size={16} color={Colors.emerald} />}
                  <Text style={styles.btnText}>{musicUrl ? 'Cambiar pista' : 'Subir pista'}</Text>
                </TouchableOpacity>
                {musicUrl && (
                  <TouchableOpacity style={styles.btn} onPress={removeMusic} disabled={!!uploading} activeOpacity={0.75}>
                    <MaterialIcons name="close" size={16} color="#FF6B6B" />
                    <Text style={[styles.btnText, { color: '#FF6B6B' }]}>Quitar</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ── Diseño de la transición ──────────────────────────────────────────────────
// Vista previa (la misma que verá el lector) y todos los ajustes del rótulo y de las
// animaciones. El rótulo se coloca arrastrándolo en la vista previa.

const SWATCHES = ['#FFFFFF', '#000000', '#00E5A0', '#FFD166', '#FF6B6B', '#6EC6FF', '#C792EA', '#F78C6C', '#F5E6C8'];
const POSITIONS: { x: number; y: number; align: 'left' | 'center' | 'right' }[] = [
  { x: 6, y: 14, align: 'left' },  { x: 50, y: 14, align: 'center' },  { x: 94, y: 14, align: 'right' },
  { x: 6, y: 50, align: 'left' },  { x: 50, y: 50, align: 'center' },  { x: 94, y: 50, align: 'right' },
  { x: 6, y: 84, align: 'left' },  { x: 50, y: 84, align: 'center' },  { x: 94, y: 84, align: 'right' },
];
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function Chips<T extends string>({ options, value, onPick }: {
  options: readonly { key: T; label: string }[]; value: T; onPick: (key: T) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map(o => (
        <TouchableOpacity
          key={o.key}
          style={[styles.choice, value === o.key && styles.choiceActive]}
          onPress={() => onPick(o.key)}
          activeOpacity={0.75}
        >
          <Text style={[styles.choiceText, value === o.key && styles.choiceTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Stepper({ label, onMinus, onPlus }: { label: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={styles.musicRow}>
      <TouchableOpacity style={styles.stepBtn} onPress={onMinus} hitSlop={6}>
        <MaterialIcons name="remove" size={14} color={Colors.textSecondary} />
      </TouchableOpacity>
      <Text style={[styles.volume, { minWidth: 64 }]}>{label}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={onPlus} hitSlop={6}>
        <MaterialIcons name="add" size={14} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

function ColorPicker({ value, onPick, auto }: { value?: string; onPick: (hex?: string) => void; auto?: boolean }) {
  const [hex, setHex] = useState(value ?? '');
  useEffect(() => { setHex(value ?? ''); }, [value]);
  return (
    <View style={[styles.row, { alignItems: 'center' }]}>
      {auto && (
        <TouchableOpacity style={[styles.choice, !value && styles.choiceActive]} onPress={() => onPick(undefined)} activeOpacity={0.75}>
          <Text style={[styles.choiceText, !value && styles.choiceTextActive]}>El del lector</Text>
        </TouchableOpacity>
      )}
      {SWATCHES.map(s => (
        <TouchableOpacity
          key={s}
          style={[styles.swatch, { backgroundColor: s }, value?.toUpperCase() === s && styles.swatchActive]}
          onPress={() => onPick(s)}
          activeOpacity={0.75}
        />
      ))}
      <TextInput
        style={styles.hexInput}
        value={hex}
        onChangeText={t => {
          setHex(t);
          const m = t.trim().match(/^#?([0-9a-fA-F]{6})$/);
          if (m) onPick(`#${m[1].toUpperCase()}`);
        }}
        placeholder="#RRGGBB"
        placeholderTextColor={Colors.textMuted}
        autoCapitalize="characters"
        maxLength={7}
      />
    </View>
  );
}

function LineEditor({ label, auto, text, hidden, onChange }: {
  label: string; auto: string; text?: string; hidden?: boolean;
  onChange: (patch: { text?: string; hidden?: boolean }) => void;
}) {
  const mode = hidden ? 'hidden' : text !== undefined ? 'custom' : 'auto';
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <Chips
        options={[{ key: 'auto', label: auto }, { key: 'custom', label: 'Otro texto' }, { key: 'hidden', label: 'No ponerla' }] as const}
        value={mode}
        onPick={k => onChange(k === 'hidden' ? { text, hidden: true } : k === 'custom' ? { text: text ?? '', hidden: false } : { text: undefined, hidden: false })}
      />
      {mode === 'custom' && (
        <TextInput
          style={styles.textInput}
          value={text ?? ''}
          onChangeText={t => onChange({ text: t, hidden: false })}
          placeholder="Escribe el texto"
          placeholderTextColor={Colors.textMuted}
          maxLength={80}
        />
      )}
    </>
  );
}

function IntroStyleEditor({ image, value, onChange, number, title }: {
  image: string; value: IntroStyle; onChange: (next: IntroStyle) => void; number: number; title: string;
}) {
  const c = { ...INTRO_DEFAULTS, ...value };
  const set = (patch: Partial<IntroStyle>) => onChange({ ...value, ...patch });
  const [replay, setReplay] = useState(0);

  // Arrastrar el rótulo en la vista previa
  const boxRef = useRef({ width: 0, height: 0 });
  const liveRef = useRef({ value, onChange, x: c.x, y: c.y });
  liveRef.current = { value, onChange, x: c.x, y: c.y };
  const startRef = useRef({ x: 0, y: 0 });
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false, // que la lista no se lleve el arrastre
    onPanResponderGrant: () => { startRef.current = { x: liveRef.current.x, y: liveRef.current.y }; },
    onPanResponderMove: (_, g) => {
      const box = boxRef.current;
      if (!box.width) return;
      liveRef.current.onChange({
        ...liveRef.current.value,
        x: Math.round(clamp(startRef.current.x + (g.dx / box.width) * 100, 0, 100)),
        y: Math.round(clamp(startRef.current.y + (g.dy / box.height) * 100, 0, 100)),
      });
    },
  }), []);

  return (
    <>
      <Text style={styles.label}>Diseño de la transición</Text>
      <Text style={styles.hint}>
        Así la verá el lector. Arrastra el rótulo en la imagen para colocarlo donde quieras.
      </Text>
      {/* La vista previa se queda a la vista mientras se baja por los ajustes (navegador) */}
      <View style={[styles.introSticky, Platform.OS === 'web' ? ({ position: 'sticky', top: 0 } as any) : null]}>
        <View
          style={styles.introPreview}
          onLayout={e => { boxRef.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}
        >
          <ChapterIntroView image={image} style={value} number={number} title={title || 'Título del capítulo'} accent={Colors.emerald} replayKey={replay} />
          <View style={[StyleSheet.absoluteFill, Platform.OS === 'web' ? ({ cursor: 'move' } as any) : null]} {...pan.panHandlers} />
        </View>
        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => setReplay(n => n + 1)} activeOpacity={0.75}>
            <MaterialIcons name="replay" size={16} color={Colors.emerald} />
            <Text style={styles.btnText}>Ver las animaciones</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => onChange({})} activeOpacity={0.75}>
            <MaterialIcons name="restart-alt" size={16} color={Colors.textSecondary} />
            <Text style={[styles.btnText, { color: Colors.textSecondary }]}>Restablecer</Text>
          </TouchableOpacity>
        </View>
      </View>

      <LineEditor
        label="Primera línea" auto={`«Capítulo ${number}»`} text={value.line1} hidden={value.hide1}
        onChange={p => onChange({ ...value, line1: p.text, hide1: p.hidden })}
      />
      <Text style={styles.sublabel}>Color</Text>
      <ColorPicker value={value.color1} onPick={hex => set({ color1: hex })} auto />

      <LineEditor
        label="Segunda línea" auto="El título del capítulo" text={value.line2} hidden={value.hide2}
        onChange={p => onChange({ ...value, line2: p.text, hide2: p.hidden })}
      />
      <Text style={styles.sublabel}>Color</Text>
      <ColorPicker value={c.color2} onPick={hex => set({ color2: hex ?? '#FFFFFF' })} />

      <Text style={styles.label}>Posición del rótulo</Text>
      <View style={styles.musicRow}>
        <View style={styles.posGrid}>
          {POSITIONS.map((p, i) => {
            const active = Math.abs(c.x - p.x) < 2 && Math.abs(c.y - p.y) < 2;
            return (
              <TouchableOpacity key={i} style={[styles.posCell, active && styles.posCellActive]} onPress={() => set(p)} activeOpacity={0.7} />
            );
          })}
        </View>
        <View style={{ flex: 1, gap: 8 }}>
          <Chips
            options={[{ key: 'left', label: 'Izquierda' }, { key: 'center', label: 'Centrado' }, { key: 'right', label: 'Derecha' }] as const}
            value={c.align}
            // Además de alinear el texto, lleva el rótulo a ese lado de la pantalla (si solo
            // cambiara la alineación, el rótulo saltaría de sitio y podría salirse)
            onPick={align => set({ align, x: align === 'left' ? 6 : align === 'center' ? 50 : 94 })}
          />
          <Text style={styles.hint}>Horizontal {c.x}% · vertical {c.y}%</Text>
        </View>
      </View>

      <Text style={styles.label}>Tamaño</Text>
      <Stepper
        label={`${Math.round(c.size * 100)}%`}
        onMinus={() => set({ size: Math.round(clamp(c.size - 0.1, 0.4, 4) * 10) / 10 })}
        onPlus={() => set({ size: Math.round(clamp(c.size + 0.1, 0.4, 4) * 10) / 10 })}
      />

      <Text style={styles.label}>Tipografía</Text>
      <Chips options={INTRO_FONTS} value={c.font} onPick={font => set({ font })} />
      {Platform.OS !== 'web' ? null : (
        <Text style={styles.hint}>En la app del móvil algunas tipografías se sustituyen por la más parecida del teléfono.</Text>
      )}

      <Text style={styles.label}>Detrás del texto</Text>
      <Chips options={INTRO_BACKDROPS} value={c.backdrop} onPick={backdrop => set({ backdrop })} />

      <Text style={styles.label}>Animación del rótulo</Text>
      <Chips options={INTRO_TEXT_ANIMS} value={c.textAnim} onPick={textAnim => { set({ textAnim }); }} />
      <Text style={styles.sublabel}>Aparece tras la ilustración</Text>
      <Stepper
        label={c.textDelay === 0 ? 'A la vez' : `${c.textDelay.toFixed(2).replace(/0$/, '').replace('.', ',')} s`}
        onMinus={() => set({ textDelay: clamp(Math.round((c.textDelay - 0.25) * 100) / 100, 0, 8) })}
        onPlus={() => set({ textDelay: clamp(Math.round((c.textDelay + 0.25) * 100) / 100, 0, 8) })}
      />

      <Text style={styles.label}>Animación de la ilustración</Text>
      <Chips options={INTRO_IMAGE_ANIMS} value={c.imageAnim} onPick={imageAnim => set({ imageAnim })} />
      <Text style={styles.sublabel}>Velocidad</Text>
      <Chips options={INTRO_SPEEDS} value={c.imageSpeed} onPick={imageSpeed => set({ imageSpeed })} />
      <Text style={styles.sublabel}>Encaje en la pantalla</Text>
      <Chips
        options={[{ key: 'contain', label: 'Entera (sin recortar)' }, { key: 'cover', label: 'Llenar la pantalla' }] as const}
        value={c.imageFit}
        onPick={imageFit => set({ imageFit })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  introPreview: {
    width: '100%', maxWidth: 540, aspectRatio: 844 / 390, borderRadius: 6, overflow: 'hidden',
    backgroundColor: '#000', borderWidth: 1, borderColor: Colors.border,
  },
  introSticky: { zIndex: 5, gap: 8, paddingVertical: 8, backgroundColor: Colors.surface },
  sublabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  swatchActive: { borderWidth: 3, borderColor: Colors.emerald },
  hexInput: {
    width: 92, fontSize: 12, color: Colors.textPrimary, paddingVertical: 5, paddingHorizontal: 8,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
  },
  textInput: {
    fontSize: 14, color: Colors.textPrimary, paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.border, maxWidth: 420,
  },
  posGrid: { width: 96, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  posCell: { width: 30, height: 18, borderRadius: 3, borderWidth: 1, borderColor: Colors.border },
  posCellActive: { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  wrap: {
    marginHorizontal: 20, marginBottom: 10, borderRadius: 8, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  headerThumb: { width: 44, height: 28, borderRadius: 4, backgroundColor: '#000' },
  headerTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  headerSummary: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  hint: { fontSize: 12, lineHeight: 17, color: Colors.textMuted },
  label: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 },
  preview: { width: '100%', maxWidth: 420, aspectRatio: 16 / 9, borderRadius: 6, backgroundColor: '#000' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.border,
  },
  btnText: { fontSize: 12, fontWeight: '600', color: Colors.emerald },
  choice: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  choiceActive: { borderColor: Colors.emerald, backgroundColor: Colors.emerald + '18' },
  choiceText: { fontSize: 12, color: Colors.textSecondary },
  choiceTextActive: { color: Colors.emerald, fontWeight: '700' },
  musicRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  playBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  musicName: { flex: 1, fontSize: 13, color: Colors.textPrimary },
  stepBtn: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  volume: { minWidth: 40, textAlign: 'center', fontSize: 12, color: Colors.textSecondary },
});
