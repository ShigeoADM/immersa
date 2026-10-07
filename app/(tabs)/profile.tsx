import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { RoleBadge } from '@/components/role-badge';
import { getFollowerCount, getFollowingCount, getLikedCount } from '@/services/social';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { DEV_SITE_URL, IS_DEV_SITE, PROD_SITE_URL } from '@/constants/site';

interface UserProfile {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  emailPublic?: boolean;
}

interface StoryCard {
  id: string;
  title: string;
  format: string;
  status: string;
  coverUrl?: string;
  coverOrientation?: 'vertical' | 'horizontal';
}

const STATUS_LABELS: Record<string, string> = {
  ongoing: 'En curso', completed: 'Completada',
  hiatus: 'En pausa', upcoming: 'Próximamente',
};

// ── Tarjeta de libro publicado ────────────────────────────────────────────────
function StoryCard({ story, onPress }: { story: StoryCard; onPress: () => void }) {
  const fmtColor = Colors.formatColors[story.format as keyof typeof Colors.formatColors] ?? Colors.emerald;
  const isHoriz = story.coverOrientation === 'horizontal';
  return (
    <TouchableOpacity
      style={[styles.storyCard, isHoriz && styles.storyCardH]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      {story.coverUrl
        ? <Image source={{ uri: story.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        : <View style={[styles.storyCardPlaceholder, { backgroundColor: Colors.card }]}>
            <MaterialIcons name="menu-book" size={28} color={fmtColor + '60'} />
          </View>
      }
      <View style={[styles.fmtBadge, { backgroundColor: fmtColor + 'CC' }]}>
        <Text style={styles.fmtBadgeText}>{story.format}</Text>
      </View>
      {isHoriz && (
        <View style={styles.hTitleWrap}>
          <Text style={styles.hTitle} numberOfLines={2}>{story.title}</Text>
        </View>
      )}
      {!isHoriz && (
        <View style={styles.storyCardInfo}>
          <Text style={styles.storyCardTitle} numberOfLines={2}>{story.title}</Text>
          <Text style={styles.storyCardStatus}>
            {STATUS_LABELS[story.status] ?? 'En curso'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Pantalla principal ────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const isDesktop = useIsDesktop();
  const { user, loading: authLoading, isStaff, staff, can } = useAuth();
  const router = useRouter();

  const [profile,  setProfile]  = useState<UserProfile>({});
  const [stories,  setStories]  = useState<StoryCard[]>([]);
  const [loading,  setLoading]  = useState(true);
  // Seguidores, autores que sigo e historias que me gustan
  const [social, setSocial] = useState({ followers: 0, following: 0, liked: 0 });

  useFocusEffect(useCallback(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([getFollowerCount(user.uid), getFollowingCount(user.uid), getLikedCount(user.uid)])
      .then(([followers, following, liked]) => { if (!cancelled) setSocial({ followers, following, liked }); })
      .catch(e => console.error('Error cargando contadores del perfil:', e));
    return () => { cancelled = true; };
  }, [user]));

  useFocusEffect(
    useCallback(() => {
      if (!user) { setLoading(false); return; }
      let cancelled = false;
      setLoading(true);

      (async () => {
        try {
          const [profileSnap, storiesSnap] = await Promise.all([
            getDoc(doc(db, 'users', user.uid)),
            getDocs(query(
              collection(db, 'stories'),
              where('uid', '==', user.uid),
              where('published', '==', true),
            )),
          ]);
          if (cancelled) return;
          setProfile(profileSnap.exists() ? (profileSnap.data() as UserProfile) : {});
          setStories(storiesSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<StoryCard, 'id'>) })));
        } catch (e) {
          console.error('Error cargando perfil:', e);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => { cancelled = true; };
    }, [user])
  );

  // ── Cargando auth ─────────────────────────────────────────────────────────
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
          <View style={styles.guestAvatar}>
            <MaterialIcons name="person" size={36} color={Colors.textMuted} />
          </View>
          <Text style={styles.guestTitle}>No has iniciado sesión</Text>
          <Text style={styles.guestText}>
            Inicia sesión para ver tu perfil, guardar historias y seguir a tus autores favoritos.
          </Text>
          <TouchableOpacity
            style={styles.loginBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/auth/login')}
          >
            <Text style={styles.loginBtnText}>Iniciar sesión</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Perfil ────────────────────────────────────────────────────────────────
  const displayName = profile.displayName || user.displayName || 'Sin nombre';
  const email       = user.email ?? '';
  const avatarUrl   = profile.avatarUrl || user.photoURL;
  const initials    = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* ── Hero ── */}
        <View style={[styles.hero, isDesktop && styles.heroWeb]}>
          <SafeAreaView edges={['top']} style={isDesktop ? { alignSelf: 'stretch' } : undefined}>
            {/* Engranaje de ajustes */}
            <View style={styles.heroTopBar}>
              {/* Web de desarrollo (solo con ese permiso, y solo en el navegador) */}
              {Platform.OS === 'web' && can('developer') && (
                <TouchableOpacity
                  style={styles.settingsBtn}
                  activeOpacity={0.7}
                  onPress={() => { (globalThis as any).open(IS_DEV_SITE ? PROD_SITE_URL : DEV_SITE_URL, '_blank'); }}
                >
                  <MaterialIcons name={IS_DEV_SITE ? 'public' : 'science'} size={22} color={Colors.emerald} />
                </TouchableOpacity>
              )}
              {isStaff && (
                <TouchableOpacity
                  style={styles.settingsBtn}
                  activeOpacity={0.7}
                  onPress={() => router.push('/admin')}
                >
                  <MaterialIcons name="admin-panel-settings" size={22} color={Colors.emerald} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.settingsBtn}
                activeOpacity={0.7}
                onPress={() => router.push('/profile/settings')}
              >
                <MaterialIcons name="settings" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Avatar */}
          <View style={styles.avatarWrap}>
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              : <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initials}</Text>
                </View>
            }
          </View>

          {/* Nombre y email */}
          <Text style={styles.displayName}>{displayName}</Text>
          <RoleBadge role={staff.role} />
          {profile.emailPublic && email
            ? <Text style={styles.emailText}>{email}</Text>
            : null
          }

          {/* Bio */}
          {profile.bio ? (
            <Text style={styles.bio}>{profile.bio}</Text>
          ) : (
            <TouchableOpacity
              onPress={() => router.push('/profile/settings')}
              activeOpacity={0.7}
            >
              <Text style={styles.bioEmpty}>Añade una descripción en ajustes…</Text>
            </TouchableOpacity>
          )}

          {/* Contador */}
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{stories.length}</Text>
              <Text style={styles.statLabel}>{stories.length === 1 ? 'libro' : 'libros'}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{social.followers}</Text>
              <Text style={styles.statLabel}>{social.followers === 1 ? 'seguidor' : 'seguidores'}</Text>
            </View>
            {/* Estas dos abren la lista correspondiente */}
            <TouchableOpacity
              style={styles.stat}
              activeOpacity={0.7}
              onPress={() => router.push('/profile/lists?tab=following' as Href)}
            >
              <Text style={[styles.statNum, styles.statLink]}>{social.following}</Text>
              <Text style={styles.statLabel}>siguiendo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.stat}
              activeOpacity={0.7}
              onPress={() => router.push('/profile/lists?tab=liked' as Href)}
            >
              <Text style={[styles.statNum, styles.statLink]}>{social.liked}</Text>
              <Text style={styles.statLabel}>me gusta</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Libros publicados ── */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionAccent, { backgroundColor: Colors.emerald }]} />
            <Text style={styles.sectionTitle}>Libros publicados</Text>
          </View>

          {loading ? (
            <View style={styles.sectionLoader}>
              <ActivityIndicator color={Colors.emerald} />
            </View>
          ) : stories.length === 0 ? (
            <View style={styles.sectionEmpty}>
              <Text style={styles.sectionEmptyText}>
                Aún no has publicado ningún libro.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/write')}
                style={styles.writeBtn}
                activeOpacity={0.8}
              >
                <MaterialIcons name="edit" size={15} color="#000" />
                <Text style={styles.writeBtnText}>Empezar a escribir</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.storiesRow}
            >
              {stories.map(s => (
                <StoryCard
                  key={s.id}
                  story={s}
                  onPress={() => router.push(`/story/${s.id}`)}
                />
              ))}
            </ScrollView>
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 14 },

  // ── Guest ────────────────────────────────────────────────────────────────────
  guestAvatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  guestTitle:  { fontSize: 20, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center' },
  guestText:   { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  loginBtn:    { marginTop: 4, paddingHorizontal: 32, paddingVertical: 13, borderRadius: 24, backgroundColor: Colors.emerald },
  loginBtnText:{ fontSize: 14, fontWeight: '700', color: '#000', letterSpacing: 0.5 },

  // ── Hero ─────────────────────────────────────────────────────────────────────
  hero: {
    backgroundColor: Colors.surface,
    paddingBottom: 28,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    alignItems: 'center',
  },
  // Web: la ficha se ve como una tarjeta dentro de la página
  heroWeb: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
  },
  heroTopBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  settingsBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // Avatar
  avatarWrap: {
    marginTop: 4, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: Colors.emerald },
  avatarFallback: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.emerald + '22',
    borderWidth: 2, borderColor: Colors.emerald,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 34, fontWeight: '700', color: Colors.emerald },

  // Texto
  displayName: { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.2, textAlign: 'center' },
  emailText:   { fontSize: 13, color: Colors.textMuted, marginTop: 3, textAlign: 'center' },
  bio:         { fontSize: 14, color: Colors.textSecondary, fontStyle: 'italic', textAlign: 'center',
                 lineHeight: 21, marginTop: 10, paddingHorizontal: 32 },
  bioEmpty:    { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic', marginTop: 10, textDecorationLine: 'underline' },

  // Stats
  statRow: { flexDirection: 'row', marginTop: 18, gap: 24 },
  statLink: { color: Colors.emerald },
  stat:    { alignItems: 'center', gap: 2 },
  statNum: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  statLabel:{ fontSize: 11, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },

  // ── Sección libros ────────────────────────────────────────────────────────────
  section:       { marginTop: 28 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 14 },
  sectionAccent: { width: 3, height: 18, borderRadius: 2 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.3 },
  sectionLoader: { height: 180, alignItems: 'center', justifyContent: 'center' },
  sectionEmpty:  { paddingHorizontal: 20, gap: 12, alignItems: 'flex-start' },
  sectionEmptyText: { fontSize: 14, color: Colors.textMuted, fontStyle: 'italic' },
  writeBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6,
                   backgroundColor: Colors.emerald, borderRadius: 6,
                   paddingHorizontal: 14, paddingVertical: 9 },
  writeBtnText:  { fontSize: 13, fontWeight: '700', color: '#000' },

  storiesRow: { paddingHorizontal: 20, gap: 12 },

  // ── Tarjetas de libros ────────────────────────────────────────────────────────
  storyCard: {
    width: 128, height: 220,
    borderRadius: 6, overflow: 'hidden',
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    justifyContent: 'flex-end',
  },
  storyCardH: {
    width: 192, height: 220,   // horizontal: más ancha, misma altura total
  },
  storyCardPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fmtBadge:     { position: 'absolute', top: 6, left: 6, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  fmtBadgeText: { fontSize: 8, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
  storyCardInfo:  { padding: 10, gap: 4, backgroundColor: Colors.surface + 'EE' },
  storyCardTitle: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary, lineHeight: 17 },
  storyCardStatus:{ fontSize: 10, color: Colors.textMuted },
  hTitleWrap: { position: 'absolute', bottom: 0, left: 0, right: 0,
                backgroundColor: 'rgba(0,0,0,0.62)', paddingHorizontal: 8, paddingVertical: 6 },
  hTitle:     { fontSize: 11, fontWeight: '700', color: '#fff', lineHeight: 15 },
});
