import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { RoleBadge } from '@/components/role-badge';
import { type PublicProfile, getPublicProfile } from '@/services/profiles';
import { getFollowerCount, isFollowing, setFollow } from '@/services/social';
import { useAuth } from '@/context/AuthContext';
import { AppAlert } from '@/components/app-dialog';
import { blockUser, isSuspended, setSuspended, unblockUser } from '@/services/moderation';
import { ts, useT, statusLabel } from '@/i18n';

interface StoryCard {
  id: string;
  title: string;
  format: string;
  status: string;
  coverUrl?: string;
}

const STATUS_LABELS: Record<string, string> = {
  ongoing: 'En curso', completed: 'Completada',
  hiatus: 'En pausa', upcoming: 'Próximamente',
};

// Perfil público de un usuario: lo que ven los demás (nombre, avatar, bio, rol)
// y sus historias publicadas.
export default function PublicProfileScreen() {
  useT();
  const router = useRouter();
  const { uid } = useLocalSearchParams<{ uid: string }>();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  // Seguir al autor
  const { user, publicName, blocked, can } = useAuth();
  const isMe = !!user && user.uid === uid;
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    if (!uid) return;
    getFollowerCount(uid).then(setFollowers).catch(e => console.error('Error cargando seguidores:', e));
    if (user && user.uid !== uid) {
      isFollowing(user.uid, uid).then(setFollowing).catch(e => console.error('Error cargando seguimiento:', e));
    }
  }, [uid, user]);

  // ── Bloquear (cualquier usuario) ──────────────────────────────────────────
  const isBlocked = !!uid && blocked.has(uid);
  const toggleBlock = () => {
    if (!user || !uid || isMe) return;
    if (isBlocked) {
      unblockUser(user.uid, uid).catch(e => AppAlert.alert(ts('Error'), e?.message ?? ts('No se pudo desbloquear.')));
      return;
    }
    AppAlert.alert(
      ts('Bloquear usuario'),
      ts('Dejarás de ver las historias y los comentarios de {name}. No se le avisa, y puedes desbloquearlo cuando quieras.', { name: profile?.displayName ?? ts('este usuario') }),
      [
        { text: ts('Cancelar'), style: 'cancel' },
        {
          text: ts('Bloquear'), style: 'destructive',
          onPress: () => blockUser(user.uid, { uid, name: profile?.displayName ?? ts('Usuario') })
            .catch(e => AppAlert.alert(ts('Error'), e?.message ?? ts('No se pudo bloquear.'))),
        },
      ],
    );
  };

  // ── Suspender (moderación) ────────────────────────────────────────────────
  const canModerate = can('deleteStories') && !isMe && !profile?.role;
  const [targetSuspended, setTargetSuspended] = useState(false);
  useEffect(() => {
    if (!uid || !can('deleteStories') || isMe) return;
    isSuspended(uid).then(setTargetSuspended).catch(() => {});
  }, [uid, isMe]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSuspended = () => {
    if (!uid || !canModerate) return;
    const next = !targetSuspended;
    AppAlert.alert(
      next ? ts('Suspender cuenta') : ts('Quitar suspensión'),
      next
        ? ts('Esta persona podrá seguir leyendo, pero no publicar ni editar historias, ni comentar. Se le avisará.')
        : ts('Esta persona podrá volver a publicar y comentar. Se le avisará.'),
      [
        { text: ts('Cancelar'), style: 'cancel' },
        {
          text: next ? ts('Suspender') : ts('Quitar suspensión'), style: next ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await setSuspended(uid, next);
              setTargetSuspended(next);
            } catch (e: any) { AppAlert.alert(ts('Error'), e?.message ?? ts('No se pudo cambiar la suspensión.')); }
          },
        },
      ],
    );
  };

  const toggleFollow = async () => {
    if (!user || !uid || isMe || followBusy) return;
    const next = !following;
    setFollowBusy(true);
    setFollowing(next);
    setFollowers(n => Math.max(0, n + (next ? 1 : -1)));
    try {
      await setFollow({ uid: user.uid, name: publicName || ts('Alguien') }, uid, next);
    } catch (e: any) {
      setFollowing(!next);
      setFollowers(n => Math.max(0, n + (next ? -1 : 1)));
      AppAlert.alert(ts('Error'), e?.message ?? ts('No se pudo actualizar el seguimiento.'));
    } finally {
      setFollowBusy(false);
    }
  };

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, storiesSnap] = await Promise.all([
          getPublicProfile(uid),
          getDocs(query(
            collection(db, 'stories'),
            where('uid', '==', uid),
            where('published', '==', true),
          )),
        ]);
        if (cancelled) return;
        setProfile(p);
        setStories(storiesSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<StoryCard, 'id'>) })));
      } catch (e) {
        console.error('Error cargando perfil público:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const name = profile?.displayName ?? ts('Usuario');
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <SafeAreaView edges={['top']} style={styles.topBar}>
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </SafeAreaView>

          {loading ? (
            <ActivityIndicator color={Colors.emerald} style={{ marginVertical: 40 }} />
          ) : (
            <>
              {profile?.avatarUrl
                ? <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} contentFit="cover" transition={150} />
                : <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{initial}</Text>
                  </View>
              }
              <Text style={styles.name}>{name}</Text>
              <RoleBadge role={profile?.role ?? null} />
              {profile?.email ? <Text style={styles.email}>{profile.email}</Text> : null}
              {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
              <View style={styles.statRow}>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{stories.length}</Text>
                  <Text style={styles.statLabel}>{stories.length === 1 ? ts('Historia') : ts('Historias')}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{followers}</Text>
                  <Text style={styles.statLabel}>{followers === 1 ? ts('Seguidor') : ts('Seguidores')}</Text>
                </View>
              </View>
              {user && !isMe && (
                <TouchableOpacity
                  style={[styles.followBtn, following && styles.followBtnOn]}
                  onPress={toggleFollow}
                  disabled={followBusy}
                  activeOpacity={0.85}
                >
                  <MaterialIcons
                    name={following ? 'check' : 'person-add'}
                    size={16}
                    color={following ? Colors.emerald : '#000'}
                  />
                  <Text style={[styles.followBtnText, following && { color: Colors.emerald }]}>
                    {following ? ts('Siguiendo') : ts('Seguir')}
                  </Text>
                </TouchableOpacity>
              )}
              {/* Bloquear / suspender */}
              {user && !isMe && (
                <View style={styles.modRow}>
                  <TouchableOpacity onPress={toggleBlock} hitSlop={8} activeOpacity={0.7}>
                    <Text style={styles.modLink}>{isBlocked ? ts('Desbloquear') : ts('Bloquear')}</Text>
                  </TouchableOpacity>
                  {canModerate && (
                    <TouchableOpacity onPress={toggleSuspended} hitSlop={8} activeOpacity={0.7}>
                      <Text style={[styles.modLink, { color: '#FF6B6B' }]}>
                        {targetSuspended ? ts('Quitar suspensión') : ts('Suspender cuenta')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {targetSuspended && canModerate && (
                <Text style={styles.suspendedNote}>{ts('Cuenta suspendida')}</Text>
              )}
            </>
          )}
        </View>

        {!loading && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{ts('Historias publicadas')}</Text>
            {stories.length === 0 ? (
              <Text style={styles.empty}>{ts('Todavía no ha publicado ninguna historia.')}</Text>
            ) : (
              <View style={styles.grid}>
                {stories.map(s => {
                  const fmtColor = Colors.formatColors[s.format as keyof typeof Colors.formatColors] ?? Colors.emerald;
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.card}
                      activeOpacity={0.8}
                      onPress={() => router.push(`/story/${s.id}`)}
                    >
                      <View style={styles.cardCover}>
                        {s.coverUrl
                          ? <Image source={{ uri: s.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                          : <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
                              <MaterialIcons name="menu-book" size={26} color={fmtColor + '60'} />
                            </View>
                        }
                      </View>
                      <Text style={styles.cardTitle} numberOfLines={2}>{s.title}</Text>
                      <Text style={styles.cardStatus}>{statusLabel(s.status)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  hero: {
    backgroundColor: Colors.surface, paddingBottom: 24, alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  topBar:  { alignSelf: 'stretch', flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  avatar:  { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.card, marginBottom: 12 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  avatarInitial:  { fontSize: 34, fontWeight: '700', color: Colors.textSecondary },
  name:  { fontSize: 22, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.2, textAlign: 'center' },
  email: { fontSize: 13, color: Colors.textMuted, marginTop: 6 },
  bio: {
    fontSize: 14, color: Colors.textSecondary, fontStyle: 'italic', textAlign: 'center',
    lineHeight: 21, marginTop: 10, paddingHorizontal: 32,
  },
  statRow:   { flexDirection: 'row', gap: 36, marginTop: 18 },
  stat:      { alignItems: 'center', gap: 2 },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16,
    paddingHorizontal: 22, paddingVertical: 9, borderRadius: 20,
    backgroundColor: Colors.emerald, borderWidth: 1, borderColor: Colors.emerald,
  },
  followBtnOn:   { backgroundColor: 'transparent' },
  followBtnText: { fontSize: 14, fontWeight: '700', color: '#000' },
  modRow:        { flexDirection: 'row', gap: 22, marginTop: 14 },
  modLink:       { fontSize: 12, color: Colors.textMuted, textDecorationLine: 'underline' },
  suspendedNote: { fontSize: 12, fontWeight: '700', color: '#FF6B6B', marginTop: 8 },
  statNum:   { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontSize: 11, color: Colors.textMuted },
  section:      { padding: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 12 },
  empty:        { fontSize: 13, color: Colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '30.5%' },
  cardCover: {
    aspectRatio: 2 / 3, borderRadius: 6, overflow: 'hidden', backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardTitle:  { fontSize: 12, fontWeight: '600', color: Colors.textPrimary, marginTop: 6, lineHeight: 16 },
  cardStatus: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },
});
