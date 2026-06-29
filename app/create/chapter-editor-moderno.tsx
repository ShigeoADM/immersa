import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  collection, doc, updateDoc, deleteDoc, getDocs, getDoc,
  query, orderBy,
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '@/config/firebase';
import { Colors } from '@/constants/theme';

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

type ImageAnchor   = 'top' | 'center' | 'bottom';
type ImageFit      = 'cover' | 'contain';
type TextSize      = 'xs' | 'sm' | 'md' | 'lg';
type TextBoxLayout = { x: number; y: number; w: number; h: number };

interface Page {
  id: string;
  text: string;
  backgroundUrl: string;
  imageAnchor?: ImageAnchor;
  imageFit?: ImageFit;
  musicUrl?: string | null;
  textSize?: TextSize;
  textBoxLayout?: TextBoxLayout;
  order: number;
}

export default function ChapterEditorModernoScreen() {
  const router = useRouter();
  const { storyId, chapterId, chapterTitle } = useLocalSearchParams<{
    storyId: string;
    chapterId: string;
    chapterTitle: string;
  }>();

  const [pages, setPages]                       = useState<Page[]>([]);
  const [loadingPages, setLoadingPages]         = useState(true);
  const [chapterPublished, setChapterPublished] = useState(false);
  const [savingChapter, setSavingChapter]       = useState(false);
  const [editingTitle, setEditingTitle]         = useState(false);
  const [titleInput, setTitleInput]             = useState('');

  const title = chapterTitle ? decodeURIComponent(chapterTitle) : 'Capítulo';

  const startEditingTitle = () => {
    setTitleInput(title);
    setEditingTitle(true);
  };

  const commitTitleEdit = async () => {
    setEditingTitle(false);
    const newTitle = titleInput.trim();
    if (!newTitle || newTitle === title) return;
    try {
      await updateDoc(
        doc(db, 'stories', storyId as string, 'chapters', chapterId as string),
        { title: newTitle }
      );
    } catch (e) {
      console.error('Error actualizando título:', e);
    }
  };

  // ── Carga páginas cada vez que la pantalla toma el foco ──────────────────
  const loadPages = useCallback(async () => {
    if (!storyId || !chapterId) return;
    setLoadingPages(true);
    try {
      const [chSnap, pagesSnap] = await Promise.all([
        getDoc(doc(db, 'stories', storyId as string, 'chapters', chapterId as string)),
        getDocs(query(
          collection(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages'),
          orderBy('order', 'asc')
        )),
      ]);
      if (chSnap.exists()) setChapterPublished(chSnap.data().published === true);
      setPages(pagesSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Page, 'id'>) })));
    } catch (e) {
      console.error('Error cargando páginas:', e);
    } finally {
      setLoadingPages(false);
    }
  }, [storyId, chapterId]);

  useFocusEffect(
    useCallback(() => {
      loadPages();
    }, [loadPages])
  );

  // ── Guardar capítulo y volver ─────────────────────────────────────────────
  const handleSaveChapter = async () => {
    if (savingChapter) return;
    setSavingChapter(true);
    try {
      await updateDoc(
        doc(db, 'stories', storyId as string, 'chapters', chapterId as string),
        { updatedAt: new Date().toISOString() }
      );
      router.back();
    } catch (e) {
      console.error('Error guardando capítulo:', e);
      router.back();
    } finally {
      setSavingChapter(false);
    }
  };

  // ── Borrar página ─────────────────────────────────────────────────────────
  const handleDeletePage = (page: Page) => {
    confirmAction(
      'Borrar página',
      `¿Seguro que quieres borrar la página ${pages.findIndex(p => p.id === page.id) + 1}?`,
      'Borrar',
      async () => {
        try {
          if (page.backgroundUrl) {
            try { await deleteObject(ref(storage, page.backgroundUrl)); } catch (_) {}
          }
          await deleteDoc(
            doc(db, 'stories', storyId as string, 'chapters', chapterId as string, 'pages', page.id)
          );
          setPages(prev => prev.filter(p => p.id !== page.id));
        } catch (e) {
          console.error('Error borrando página:', e);
        }
      },
    );
  };

  // ── Navegar al editor de página ───────────────────────────────────────────
  const openNewPage = () => {
    router.push({
      pathname: '/create/page-editor',
      params: {
        storyId: storyId as string,
        chapterId: chapterId as string,
        pageOrder: String(pages.length + 1),
      },
    });
  };

  const openEditPage = (page: Page) => {
    router.push({
      pathname: '/create/page-editor',
      params: {
        storyId: storyId as string,
        chapterId: chapterId as string,
        pageId: page.id,
        pageOrder: String(pages.findIndex(p => p.id === page.id) + 1),
      },
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />

      <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Image source={require('@/assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveBtn} activeOpacity={0.8} onPress={handleSaveChapter} disabled={savingChapter}>
            {savingChapter
              ? <ActivityIndicator size="small" color={Colors.emerald} />
              : <Text style={styles.saveBtnText}>Guardar</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View style={styles.titleArea}>
        {editingTitle ? (
          <TextInput
            style={styles.chapterTitleInput}
            value={titleInput}
            onChangeText={setTitleInput}
            onBlur={commitTitleEdit}
            onSubmitEditing={commitTitleEdit}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            maxLength={80}
          />
        ) : (
          <View style={styles.titleRow}>
            <Text style={styles.chapterTitle} numberOfLines={1}>{title}</Text>
            <TouchableOpacity onPress={startEditingTitle} style={styles.editTitleBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="edit" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

        )}
        <View style={styles.orientationBadge}>
          <MaterialIcons name="stay-current-landscape" size={12} color={Colors.emerald} />
          <Text style={styles.orientationText}>Horizontal</Text>
        </View>
      </View>
      <View style={styles.divider} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {loadingPages ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={Colors.emerald} />
          </View>
        ) : pages.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="article" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyText}>Aún no hay páginas.</Text>
            <Text style={styles.emptyHint}>Añade la primera página del capítulo.</Text>
          </View>
        ) : (
          pages.map((page, i) => (
            <View key={page.id} style={styles.pageRow}>
              <TouchableOpacity
                style={styles.pageThumbnailBtn}
                activeOpacity={0.75}
                onPress={() => router.push(`/reader/page-moderno?storyId=${storyId}&chapterId=${chapterId}&pageIndex=${i}`)}
              >
                <View style={styles.pageThumbnail}>
                  {page.backgroundUrl
                    ? <Image source={{ uri: page.backgroundUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                    : null
                  }
                  <Text style={styles.pageThumbnailText} numberOfLines={3}>{page.text || ''}</Text>
                  <Text style={styles.pageThumbnailNum}>{i + 1}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pageRowInner} activeOpacity={0.8} onPress={() => openEditPage(page)}>
                <View style={{ flex: 1 }}>
                  <View style={styles.badgeRow}>
                    {page.backgroundUrl
                      ? <View style={styles.hasBgBadge}>
                          <MaterialIcons name="image" size={11} color={Colors.emerald} />
                          <Text style={styles.hasBgText}>Con imagen</Text>
                        </View>
                      : null
                    }
                    {page.musicUrl !== undefined && (
                      <View style={[styles.hasBgBadge, {
                        backgroundColor: page.musicUrl === null ? Colors.card : Colors.aqua + '18',
                        borderColor: page.musicUrl === null ? Colors.border : Colors.aqua + '50',
                      }]}>
                        <MaterialIcons
                          name={page.musicUrl === null ? 'music-off' : 'audiotrack'}
                          size={11}
                          color={page.musicUrl === null ? Colors.textMuted : Colors.aqua}
                        />
                        <Text style={[styles.hasBgText, { color: page.musicUrl === null ? Colors.textMuted : Colors.aqua }]}>
                          {page.musicUrl === null ? 'Silencio' : 'Con música'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.pagePreview} numberOfLines={2}>
                    {page.text || 'Página sin texto'}
                  </Text>
                </View>
                <MaterialIcons name="edit" size={16} color={Colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.pageDeleteBtn} activeOpacity={0.7} onPress={() => handleDeletePage(page)}>
                <MaterialIcons name="delete-outline" size={17} color="#FF6B6B" />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {chapterPublished ? (
          <View style={styles.publishedNotice}>
            <MaterialIcons name="lock" size={14} color={Colors.textMuted} />
            <Text style={styles.publishedNoticeText}>Capítulo publicado — solo puedes editar o borrar páginas existentes</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.addPageBtn} activeOpacity={0.85} onPress={openNewPage}>
            <MaterialIcons name="add" size={20} color="#000" />
            <Text style={styles.addPageText}>Añadir página</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  headerWrap:  { backgroundColor: Colors.emerald, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 5, elevation: 8, zIndex: 10 },
  headerBar:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn:     { padding: 2 },
  logo:        { height: 40, width: 40, borderRadius: 6 },
  saveBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, backgroundColor: '#000' },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: Colors.emerald, letterSpacing: 0.5 },
  titleArea:   { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12, alignItems: 'center', gap: 6 },
  titleRow:         { width: '100%', alignItems: 'center', justifyContent: 'center' },
  chapterTitle:     { fontSize: 20, fontWeight: '600', color: Colors.textPrimary, letterSpacing: 0.3, textAlign: 'center' },
  chapterTitleInput:{ fontSize: 20, fontWeight: '600', color: Colors.textPrimary, letterSpacing: 0.3, textAlign: 'center', borderBottomWidth: 2, borderBottomColor: Colors.emerald, paddingVertical: 2, minWidth: 120 },
  editTitleBtn:     { position: 'absolute', right: 0, padding: 4 },
  orientationBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: Colors.emerald + '18', borderWidth: 1, borderColor: Colors.emerald + '40' },
  orientationText:  { fontSize: 11, color: Colors.emerald, fontWeight: '600', letterSpacing: 0.3 },
  divider:     { height: 1, backgroundColor: Colors.border, marginHorizontal: 20, marginBottom: 8 },
  scroll:      { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, flexGrow: 1 },
  emptyState:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  emptyText:   { fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  emptyHint:   { fontSize: 13, color: Colors.textMuted },
  pageRow:          { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border },
  pageThumbnailBtn: { paddingVertical: 10, paddingRight: 10 },
  pageThumbnail:    { width: 72, height: 42, borderRadius: 3, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, padding: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  pageThumbnailText:{ fontSize: 5, color: '#fff', lineHeight: 7, zIndex: 1 },
  pageThumbnailNum: { position: 'absolute', top: 3, right: 4, fontSize: 8, color: Colors.textMuted, fontWeight: '700' },
  pageRowInner:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  pageDeleteBtn:    { paddingHorizontal: 14, paddingVertical: 14 },
  hasBgBadge:       { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 },
  hasBgText:        { fontSize: 10, color: Colors.emerald, fontWeight: '600' },
  pagePreview:      { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  footer:      { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  addPageBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.emerald, borderRadius: 6, paddingVertical: 14 },
  addPageText: { fontSize: 15, fontWeight: '700', color: '#000' },
  publishedNotice:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 4 },
  publishedNoticeText: { flex: 1, fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  badgeRow:            { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' },
});
