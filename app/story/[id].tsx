import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { doc, getDoc, collection, getDocs, query, orderBy, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';

interface Story {
  id: string;
  title: string;
  subtitle?: string;
  format: string;
  status: string;
  synopsis?: string;
  coverUrl?: string;
  publishedAt?: string;
}

interface Chapter {
  id: string;
  title: string;
  published: boolean;
  publishedAt?: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  ongoing:   'En curso',
  completed: 'Completada',
  hiatus:    'En pausa',
  upcoming:  'Próximamente',
};

export default function StoryDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [story, setStory]             = useState<Story | null>(null);
  const [chapters, setChapters]       = useState<Chapter[]>([]);
  const [loading, setLoading]         = useState(true);
  const [isInterested, setIsInterested]   = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  // Progreso de lectura (guardado automáticamente)
  const [readingProgress, setReadingProgress] = useState<{ chapterId: string; pageIndex: number } | null>(null);
  // Marcador manual del lector
  const [bookmark, setBookmark] = useState<{ chapterId: string; pageIndex: number; chapterTitle?: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const requests: Promise<any>[] = [
          getDoc(doc(db, 'stories', id as string)),
          getDocs(query(
            collection(db, 'stories', id as string, 'chapters'),
            orderBy('createdAt', 'asc')
          )),
        ];
        if (user) {
          requests.push(getDoc(doc(db, 'users', user.uid, 'library', id as string)));
        }

        const [storySnap, chaptersSnap, librarySnap] = await Promise.all(requests);

        if (storySnap.exists()) {
          setStory({ id: storySnap.id, ...(storySnap.data() as Omit<Story, 'id'>) });
        }
        const allChapters = chaptersSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as Omit<Chapter, 'id'>) }));
        setChapters(allChapters.filter((c: Chapter) => c.published === true));
        if (librarySnap?.exists()) {
          const ld = librarySnap.data();
          setIsInterested(ld.isInterested === true);
          if (ld.isReading && ld.lastChapterId) {
            setReadingProgress({ chapterId: ld.lastChapterId, pageIndex: ld.lastPageIndex ?? 0 });
          }
          if (ld.bookmarkChapterId) {
            setBookmark({ chapterId: ld.bookmarkChapterId, pageIndex: ld.bookmarkPageIndex ?? 0, chapterTitle: ld.bookmarkChapterTitle ?? undefined });
          }
        }
      } catch (e) {
        console.error('Error cargando historia:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, user]);

  const toggleInterested = async () => {
    if (!user || !story || bookmarkLoading) return;
    setBookmarkLoading(true);
    const newVal = !isInterested;
    try {
      const libraryRef = doc(db, 'users', user.uid, 'library', story.id);
      const snap = await getDoc(libraryRef);
      if (snap.exists()) {
        await updateDoc(libraryRef, { isInterested: newVal });
      } else {
        await setDoc(libraryRef, {
          storyId: story.id,
          title: story.title,
          coverUrl: story.coverUrl ?? null,
          format: story.format,
          coverOrientation: (story as any).coverOrientation ?? 'vertical',
          status: story.status ?? 'ongoing',
          isReading: false,
          isInterested: newVal,
          addedAt: new Date().toISOString(),
        });
      }
      setIsInterested(newVal);
    } catch (e) {
      console.error('Error actualizando biblioteca:', e);
    } finally {
      setBookmarkLoading(false);
    }
  };

  const fmtColor = story
    ? (Colors.formatColors[story.format as keyof typeof Colors.formatColors] ?? Colors.emerald)
    : Colors.emerald;

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <ActivityIndicator color={Colors.emerald} style={{ marginTop: 80 }} />
      </View>
    );
  }

  if (!story) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Text style={{ color: Colors.textMuted, textAlign: 'center', marginTop: 80 }}>Historia no encontrada</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ── Portada / hero ── */}
      <View style={styles.hero}>
        {story.coverUrl
          ? <Image source={{ uri: story.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0A' }]} />
        }
        <View style={styles.heroOverlay} />

        <SafeAreaView edges={['top']} style={styles.heroHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          {user ? (
            <TouchableOpacity
              style={styles.bookmarkBtn}
              onPress={toggleInterested}
              disabled={bookmarkLoading}
              activeOpacity={0.8}
            >
              {bookmarkLoading
                ? <ActivityIndicator size="small" color="#fff" />
                : <MaterialIcons
                    name={isInterested ? 'bookmark' : 'bookmark-border'}
                    size={22}
                    color={isInterested ? Colors.emerald : '#fff'}
                  />
              }
            </TouchableOpacity>
          ) : null}
        </SafeAreaView>

        <View style={styles.heroInfo}>
          <View style={[styles.formatBadge, { backgroundColor: fmtColor + 'CC' }]}>
            <Text style={styles.formatBadgeText}>{story.format}</Text>
          </View>
          <Text style={styles.heroTitle}>{story.title}</Text>
          {story.subtitle ? (
            <Text style={styles.heroSubtitle}>{story.subtitle}</Text>
          ) : null}
          <Text style={styles.heroStatus}>{STATUS_LABELS[story.status] ?? story.status ?? 'En curso'}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Sinopsis */}
        {story.synopsis ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Sinopsis</Text>
            <Text style={styles.description}>{story.synopsis}</Text>
          </View>
        ) : null}

        {/* Capítulos */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Capítulos ({chapters.length})</Text>

          {chapters.length === 0 ? (
            <Text style={styles.emptyChapters}>No hay capítulos publicados aún.</Text>
          ) : (
            chapters.map((ch, i) => {
              const isBookmarked = bookmark?.chapterId === ch.id;
              return (
                <TouchableOpacity
                  key={ch.id}
                  style={styles.chapterRow}
                  activeOpacity={0.8}
                  onPress={() => router.push(`/reader/page-moderno?storyId=${id}&chapterId=${ch.id}&pageIndex=0`)}
                >
                  <View style={[styles.chapterNum, { borderColor: fmtColor + '50', backgroundColor: fmtColor + '15' }]}>
                    <Text style={[styles.chapterNumText, { color: fmtColor }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chapterTitle} numberOfLines={1}>{ch.title}</Text>
                    {isBookmarked && (
                      <Text style={styles.chapterBookmarkHint}>
                        Marcador · pág. {(bookmark!.pageIndex) + 1}
                      </Text>
                    )}
                  </View>
                  {isBookmarked && (
                    <TouchableOpacity
                      onPress={() => router.push(`/reader/page-moderno?storyId=${id}&chapterId=${bookmark!.chapterId}&pageIndex=${bookmark!.pageIndex}`)}
                      activeOpacity={0.75}
                      style={styles.chapterBookmarkBtn}
                    >
                      <MaterialIcons name="bookmark" size={16} color={Colors.emerald} />
                    </TouchableOpacity>
                  )}
                  <MaterialIcons name="play-arrow" size={20} color={fmtColor} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

      </ScrollView>

      {/* ── Botones de lectura ── */}
      {chapters.length > 0 && (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          {/* Ir al marcador — solo si existe */}
          {bookmark && (
            <TouchableOpacity
              style={[styles.readBtn, styles.bookmarkReadBtn]}
              activeOpacity={0.85}
              onPress={() => router.push(`/reader/page-moderno?storyId=${id}&chapterId=${bookmark.chapterId}&pageIndex=${bookmark.pageIndex}`)}
            >
              <MaterialIcons name="bookmark" size={18} color={Colors.emerald} />
              <Text style={[styles.readBtnText, { color: Colors.emerald }]} numberOfLines={1}>
                {bookmark.chapterTitle ? `Marcador · ${bookmark.chapterTitle} · pág. ${bookmark.pageIndex + 1}` : `Ir al marcador · pág. ${bookmark.pageIndex + 1}`}
              </Text>
            </TouchableOpacity>
          )}
          {/* Continuar o empezar */}
          <TouchableOpacity
            style={[styles.readBtn, { backgroundColor: fmtColor }]}
            activeOpacity={0.85}
            onPress={() => {
              if (readingProgress) {
                router.push(`/reader/page-moderno?storyId=${id}&chapterId=${readingProgress.chapterId}&pageIndex=${readingProgress.pageIndex}`);
              } else {
                router.push(`/reader/page-moderno?storyId=${id}&chapterId=${chapters[0].id}&pageIndex=0`);
              }
            }}
          >
            <MaterialIcons name={readingProgress ? 'play-circle-outline' : 'play-arrow'} size={20} color="#000" />
            <Text style={styles.readBtnText}>{readingProgress ? 'Continuar leyendo' : 'Leer desde el principio'}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // Hero
  hero:        { height: 280, justifyContent: 'flex-end' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  heroHeader:  { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn:     { margin: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  bookmarkBtn: { margin: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  heroInfo:    { padding: 20, gap: 6 },
  formatBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  formatBadgeText: { fontSize: 10, fontWeight: '700', color: '#000', letterSpacing: 0.5 },
  heroTitle:    { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: 0.3, lineHeight: 30 },
  heroSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' },
  heroStatus:   { fontSize: 13, color: 'rgba(255,255,255,0.6)' },

  // Contenido
  scroll:        { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  section:       { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel:  { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  description:   { fontSize: 14, color: Colors.textSecondary, lineHeight: 22 },
  emptyChapters: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },

  // Fila de capítulo
  chapterRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  chapterNum:     { width: 30, height: 30, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chapterNumText: { fontSize: 12, fontWeight: '700' },
  chapterTitle:   { flex: 1, fontSize: 15, color: Colors.textPrimary, fontWeight: '500' },

  // Footer
  footer:      { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg, gap: 8 },
  readBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 6, paddingVertical: 14 },
  readBtnText: { fontSize: 15, fontWeight: '700', color: '#000' },
  bookmarkReadBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.emerald },
  // Capítulo con marcador
  chapterBookmarkHint: { fontSize: 11, color: Colors.emerald, fontWeight: '500', marginTop: 2 },
  chapterBookmarkBtn:  { padding: 4 },
});
