import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';

// Alert.alert funciona en móvil pero las callbacks no se ejecutan bien en web.
// Este helper usa window.confirm en web y Alert nativo en móvil.
function confirmAction(
  title: string,
  message: string,
  confirmText: string,
  onConfirm: () => void,
) {
  if (Platform.OS === 'web') {
    if ((window as any).confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      { text: confirmText, style: 'destructive', onPress: onConfirm },
    ]);
  }
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { collection, addDoc, doc, updateDoc, deleteDoc, getDocs, getDoc, query, orderBy } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/theme';

interface Chapter {
  id: string;
  title: string;
  createdAt: string;
  published?: boolean;
  publishedAt?: string;
}

// Borra capítulo + todas sus páginas
async function deleteChapterWithCascade(storyId: string, chapterId: string) {
  const pagesSnap = await getDocs(collection(db, 'stories', storyId, 'chapters', chapterId, 'pages'));
  for (const pg of pagesSnap.docs) {
    await deleteDoc(doc(db, 'stories', storyId, 'chapters', chapterId, 'pages', pg.id));
  }
  await deleteDoc(doc(db, 'stories', storyId, 'chapters', chapterId));
}

// Borra historia + todos sus capítulos + todas sus páginas
async function deleteStoryWithCascade(storyId: string) {
  const chaptersSnap = await getDocs(collection(db, 'stories', storyId, 'chapters'));
  for (const ch of chaptersSnap.docs) {
    await deleteChapterWithCascade(storyId, ch.id);
  }
  await deleteDoc(doc(db, 'stories', storyId));
}

export default function EditorModernoScreen() {
  const router = useRouter();
  const { storyId, title } = useLocalSearchParams<{ storyId: string; title: string }>();

  const [chapters, setChapters]         = useState<Chapter[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [chapterTitle, setChapterTitle] = useState('');
  const [saving, setSaving]                   = useState(false);
  const [publishing, setPublishing]           = useState(false);
  const [published, setPublished]             = useState(false);
  const [publishingChapter, setPublishingChapter] = useState<string | null>(null);

  const storyTitle = title ? decodeURIComponent(title) : 'Sin título';

  // Cargar story + capítulos al entrar
  useEffect(() => {
    if (!storyId) return;
    (async () => {
      try {
        // Estado publicado del libro
        const storySnap = await getDoc(doc(db, 'stories', storyId as string));
        if (storySnap.exists()) setPublished(storySnap.data().published === true);

        // Capítulos
        const snap = await getDocs(
          query(collection(db, 'stories', storyId as string, 'chapters'), orderBy('createdAt', 'asc'))
        );
        setChapters(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Chapter, 'id'>) })));
      } catch (e) {
        console.error('Error cargando datos:', e);
      } finally {
        setLoadingChapters(false);
      }
    })();
  }, [storyId]);

  const handleDeleteStory = () => {
    confirmAction(
      'Borrar libro',
      `¿Seguro que quieres borrar "${storyTitle}"? Se borrarán también todos sus capítulos y páginas.`,
      'Borrar',
      async () => {
        try {
          await deleteStoryWithCascade(storyId as string);
          router.replace('/(tabs)/write');
        } catch (e) {
          console.error('Error borrando historia:', e);
        }
      },
    );
  };

  const handleDeleteChapter = (chapter: Chapter) => {
    confirmAction(
      'Borrar capítulo',
      `¿Seguro que quieres borrar "${chapter.title}"? Se borrarán también todas sus páginas.`,
      'Borrar',
      async () => {
        try {
          await deleteChapterWithCascade(storyId as string, chapter.id);
          setChapters(prev => prev.filter(c => c.id !== chapter.id));
        } catch (e) {
          console.error('Error borrando capítulo:', e);
        }
      },
    );
  };

  const handleToggleChapter = async (chapter: Chapter) => {
    if (publishingChapter) return;
    setPublishingChapter(chapter.id);
    const now = new Date().toISOString();
    try {
      if (!chapter.published) {
        // ── Publicar capítulo ──
        await updateDoc(
          doc(db, 'stories', storyId as string, 'chapters', chapter.id),
          { published: true, publishedAt: now }
        );
        // Publicar el libro automáticamente si no lo estaba
        if (!published) {
          await updateDoc(doc(db, 'stories', storyId as string), {
            published: true, publishedAt: now, updatedAt: now,
          });
          setPublished(true);
        }
        setChapters(prev => prev.map(c =>
          c.id === chapter.id ? { ...c, published: true, publishedAt: now } : c
        ));
      } else {
        // ── Despublicar capítulo ──
        await updateDoc(
          doc(db, 'stories', storyId as string, 'chapters', chapter.id),
          { published: false, publishedAt: null }
        );
        const updated = chapters.map(c =>
          c.id === chapter.id ? { ...c, published: false, publishedAt: undefined } : c
        );
        setChapters(updated);
        // Si no queda ningún capítulo publicado, despublicar el libro también
        const anyPublished = updated.some(c => c.published);
        if (!anyPublished && published) {
          await updateDoc(doc(db, 'stories', storyId as string), {
            published: false, updatedAt: now,
          });
          setPublished(false);
        }
      }
    } catch (e) {
      console.error('Error toggling capítulo:', e);
    } finally {
      setPublishingChapter(null);
    }
  };

  const handleToggleStory = () => {
    if (publishing) return;

    if (!published) {
      confirmAction(
        'Publicar libro',
        chapters.length > 0
          ? `Se publicará "${storyTitle}" junto con todos sus capítulos (${chapters.length}) y aparecerá en el feed.`
          : `Se publicará "${storyTitle}". Como aún no tiene capítulos, aparecerá en el feed pero sin contenido.`,
        'Publicar',
        () => doToggleStory(true),
      );
    } else {
      confirmAction(
        'Despublicar libro',
        `Se despublicará "${storyTitle}" y todos sus capítulos desaparecerán del feed.`,
        'Despublicar',
        () => doToggleStory(false),
      );
    }
  };

  const doToggleStory = async (publish: boolean) => {
    setPublishing(true);
    const now = new Date().toISOString();
    try {
      // 1. Actualizar el libro
      await updateDoc(doc(db, 'stories', storyId as string), {
        published: publish,
        ...(publish ? { publishedAt: now } : {}),
        updatedAt: now,
      });

      // 2. Actualizar todos los capítulos en paralelo
      if (chapters.length > 0) {
        await Promise.all(
          chapters.map(ch =>
            updateDoc(
              doc(db, 'stories', storyId as string, 'chapters', ch.id),
              { published: publish, ...(publish ? { publishedAt: now } : { publishedAt: null }) }
            )
          )
        );
      }

      // 3. Actualizar estado local
      setPublished(publish);
      setChapters(prev =>
        prev.map(c => ({
          ...c,
          published: publish,
          publishedAt: publish ? now : undefined,
        }))
      );
    } catch (e) {
      console.error('Error publicando historia:', e);
      Alert.alert('Error', 'No se pudo cambiar el estado de publicación. Inténtalo de nuevo.');
    } finally {
      setPublishing(false);
    }
  };

  const handleAddChapter = async () => {
    if (!chapterTitle.trim() || saving) return;
    setSaving(true);
    try {
      const docRef = await addDoc(
        collection(db, 'stories', storyId as string, 'chapters'),
        { title: chapterTitle.trim(), pages: [], createdAt: new Date().toISOString() }
      );
      const newChapter = { id: docRef.id, title: chapterTitle.trim(), createdAt: new Date().toISOString() };
      setChapters(prev => [...prev, newChapter]);
      setChapterTitle('');
      setModalVisible(false);
      router.push(`/create/chapter-editor-moderno?storyId=${storyId}&chapterId=${docRef.id}&chapterTitle=${encodeURIComponent(chapterTitle.trim())}`);
    } catch (e) {
      console.error('Error creando capítulo:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />

      <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Image source={require('@/assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.deleteBtn}
              activeOpacity={0.7}
              onPress={() => router.push(`/create/moderno-details?storyId=${storyId}`)}
            >
              <MaterialIcons name="edit" size={18} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} activeOpacity={0.7} onPress={handleDeleteStory}>
              <MaterialIcons name="delete-outline" size={20} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.publishBtn, published && styles.publishBtnDone]}
              activeOpacity={0.8}
              onPress={handleToggleStory}
              disabled={publishing}
            >
              {publishing
                ? <ActivityIndicator size="small" color={Colors.emerald} />
                : <Text style={[styles.publishBtnText, published && styles.publishBtnTextDone]}>
                    {published ? 'Despublicar' : 'Publicar'}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.titleArea}>
        <Text style={styles.storyTitle} numberOfLines={1}>{storyTitle}</Text>
      </View>
      <View style={styles.divider} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {loadingChapters ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={Colors.emerald} />
          </View>
        ) : chapters.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="menu-book" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyText}>Aún no hay capítulos.</Text>
            <Text style={styles.emptyHint}>Pulsa el botón para añadir el primero.</Text>
          </View>
        ) : (
          chapters.map((ch, i) => (
            <View key={ch.id} style={styles.chapterRow}>
              <TouchableOpacity
                style={styles.chapterRowInner}
                activeOpacity={0.8}
                onPress={() => router.push(`/create/chapter-editor-moderno?storyId=${storyId}&chapterId=${ch.id}&chapterTitle=${encodeURIComponent(ch.title)}`)}
              >
                <View style={styles.chapterNumber}>
                  <Text style={styles.chapterNumberText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chapterTitle} numberOfLines={1}>{ch.title}</Text>
                  {ch.published
                    ? <Text style={styles.chapterPublishedLabel}>● Publicado</Text>
                    : <Text style={styles.chapterDraftLabel}>○ Borrador</Text>
                  }
                </View>
                <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} />
              </TouchableOpacity>

              {/* Botón publicar / despublicar capítulo */}
              <TouchableOpacity
                style={[styles.chapterPublishBtn, ch.published && styles.chapterPublishedBtn]}
                activeOpacity={0.7}
                onPress={() => handleToggleChapter(ch)}
                disabled={publishingChapter === ch.id}
              >
                {publishingChapter === ch.id
                  ? <ActivityIndicator size="small" color={Colors.emerald} />
                  : <Text style={[styles.chapterPublishBtnText, ch.published && styles.chapterPublishedBtnText]}>
                      {ch.published ? 'Despublicar' : 'Publicar'}
                    </Text>
                }
              </TouchableOpacity>

              <TouchableOpacity style={styles.chapterDeleteBtn} activeOpacity={0.7} onPress={() => handleDeleteChapter(ch)}>
                <MaterialIcons name="delete-outline" size={18} color="#FF6B6B" />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <TouchableOpacity style={styles.addChapterBtn} activeOpacity={0.85} onPress={() => setModalVisible(true)}>
          <MaterialIcons name="add" size={20} color="#000" />
          <Text style={styles.addChapterText}>Añadir capítulo</Text>
        </TouchableOpacity>
      </SafeAreaView>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Nuevo capítulo</Text>
            <TextInput
              style={styles.modalInput}
              value={chapterTitle}
              onChangeText={setChapterTitle}
              placeholder="Título del capítulo"
              placeholderTextColor={Colors.textMuted}
              autoFocus
              maxLength={80}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setModalVisible(false); setChapterTitle(''); }}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, (!chapterTitle.trim() || saving) && styles.modalConfirmDisabled]}
                onPress={handleAddChapter}
                disabled={!chapterTitle.trim() || saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={styles.modalConfirmText}>Crear</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  headerWrap: {
    backgroundColor: Colors.emerald,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 10,
  },
  headerBar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn:          { padding: 2 },
  logo:             { height: 40, width: 40, borderRadius: 6 },
  headerActions:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deleteBtn:        { width: 34, height: 34, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  publishBtn:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, backgroundColor: '#000', minWidth: 80, alignItems: 'center' },
  publishBtnDone:   { backgroundColor: Colors.emerald + '22', borderWidth: 1, borderColor: Colors.emerald + '55' },
  publishBtnText:   { fontSize: 13, fontWeight: '700', color: Colors.emerald, letterSpacing: 0.5 },
  publishBtnTextDone: { color: Colors.emerald },
  titleArea:        { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, alignItems: 'center' },
  storyTitle:       { fontSize: 20, fontWeight: '600', color: Colors.textPrimary, letterSpacing: 0.3, textAlign: 'center' },
  divider:          { height: 1, backgroundColor: Colors.border, marginHorizontal: 20, marginBottom: 8 },
  scroll:           { flex: 1 },
  scrollContent:    { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, flexGrow: 1 },
  emptyState:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  emptyText:        { fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  emptyHint:        { fontSize: 13, color: Colors.textMuted },
  chapterRow:       { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border },
  chapterRowInner:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  chapterDeleteBtn: { paddingHorizontal: 14, paddingVertical: 14 },
  chapterNumber: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: Colors.emerald + '20',
    borderWidth: 1,
    borderColor: Colors.emerald + '40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chapterNumberText:      { fontSize: 12, fontWeight: '700', color: Colors.emerald },
  chapterTitle:           { fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },
  chapterPublishedLabel:  { fontSize: 11, color: Colors.emerald, fontWeight: '600', marginTop: 2 },
  chapterDraftLabel:      { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  chapterPublishBtn:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: Colors.emerald, marginRight: 4 },
  chapterPublishBtnText:   { fontSize: 11, color: Colors.emerald, fontWeight: '700', letterSpacing: 0.3 },
  chapterPublishedBtn:     { borderColor: Colors.textMuted, backgroundColor: 'transparent' },
  chapterPublishedBtnText: { color: Colors.textMuted },
  footer:            { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  addChapterBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.emerald, borderRadius: 6, paddingVertical: 14 },
  addChapterText:    { fontSize: 15, fontWeight: '700', color: '#000' },
  modalOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  modalBox:          { width: '100%', backgroundColor: Colors.surface, borderRadius: 8, padding: 24, borderWidth: 1, borderColor: Colors.border, gap: 16 },
  modalTitle:        { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  modalInput:        { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: 14 },
  modalActions:      { flexDirection: 'row', gap: 10 },
  modalCancelBtn:    { flex: 1, paddingVertical: 12, borderRadius: 4, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  modalCancelText:   { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  modalConfirmBtn:   { flex: 1, paddingVertical: 12, borderRadius: 4, backgroundColor: Colors.emerald, alignItems: 'center' },
  modalConfirmDisabled: { opacity: 0.4 },
  modalConfirmText:  { fontSize: 14, fontWeight: '700', color: '#000' },
});
