import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, StatusBar, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { RoleBadge } from '@/components/role-badge';
import type { PublicProfile } from '@/services/profiles';
import { type LikedStory, listFollowing, listLikedStories } from '@/services/social';
import { type BlockedUser, listBlocked, unblockUser } from '@/services/moderation';
import { DesktopColumn } from '@/components/desktop-column';
import { useT } from '@/i18n';

type Tab = 'following' | 'liked' | 'blocked';

// Listas del propio usuario: autores que sigue e historias que le gustan.
export default function ProfileListsScreen() {
  const t = useT();
  const router = useRouter();
  const { user } = useAuth();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();

  const [tab, setTab] = useState<Tab>(
    tabParam === 'liked' ? 'liked' : tabParam === 'blocked' ? 'blocked' : 'following');
  const [following, setFollowing] = useState<PublicProfile[]>([]);
  const [liked, setLiked]         = useState<LikedStory[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading]     = useState(true);

  // Se recarga al volver (p. ej. tras dejar de seguir a alguien desde su perfil)
  useFocusEffect(useCallback(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const [f, l, b] = await Promise.all([
          listFollowing(user.uid), listLikedStories(user.uid), listBlocked(user.uid),
        ]);
        if (cancelled) return;
        setFollowing(f);
        setLiked(l);
        setBlockedUsers(b);
      } catch (e) {
        console.error('Error cargando listas:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]));

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'following', label: t('lists.following'), count: following.length },
    { key: 'liked',     label: t('lists.liked'), count: liked.length },
    { key: 'blocked',   label: t('lists.blocked'), count: blockedUsers.length },
  ];

  const handleUnblock = async (b: BlockedUser) => {
    if (!user) return;
    try {
      await unblockUser(user.uid, b.uid);
      setBlockedUsers(prev => prev.filter(x => x.uid !== b.uid));
    } catch (e) {
      console.error('Error desbloqueando:', e);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.tabs}>
          {tabs.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
                {t.label}{loading ? '' : ` · ${t.count}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.backBtn} />
      </SafeAreaView>
      <DesktopColumn>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={Colors.emerald} /></View>
      ) : tab === 'following' ? (
        <FlatList
          data={following}
          keyExtractor={p => p.uid}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('lists.followingEmpty')}</Text>
          }
          renderItem={({ item: p }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: '/user/[uid]', params: { uid: p.uid } })}
            >
              {p.avatarUrl
                ? <Image source={{ uri: p.avatarUrl }} style={styles.avatar} contentFit="cover" transition={150} />
                : <View style={[styles.avatar, styles.avatarFallback]}>
                    <Text style={styles.avatarInitial}>{p.displayName.trim().charAt(0).toUpperCase() || '?'}</Text>
                  </View>
              }
              <View style={styles.rowInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.displayName}</Text>
                  <RoleBadge role={p.role} size="sm" />
                </View>
                {p.bio ? <Text style={styles.rowSub} numberOfLines={1}>{p.bio}</Text> : null}
              </View>
              <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      ) : tab === 'blocked' ? (
        <FlatList
          data={blockedUsers}
          keyExtractor={b => b.uid}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('lists.blockedEmpty')}</Text>
          }
          renderItem={({ item: b }) => (
            <View style={styles.row}>
              <View style={[styles.avatar, styles.avatarFallback]}>
                <MaterialIcons name="block" size={18} color={Colors.textMuted} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle} numberOfLines={1}>{b.name}</Text>
              </View>
              <TouchableOpacity style={styles.unblockBtn} onPress={() => handleUnblock(b)} activeOpacity={0.8}>
                <Text style={styles.unblockText}>{t('lists.unblock')}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      ) : (
        <FlatList
          data={liked}
          keyExtractor={s => s.storyId}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('lists.likedEmpty')}</Text>
          }
          renderItem={({ item: s }) => {
            const fmtColor = Colors.formatColors[s.format as keyof typeof Colors.formatColors] ?? Colors.emerald;
            return (
              <TouchableOpacity style={styles.row} activeOpacity={0.8} onPress={() => router.push(`/story/${s.storyId}`)}>
                <View style={styles.cover}>
                  {s.coverUrl
                    ? <Image source={{ uri: s.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                    : <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
                        <MaterialIcons name="menu-book" size={18} color={fmtColor + '60'} />
                      </View>
                  }
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{s.title}</Text>
                  {s.format ? (
                    <View style={[styles.fmtBadge, { backgroundColor: fmtColor + 'CC' }]}>
                      <Text style={styles.fmtBadgeText}>{s.format}</Text>
                    </View>
                  ) : null}
                </View>
                <MaterialIcons name="favorite" size={16} color="#FF69B4" />
              </TouchableOpacity>
            );
          }}
        />
      )}
      </DesktopColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  tabs:    { flexDirection: 'row', gap: 4 },
  tab: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  tabActive:     { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  tabText:       { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: '#000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:     { paddingHorizontal: 16, paddingBottom: 32, flexGrow: 1 },
  empty:    { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24, lineHeight: 19 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '60',
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  avatarInitial:  { fontSize: 17, fontWeight: '700', color: Colors.textSecondary },
  cover: {
    width: 44, height: 66, borderRadius: 4, overflow: 'hidden', backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowInfo:  { flex: 1, gap: 4 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  rowSub:   { fontSize: 12, color: Colors.textSecondary },
  fmtBadge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  fmtBadgeText: { fontSize: 9, fontWeight: '700', color: '#000', letterSpacing: 0.4 },
  unblockBtn:  { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6, borderWidth: 1, borderColor: Colors.border },
  unblockText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
});
