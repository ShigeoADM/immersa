import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { deleteField, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import { withUploadNotice } from '@/components/upload-notice';
import { mediaDisplayName, uploadImage, uploadLocalFile } from '@/services/media';
import { deleteUnusedMedia } from '@/services/stories';
import { musicPlaybackVolume } from '@/constants/reader-layout';

// Ilustración del capítulo (editor de capítulo, formato Moderno).
//
// La ilustración sale en la ficha de la novela, en la lista de capítulos, en lugar del
// número. Además el autor puede hacer que se enseñe a pantalla completa al empezar el
// capítulo, como una transición, con una pista corta de música si quiere.
//
// Cada cambio se guarda al momento en el capítulo:
//   coverUrl · coverIntro · introMusicUrl · introMusicVolume

export function ChapterCoverSettings({ storyId, chapterId }: { storyId: string; chapterId: string }) {
  const [open, setOpen]             = useState(false);
  const [coverUrl, setCoverUrl]     = useState<string | null>(null);
  const [intro, setIntro]           = useState(false);
  const [musicUrl, setMusicUrl]     = useState<string | null>(null);
  const [musicName, setMusicName]   = useState('');
  const [volume, setVolume]         = useState(1);
  const [uploading, setUploading]   = useState<'image' | 'music' | null>(null);

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
    }).catch(e => console.error('Error cargando la ilustración del capítulo:', e));
  }, [storyId, chapterId]);

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

const styles = StyleSheet.create({
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
