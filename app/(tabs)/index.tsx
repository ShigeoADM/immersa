import React, { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { useNotifications } from '@/context/NotificationsContext';
import { useAuth } from '@/context/AuthContext';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { tutorialTitle, tutorialZone } from '@/components/tutorial';
import { statusLabel, useT, formatLabel } from '@/i18n';

interface StoryCard {
  id: string;
  title: string;
  format: string;
  status: string;
  published: boolean;
  publishedAt?: string;
  uid: string;
  coverUrl?: string;
  coverOrientation?: 'vertical' | 'horizontal';
  likeCount?: number;
  isAdult?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  ongoing:   'En curso',
  completed: 'Completada',
  hiatus:    'En pausa',
  upcoming:  'Próximamente',
};

// ─── Dimensiones del sistema de tarjetas ─────────────────────────────────────
//
//  ROW_H  = altura total que ocupa cada "slot" en el scroll horizontal.
//           Todos los items (verticales y pares de horizontales) tienen esta altura.
//
//  Tarjeta vertical: cover = ROW_H - V_INFO_H, info = V_INFO_H
//  Par horizontal:   cada card = (ROW_H - HPAIR_GAP) / 2
//  Sola horizontal:  más alta y un poco más ancha, centrada en el slot

const ROW_H      = 242;   // altura uniforme de todos los slots
const V_INFO_H   = 68;    // área de texto debajo de la portada vertical: título en dos líneas y estado
const V_COVER_H  = ROW_H - V_INFO_H;   // 174 px
const VCARD_W    = 128;

const HPAIR_GAP  = 6;
const HPAIR_CARD_H = Math.floor((ROW_H - HPAIR_GAP) / 2);  // 107 px cada una
const HPAIR_W    = 150;

// Tarjeta sola: más grande, centrada verticalmente en el slot
const HSINGLE_H  = Math.round(ROW_H * 0.72);  // 158 px
const HSINGLE_W  = Math.round(HSINGLE_H * 16 / 9);  // ≈ 281 px → lo cap a 200 px
const HSINGLE_W_CAPPED = Math.min(HSINGLE_W, 200);

// ── Tarjeta VERTICAL (portrait) ───────────────────────────────────────────────
function VerticalCard({ story, onPress }: { story: StoryCard; onPress: () => void }) {
  useT();
  const fmtColor = Colors.formatColors[story.format as keyof typeof Colors.formatColors] ?? Colors.emerald;
  return (
    <TouchableOpacity style={styles.vCard} activeOpacity={0.8} onPress={onPress}>
      <View style={styles.vCardCover}>
        {story.coverUrl
          ? <Image source={{ uri: story.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          : <View style={styles.cardPlaceholder}>
              <MaterialIcons name="menu-book" size={28} color={fmtColor + '60'} />
            </View>
        }
        <View style={[styles.fmtBadge, { backgroundColor: fmtColor + 'CC' }]}>
          <Text style={styles.fmtBadgeText}>{formatLabel(story.format)}</Text>
        </View>
      </View>
      <View style={styles.vCardInfo}>
        <Text style={styles.vCardTitle} numberOfLines={2}>{story.title}</Text>
        <Text style={styles.vCardStatus} numberOfLines={1}>
          {statusLabel(story.status)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Tarjeta HORIZONTAL dentro de un par ──────────────────────────────────────
function HorizontalCard({ story, onPress, single }: {
  story: StoryCard;
  onPress: () => void;
  single?: boolean;
}) {
  useT();
  const fmtColor = Colors.formatColors[story.format as keyof typeof Colors.formatColors] ?? Colors.emerald;
  const cardStyle = single ? styles.hCardSingle : styles.hCard;
  return (
    <TouchableOpacity style={cardStyle} activeOpacity={0.8} onPress={onPress}>
      {story.coverUrl
        ? <Image source={{ uri: story.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        : <View style={[styles.cardPlaceholder, { backgroundColor: Colors.card }]}>
            <MaterialIcons name="menu-book" size={single ? 24 : 16} color={fmtColor + '60'} />
          </View>
      }
      <View style={[styles.fmtBadge, { backgroundColor: fmtColor + 'CC' }]}>
        <Text style={styles.fmtBadgeText}>{formatLabel(story.format)}</Text>
      </View>
      <View style={styles.hCardTitleWrap}>
        <Text style={[styles.hCardTitle, single && styles.hCardTitleSingle]} numberOfLines={2}>
          {story.title}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Cabecera de sección ───────────────────────────────────────────────────────
// `zone`: nombre de la sección para el tutorial, que señala su título (components/tutorial.tsx)
function SectionHeader({ title, color, zone }: { title: string; color?: string; zone?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionAccent, { backgroundColor: color ?? Colors.emerald }]} />
      <Text style={styles.sectionTitle} nativeID={zone ? tutorialTitle(zone) : undefined}>{title}</Text>
    </View>
  );
}

// ── Fila mixta ────────────────────────────────────────────────────────────────
function StoryRow({ stories, loading, onPress }: {
  stories: StoryCard[];
  loading: boolean;
  onPress: (s: StoryCard) => void;
}) {
  const t = useT();
  const isDesktop = useIsDesktop();
  if (loading) {
    return <View style={styles.rowLoader}><ActivityIndicator color={Colors.emerald} /></View>;
  }
  if (stories.length === 0) {
    return (
      // En escritorio va a la izquierda, bajo el título de su sección
      <View style={[styles.rowEmpty, isDesktop && { alignItems: 'flex-start' }]}>
        <Text style={styles.rowEmptyText}>{t('home.empty')}</Text>
      </View>
    );
  }

  const horiz = stories.filter(s => s.coverOrientation === 'horizontal');
  const vert  = stories.filter(s => s.coverOrientation !== 'horizontal');

  // Agrupar horizontales en pares
  const pairs: StoryCard[][] = [];
  for (let i = 0; i < horiz.length; i += 2) {
    pairs.push(horiz.slice(i, i + 2));
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rowContent}
    >
      {pairs.map((pair, idx) => {
        const isSingle = pair.length === 1;
        return (
          <View
            key={`pair-${idx}`}
            style={isSingle ? styles.hColSingle : styles.hColPair}
          >
            {pair.map(s => (
              <HorizontalCard
                key={s.id}
                story={s}
                single={isSingle}
                onPress={() => onPress(s)}
              />
            ))}
          </View>
        );
      })}

      {vert.map(s => (
        <VerticalCard key={s.id} story={s} onPress={() => onPress(s)} />
      ))}
    </ScrollView>
  );
}

// ── Pantalla principal ────────────────────────────────────────────────────────
export default function DiscoverScreen() {
  const t = useT();
  const isDesktop = useIsDesktop();
  const router = useRouter();

  const [modernoAll,  setModernoAll]  = useState<StoryCard[]>([]);
  const [webnovelAll, setWebnovelAll] = useState<StoryCard[]>([]);
  const [modernoNew,  setModernoNew]  = useState<StoryCard[]>([]);
  const [webnovelNew, setWebnovelNew] = useState<StoryCard[]>([]);
  const [popular, setPopular]         = useState<StoryCard[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const { isAdult, blocked } = useAuth();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoadingFeed(true);
      (async () => {
        try {
          const snap = await getDocs(
            query(collection(db, 'stories'), where('published', '==', true), limit(200))
          );
          if (cancelled) return;
          const all = snap.docs
            .map(d => ({ id: d.id, ...(d.data() as Omit<StoryCard, 'id'>) }))
            // Los menores de edad no ven las historias +18
            .filter(s => !(s.isAdult && isAdult === false))
            // Tampoco se muestran las historias de usuarios bloqueados
            .filter(s => !blocked.has(s.uid));

          const moderno  = all.filter(s => s.format === 'Moderno');
          const webnovel = all.filter(s => s.format === 'Webnovel');

          const byTitle  = (a: StoryCard, b: StoryCard) => a.title.localeCompare(b.title);
          const byNewest = (a: StoryCard, b: StoryCard) =>
            (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');

          // Más populares: las que tienen algún me gusta, de más a menos
          setPopular(
            all.filter(s => (s.likeCount ?? 0) > 0)
              .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || byNewest(a, b))
              .slice(0, 20)
          );
          setModernoAll([...moderno].sort(byTitle).slice(0, 20));
          setWebnovelAll([...webnovel].sort(byTitle).slice(0, 20));
          setModernoNew([...moderno].sort(byNewest).slice(0, 20));
          setWebnovelNew([...webnovel].sort(byNewest).slice(0, 20));
        } catch (e) {
          console.error('Error cargando feed:', e);
        } finally {
          if (!cancelled) setLoadingFeed(false);
        }
      })();
      return () => { cancelled = true; };
    }, [isAdult, blocked])
  );

  const handleStoryPress = (s: StoryCard) => router.push(`/story/${s.id}`);
  const { unreadCount } = useNotifications();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />

      {/* En escritorio la cabecera es la barra superior común (WebTopBar) */}
      {!isDesktop && <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.headerBar}>
          <Image source={require('@/assets/images/logo.png')} style={styles.logo} contentFit="contain" />
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.searchBtn}
              activeOpacity={0.8}
              onPress={() => router.push('/notifications')}
            >
              <MaterialIcons name="notifications" size={18} color={Colors.emerald} />
              {unreadCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.searchBtn} activeOpacity={0.8} onPress={() => router.push('/search' as Href)}>
              <MaterialIcons name="search" size={18} color={Colors.emerald} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>}

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {popular.length > 0 && (
          <View style={styles.section} nativeID={tutorialZone('popular')}>
            <SectionHeader zone="popular" title={t('home.popular')} color="#FF69B4" />
            <StoryRow stories={popular} loading={false} onPress={handleStoryPress} />
          </View>
        )}

        <View style={styles.section} nativeID={tutorialZone('moderno')}>
          <SectionHeader zone="moderno" title={t('home.moderno')} color={Colors.formatColors.Moderno} />
          <StoryRow stories={modernoAll} loading={loadingFeed} onPress={handleStoryPress} />
        </View>

        <View style={styles.section} nativeID={tutorialZone('webnovel')}>
          <SectionHeader zone="webnovel" title={t('home.webnovel')} color={Colors.formatColors.Webnovel} />
          <StoryRow stories={webnovelAll} loading={loadingFeed} onPress={handleStoryPress} />
        </View>

        <View style={styles.section} nativeID={tutorialZone('modernoNew')}>
          <SectionHeader zone="modernoNew" title={t('home.modernoNew')} color={Colors.formatColors.Moderno} />
          <StoryRow stories={modernoNew} loading={loadingFeed} onPress={handleStoryPress} />
        </View>

        <View style={[styles.section, { marginBottom: 32 }]} nativeID={tutorialZone('webnovelNew')}>
          <SectionHeader zone="webnovelNew" title={t('home.webnovelNew')} color={Colors.formatColors.Webnovel} />
          <StoryRow stories={webnovelNew} loading={loadingFeed} onPress={handleStoryPress} />
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  headerWrap: {
    backgroundColor: Colors.emerald,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 10,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logo:      { height: 40, width: 40, borderRadius: 6 },
  searchBtn: { width: 34, height: 34, borderRadius: 6, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', gap: 8 },
  badge: {
    position: 'absolute', top: -5, right: -5,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    backgroundColor: '#FF4444', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.emerald,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  scroll:    { flex: 1 },

  section:       { marginTop: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 14 },
  sectionAccent: { width: 3, height: 18, borderRadius: 2 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.3 },

  rowLoader:    { height: ROW_H, alignItems: 'center', justifyContent: 'center' },
  rowEmpty:     { height: 80, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  rowEmptyText: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },

  // El scroll alinea los items al tope para que los pares
  // y las verticales empiecen al mismo nivel vertical.
  rowContent: { paddingHorizontal: 20, gap: 10, alignItems: 'flex-start' },

  // ── Tarjeta VERTICAL ──────────────────────────────────────────────────────────
  vCard: {
    width: VCARD_W,
    height: ROW_H,          // igual que el slot → misma altura que un par
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vCardCover:  { width: '100%', height: V_COVER_H },
  vCardInfo:   { flex: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 3, justifyContent: 'flex-start' },
  vCardTitle:  { fontSize: 12, fontWeight: '600', color: Colors.textPrimary, lineHeight: 17 },
  vCardStatus: { fontSize: 10, lineHeight: 14, color: Colors.textMuted },

  // ── Columna para el par de horizontales ──────────────────────────────────────
  hColPair: {
    height: ROW_H,          // mismo slot que la vertical
    width: HPAIR_W,
    flexDirection: 'column',
    gap: HPAIR_GAP,
  },
  // Columna para una sola horizontal: centrada verticalmente
  hColSingle: {
    height: ROW_H,
    width: HSINGLE_W_CAPPED,
    justifyContent: 'center',  // centra la tarjeta en el slot
  },

  // ── Tarjeta HORIZONTAL en par ─────────────────────────────────────────────────
  hCard: {
    width: HPAIR_W,
    height: HPAIR_CARD_H,   // (ROW_H - gap) / 2 = mismo entre las dos que ROW_H
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'flex-end',
  },
  // Tarjeta sola: más grande, misma anchura que su columna
  hCardSingle: {
    width: HSINGLE_W_CAPPED,
    height: HSINGLE_H,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'flex-end',
  },
  hCardTitleWrap: {
    // Se pega al fondo de la tarjeta y crece hacia arriba según el texto
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 6,
    paddingTop: 5,
    paddingBottom: 5,
  },
  hCardTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 12,
  },
  hCardTitleSingle: {
    fontSize: 11,
    lineHeight: 15,
  },

  // ── Compartidos ───────────────────────────────────────────────────────────────
  cardPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fmtBadge:     { position: 'absolute', top: 6, left: 6, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  fmtBadgeText: { fontSize: 8, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
});
