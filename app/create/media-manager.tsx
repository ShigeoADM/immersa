import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { collection, doc, getDoc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore';
import { getDownloadURL, listAll, ref } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import { DesktopColumn } from '@/components/desktop-column';
import { pageMediaUrls, sortChapters } from '@/services/stories';
import {
  belongsToStory, deleteStoredFile, mediaKey, plainFileName, rememberMediaNames,
} from '@/services/media';
import { pageSfxCues } from '@/constants/reader-layout';

// Archivos de una historia Moderno: todas sus imágenes, músicas y efectos, dónde se usa
// cada uno, con qué nombre se muestra, y los que ya no usa ninguna página.
//
// Los nombres se guardan en la historia (stories/{id}.mediaNames), no en el archivo:
// cambiar un nombre no toca el archivo ni las páginas que lo usan.

type Kind = 'image' | 'music' | 'sfx';
type MediaFile = {
  key: string;        // identificador del archivo (ver mediaKey)
  url: string;
  kind: Kind;
  uses: string[];     // dónde se usa: "Cap. 1 · pág. 3"…
  stored: boolean;    // subido a las carpetas de esta historia (lo demás no se borra desde aquí)
};

const KIND_LABEL: Record<Kind, string> = { image: 'Imágenes', music: 'Música', sfx: 'Efectos de sonido' };
const FOLDER_KIND: Record<string, Kind> = { pages: 'image', music: 'music', sfx: 'sfx' };

export default function MediaManagerScreen() {
  const router = useRouter();
  const { storyId, title } = useLocalSearchParams<{ storyId: string; title?: string }>();

  const [loading, setLoading] = useState(true);
  const [files, setFiles]     = useState<MediaFile[]>([]);
  const [names, setNames]     = useState<Record<string, string>>({});
  // No se pudieron listar las carpetas (faltan las reglas de Storage): no se ven huérfanos
  const [scanDenied, setScanDenied] = useState(false);
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [busy, setBusy]       = useState(false);

  const load = useCallback(async () => {
    if (!storyId) return;
    setLoading(true);
    try {
      const byKey = new Map<string, MediaFile>();
      const add = (url: string | undefined | null, kind: Kind, where: string) => {
        if (!url) return;
        const key = mediaKey(url);
        const f = byKey.get(key) ?? { key, url, kind, uses: [], stored: belongsToStory(url, storyId) };
        if (!f.uses.includes(where)) f.uses.push(where);
        byKey.set(key, f);
      };

      // 1. Lo que usan las páginas
      const [storySnap, chaptersSnap] = await Promise.all([
        getDoc(doc(db, 'stories', storyId)),
        getDocs(collection(db, 'stories', storyId, 'chapters')),
      ]);
      const savedNames = (storySnap.data()?.mediaNames ?? {}) as Record<string, string>;
      setNames(savedNames);
      rememberMediaNames(savedNames);
      const chapters = sortChapters(chaptersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      await Promise.all(chapters.map(async (ch, ci) => {
        const pages = await getDocs(query(
          collection(db, 'stories', storyId, 'chapters', ch.id, 'pages'), orderBy('order', 'asc'),
        ));
        pages.docs.forEach((p, pi) => {
          const d = p.data();
          const where = `Cap. ${ci + 1} · pág. ${pi + 1}`;
          add(d.backgroundUrl, 'image', where);
          if (typeof d.musicUrl === 'string') add(d.musicUrl, 'music', where);
          pageSfxCues(d).forEach(c => add(c.url, 'sfx', where));
          // Por si alguna página guarda algo que no encaja en lo anterior
          pageMediaUrls(d).forEach(u => { if (!byKey.has(mediaKey(u))) add(u, 'image', where); });
        });
      }));

      // 2. Lo que hay subido en las carpetas de la historia y no usa ninguna página
      let denied = false;
      await Promise.all(Object.keys(FOLDER_KIND).map(async folder => {
        try {
          const root = await listAll(ref(storage, `${folder}/${storyId}`));
          const lists = await Promise.all(root.prefixes.map(p => listAll(p)));
          const items = [...root.items, ...lists.flatMap(l => l.items)];
          await Promise.all(items.map(async item => {
            if (byKey.has(mediaKey(item.fullPath))) return; // ya está: lo usa alguna página
            const url = await getDownloadURL(item);
            byKey.set(mediaKey(url), { key: mediaKey(url), url, kind: FOLDER_KIND[folder], uses: [], stored: true });
          }));
        } catch (e: any) {
          if (String(e?.code ?? '').includes('unauthorized')) denied = true;
          else console.error('Error listando archivos:', e);
        }
      }));
      setScanDenied(denied);

      setFiles([...byKey.values()].sort((a, b) =>
        Number(a.uses.length === 0) - Number(b.uses.length === 0) || displayName(a, savedNames).localeCompare(displayName(b, savedNames))));
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudieron cargar los archivos.');
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => { load(); }, [load]);

  // ── Escuchar un audio ──────────────────────────────────────────────────────
  const soundRef = useRef<Audio.Sound | null>(null);
  const turnRef = useRef(0);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const stopAudio = useCallback(() => {
    turnRef.current++;
    const s = soundRef.current;
    soundRef.current = null;
    setPlayingKey(null);
    s?.stopAsync().catch(() => {});
    s?.unloadAsync().catch(() => {});
  }, []);
  const toggleAudio = async (file: MediaFile) => {
    const wasPlaying = playingKey === file.key;
    stopAudio();
    if (wasPlaying) return;
    const turn = ++turnRef.current;
    setPlayingKey(file.key);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: file.url }, { shouldPlay: true, volume: 0.8 });
      if (turn !== turnRef.current) { sound.unloadAsync().catch(() => {}); return; } // se paró mientras cargaba
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate(st => { if (st.isLoaded && st.didJustFinish) stopAudio(); });
    } catch (e: any) {
      if (turn !== turnRef.current) return;
      setPlayingKey(null);
      AppAlert.alert('No se pudo reproducir', e?.message ?? 'Comprueba el archivo.');
    }
  };
  useFocusEffect(useCallback(() => stopAudio, [stopAudio]));

  // ── Cambiar el nombre ──────────────────────────────────────────────────────
  const saveName = async () => {
    if (!editing || !storyId) return;
    const { key, value } = editing;
    const next = { ...names };
    if (value.trim()) next[key] = value.trim();
    else delete next[key];
    setEditing(null);
    setNames(next);
    rememberMediaNames(next);
    try {
      await updateDoc(doc(db, 'stories', storyId), { mediaNames: next });
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudo guardar el nombre.');
    }
  };

  // ── Borrar los que no se usan ──────────────────────────────────────────────
  const unused = useMemo(() => files.filter(f => f.uses.length === 0 && f.stored), [files]);
  const removeFiles = async (targets: MediaFile[]) => {
    setBusy(true);
    try {
      if (targets.some(t => t.key === playingKey)) stopAudio();
      await Promise.all(targets.map(t => deleteStoredFile(t.url)));
      const gone = new Set(targets.map(t => t.key));
      setFiles(list => list.filter(f => !gone.has(f.key)));
    } finally {
      setBusy(false);
    }
  };
  const confirmRemove = (targets: MediaFile[]) => {
    if (targets.length === 0) return;
    AppAlert.alert(
      targets.length === 1 ? 'Borrar archivo' : `Borrar ${targets.length} archivos`,
      targets.length === 1
        ? `Se borrará «${displayName(targets[0], names)}» para siempre. Ninguna página lo usa.`
        : 'Se borrarán para siempre todos los archivos que no usa ninguna página.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: () => removeFiles(targets) },
      ],
    );
  };

  const renderFile = (file: MediaFile) => {
    const isUnused = file.uses.length === 0;
    const isEditing = editing?.key === file.key;
    return (
      <View key={file.key} style={styles.row}>
        {file.kind === 'image' ? (
          <Image source={{ uri: file.url }} style={styles.thumb} contentFit="cover" />
        ) : (
          <TouchableOpacity style={styles.playBtn} onPress={() => toggleAudio(file)} activeOpacity={0.75}>
            <MaterialIcons name={playingKey === file.key ? 'stop' : 'play-arrow'} size={22} color={Colors.aqua} />
          </TouchableOpacity>
        )}
        <View style={styles.rowInfo}>
          {isEditing ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.nameInput}
                value={editing!.value}
                onChangeText={value => setEditing({ key: file.key, value })}
                onSubmitEditing={saveName}
                placeholder="Nombre para mostrar"
                placeholderTextColor={Colors.textMuted}
                autoFocus
                maxLength={60}
              />
              <TouchableOpacity onPress={saveName} hitSlop={8}>
                <MaterialIcons name="check" size={20} color={Colors.emerald} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditing(null)} hitSlop={8}>
                <MaterialIcons name="close" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.nameRow}
              onPress={() => setEditing({ key: file.key, value: names[file.key] ?? plainFileName(file.url, '') })}
              activeOpacity={0.7}
            >
              <Text style={styles.name} numberOfLines={1}>{displayName(file, names)}</Text>
              <MaterialIcons name="edit" size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
          <Text style={[styles.uses, isUnused && styles.usesUnused]} numberOfLines={2}>
            {isUnused
              ? (file.stored ? 'No la usa ninguna página' : 'Enlace externo sin usar')
              : `${file.stored ? '' : 'Enlace externo · '}${file.uses.length > 6
                  ? `${file.uses.slice(0, 6).join(', ')} y ${file.uses.length - 6} más`
                  : file.uses.join(', ')}`}
          </Text>
        </View>
        {isUnused && file.stored && (
          <TouchableOpacity style={styles.deleteBtn} onPress={() => confirmRemove([file])} disabled={busy} hitSlop={8}>
            <MaterialIcons name="delete-outline" size={20} color="#FF6B6B" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Archivos{title ? ` · ${title}` : ''}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={load} disabled={loading} activeOpacity={0.7}>
          <MaterialIcons name="refresh" size={21} color={Colors.textSecondary} />
        </TouchableOpacity>
      </SafeAreaView>

      <DesktopColumn maxWidth={900}>
        {loading ? (
          <View style={styles.centered}><ActivityIndicator color={Colors.emerald} /></View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.summary}>
              {files.length} {files.length === 1 ? 'archivo' : 'archivos'}
              {unused.length > 0 ? ` · ${unused.length} sin usar` : ''}
            </Text>
            <Text style={styles.hint}>
              Toca un nombre para cambiarlo: es solo cómo se muestra, no afecta al archivo ni a las páginas.
              Los archivos que no usa ninguna página se pueden borrar.
            </Text>
            {scanDenied && (
              <Text style={[styles.hint, { color: '#E0A040' }]}>
                No se han podido revisar las carpetas de la historia, así que aquí solo salen los archivos que usa
                alguna página. Para ver también los que se quedaron sin usar hay que publicar las reglas nuevas de Storage.
              </Text>
            )}
            {unused.length > 1 && (
              <TouchableOpacity style={styles.purgeBtn} onPress={() => confirmRemove(unused)} disabled={busy} activeOpacity={0.8}>
                {busy
                  ? <ActivityIndicator size="small" color="#FF6B6B" />
                  : <MaterialIcons name="delete-sweep" size={18} color="#FF6B6B" />}
                <Text style={styles.purgeText}>Borrar los {unused.length} que no se usan</Text>
              </TouchableOpacity>
            )}

            {(['image', 'music', 'sfx'] as Kind[]).map(kind => {
              const list = files.filter(f => f.kind === kind);
              if (list.length === 0) return null;
              return (
                <View key={kind} style={styles.section}>
                  <Text style={styles.sectionLabel}>{KIND_LABEL[kind]} · {list.length}</Text>
                  {list.map(renderFile)}
                </View>
              );
            })}
            {files.length === 0 && (
              <Text style={styles.empty}>Esta historia todavía no tiene imágenes ni audios.</Text>
            )}
          </ScrollView>
        )}
      </DesktopColumn>
    </View>
  );
}

function displayName(file: MediaFile, names: Record<string, string>) {
  return names[file.key] ?? plainFileName(file.url, file.kind === 'image' ? 'Imagen' : 'Audio');
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 60, gap: 10 },
  summary: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  hint: { fontSize: 12, lineHeight: 17, color: Colors.textMuted },
  purgeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: '#FF6B6B55', backgroundColor: '#FF6B6B12',
  },
  purgeText: { fontSize: 13, fontWeight: '600', color: '#FF6B6B' },
  section: { marginTop: 14, gap: 2 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  thumb: { width: 76, height: 43, borderRadius: 5, backgroundColor: '#000' },
  playBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  rowInfo: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nameInput: {
    flex: 1, fontSize: 14, color: Colors.textPrimary, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 6, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
  },
  uses: { fontSize: 11, color: Colors.textMuted },
  usesUnused: { color: '#E0A040' },
  deleteBtn: { padding: 6 },
  empty: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: 40 },
});
