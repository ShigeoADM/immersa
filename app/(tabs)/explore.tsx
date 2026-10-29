import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { CoverImage } from '@/components/cover-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  collection, getDocs, doc, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { AppHeader } from '@/components/app-header';
import { cleanupDeletedStories } from '@/services/notifications';
import { setSaved } from '@/services/social';
import { statusLabel, useT, formatLabel } from '@/i18n';

interface LibraryEntry {
  storyId: string;
  title: string;
  coverUrl?: string | null;
  coverThumbUrl?: string | null;
  format: string;
  coverOrientation?: 'vertical' | 'horizontal';
  status?: string;
  isReading: boolean;
  isInterested: boolean;
  lastChapterId?: string | null;
  lastPageIndex?: number | null;
  lastPageId?: string | null;
  lastChapterTitle?: string | null;
  lastReadAt?: string | null;
  addedAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  ongoing: 'En curso', completed: 'Completada',
  hiatus: 'En pausa', upcoming: 'Próximamente',
};

// ── Tarjeta de libro en biblioteca ───────────────────────────────────────────
function BookCard({
  entry,
  onPress,
  onContinue,
  onRemove,
  showProgress,
}: {
  entry: LibraryEntry;
  onPress: () => void;
  onContinue?: () => void;
  onRemove: () => void;
  showProgress: boolean;
}) {
  const t = useT();
  const fmtColor =
    Colors.formatColors[entry.format as keyof typeof Colors.formatColors] ?? Colors.emerald;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.82}>
      {/* Portada */}
      <View style={styles.cardCover}>
        <CoverImage
          sources={[entry.coverThumbUrl, entry.coverUrl]}
          fallback={<View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
            <MaterialIcons name="menu-book" size={26} color={fmtColor + '60'} />
          </View>}
        />
        <View style={[styles.fmtBadge, { backgroundColor: fmtColor + 'CC' }]}>
          <Text style={styles.fmtBadgeText}>{formatLabel(entry.format)}</Text>
        </View>
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>{entry.title}</Text>
          {entry.status ? (
            <Text style={styles.cardStatus}>
              {statusLabel(entry.status)}
            </Text>
          ) : null}
          {showProgress && entry.lastChapterTitle ? (
            <View style={styles.progressRow}>
              <MaterialIcons name="bookmark" size={11} color={Colors.emerald} />
              <Text style={styles.progressText} numberOfLines={1}>
                {entry.lastChapterTitle}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Acciones */}
        <View style={styles.cardActions}>
          {showProgress && onContinue ? (
            <TouchableOpacity style={styles.continueBtn} onPress={onContinue} activeOpacity={0.8}>
              <MaterialIcons name="play-arrow" size={14} color="#000" />
              <Text style={styles.continueBtnText}>{t('common.continue')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.removeBtn} onPress={onRemove} activeOpacity={0.7}>
            <MaterialIcons name="close" size={15} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Sección con cabecera ──────────────────────────────────────────────────────
function Section({
  title, accentColor, children, empty,
}: {
  title: string;
  accentColor: string;
  children?: React.ReactNode;
  empty?: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionAccent, { backgroundColor: accentColor }]} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children ?? empty}
    </View>
  );
}

// ── Pantalla principal ────────────────────────────────────────────────────────
export default function BibliotecaScreen() {
  const t = useT();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!user) { setLoading(false); return; }
      let cancelled = false;
      setLoading(true);

      (async () => {
        try {
          // Quita las historias que ya no existen (y crea el aviso al usuario)
          await cleanupDeletedStories(user.uid)
            .catch(e => console.error('Error limpiando biblioteca:', e));
          const snap = await getDocs(collection(db, 'users', user.uid, 'library'));
          if (cancelled) return;
          const data = snap.docs.map(d => d.data() as LibraryEntry);
          setEntries(data);
        } catch (e) {
          console.error('Error cargando biblioteca:', e);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => { cancelled = true; };
    }, [user])
  );

  // ── Acciones ─────────────────────────────────────────────────────────────
  const removeFromReading = async (storyId: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'library', storyId), {
        isReading: false,
        lastChapterId: null,
        lastPageIndex: null,
        lastPageId: null,
        lastChapterTitle: null,
        lastReadAt: null,
      });
      setEntries(prev =>
        prev.map(e => e.storyId === storyId
          ? { ...e, isReading: false, lastChapterId: null, lastPageIndex: null, lastChapterTitle: null }
          : e
        )
      );
    } catch (e) {
      console.error('Error quitando de Seguir leyendo:', e);
    }
  };

  const removeFromInterested = async (storyId: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'library', storyId), {
        isInterested: false,
      });
      setSaved(storyId, user.uid, false); // estadística para el autor
      setEntries(prev =>
        prev.map(e => e.storyId === storyId ? { ...e, isInterested: false } : e)
      );
    } catch (e) {
      console.error('Error quitando de Leer más tarde:', e);
    }
  };

  // ── Auth loading ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={Colors.emerald} />
      </View>
    );
  }

  // ── Sin sesión ────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.centered}>
          <View style={styles.guestIcon}>
            <MaterialIcons name="library-books" size={36} color={Colors.textMuted} />
          </View>
          <Text style={styles.guestTitle}>{t('library.emptyTitle')}</Text>
          <Text style={styles.guestText}>
            {t('library.emptyBody')}
          </Text>
          <TouchableOpacity
            style={styles.loginBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/auth/login')}
          >
            <Text style={styles.loginBtnText}>{t('common.login')}</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  const reading    = entries.filter(e => e.isReading).sort((a, b) =>
    (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? '')
  );
  const interested = entries.filter(e => e.isInterested && !e.isReading).sort((a, b) =>
    b.addedAt.localeCompare(a.addedAt)
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <AppHeader />
      <View style={styles.headerWrap}>
        <Text style={styles.headerTitle}>{t('library.title')}</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.emerald} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

          {/* ── Seguir leyendo ── */}
          <Section
            title={t('library.reading')}
            accentColor={Colors.emerald}
            empty={
              <Text style={styles.emptyText}>
                {t('library.readingEmpty')}
              </Text>
            }
          >
            {reading.length > 0
              ? reading.map(e => (
                  <BookCard
                    key={e.storyId}
                    entry={e}
                    showProgress
                    onPress={() => router.push(`/story/${e.storyId}`)}
                    onContinue={e.lastChapterId
                      ? () => router.push((e.format === 'Webnovel'
                          ? `/reader/webnovel?storyId=${e.storyId}&chapterId=${e.lastChapterId}`
                          : `/reader/page-moderno?storyId=${e.storyId}&chapterId=${e.lastChapterId}&pageIndex=${e.lastPageIndex ?? 0}${e.lastPageId ? `&pageId=${e.lastPageId}` : ''}`) as Href)
                      : undefined
                    }
                    onRemove={() => removeFromReading(e.storyId)}
                  />
                ))
              : null
            }
          </Section>

          {/* ── Leer más tarde ── */}
          <Section
            title={t('library.later')}
            accentColor={Colors.aqua}
            empty={
              <Text style={styles.emptyText}>
                {t('library.laterEmpty')}
              </Text>
            }
          >
            {interested.length > 0
              ? interested.map(e => (
                  <BookCard
                    key={e.storyId}
                    entry={e}
                    showProgress={false}
                    onPress={() => router.push(`/story/${e.storyId}`)}
                    onRemove={() => removeFromInterested(e.storyId)}
                  />
                ))
              : null
            }
          </Section>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 14 },

  // ── Header ───────────────────────────────────────────────────────────────────
  headerWrap: {
    backgroundColor: Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 14,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.2,
  },

  scrollContent: { paddingTop: 4 },

  // ── Guest ────────────────────────────────────────────────────────────────────
  guestIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  guestTitle:   { fontSize: 20, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center' },
  guestText:    { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  loginBtn:     { marginTop: 4, paddingHorizontal: 32, paddingVertical: 13, borderRadius: 24, backgroundColor: Colors.emerald },
  loginBtnText: { fontSize: 14, fontWeight: '700', color: '#000', letterSpacing: 0.5 },

  // ── Sección ──────────────────────────────────────────────────────────────────
  section:       { paddingTop: 28 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 20, marginBottom: 14,
  },
  sectionAccent: { width: 3, height: 18, borderRadius: 2 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.3 },
  emptyText:     {
    fontSize: 14, color: Colors.textMuted, fontStyle: 'italic',
    paddingHorizontal: 20, lineHeight: 21,
  },

  // ── Card ─────────────────────────────────────────────────────────────────────
  card: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // Portada izquierda
  cardCover: {
    width: 68,
    height: 100,
    backgroundColor: Colors.card,
  },
  coverPlaceholder: {
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fmtBadge: {
    position: 'absolute', top: 4, left: 4,
    paddingHorizontal: 4, paddingVertical: 2, borderRadius: 3,
  },
  fmtBadgeText: { fontSize: 7, fontWeight: '700', color: '#000', letterSpacing: 0.3 },

  // Info derecha
  cardInfo: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
  },
  cardTitle:  { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, lineHeight: 18 },
  cardStatus: { fontSize: 11, color: Colors.textMuted },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  progressText: { fontSize: 11, color: Colors.emerald, flex: 1 },

  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },

  continueBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.emerald,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 5,
  },
  continueBtnText: { fontSize: 12, fontWeight: '700', color: '#000' },

  removeBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 'auto',
  },
});
