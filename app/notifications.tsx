import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { AppHeader } from '@/components/app-header';
import {
  type AppNotification, type NotificationType,
  deleteNotification, markAllNotificationsRead, markNotificationRead,
} from '@/services/notifications';

const TYPE_ICON: Record<NotificationType, { icon: string; color: string }> = {
  story_deleted: { icon: 'delete-outline',   color: '#FF6B6B' },
  chapter:       { icon: 'auto-stories',     color: Colors.emerald },
  new_story:     { icon: 'menu-book',        color: '#7B68EE' },
  follow:        { icon: 'person-add',       color: '#4A90D9' },
  like:          { icon: 'favorite',         color: '#FF69B4' },
  comment:       { icon: 'chat-bubble',      color: '#4A90D9' },
  news:          { icon: 'campaign',         color: Colors.emerald },
  admin:         { icon: 'admin-panel-settings', color: '#FFD700' },
};

// "hace 5 min", "hace 3 h", "hace 2 d" o la fecha
function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems]     = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    return onSnapshot(
      query(collection(db, 'users', user.uid, 'notifications'), orderBy('createdAt', 'desc'), limit(50)),
      snap => {
        setItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<AppNotification, 'id'>) })));
        setLoading(false);
      },
      e => { console.error('Error cargando notificaciones:', e); setLoading(false); },
    );
  }, [user]);

  const handlePress = (n: AppNotification) => {
    if (!user) return;
    if (!n.read) markNotificationRead(user.uid, n.id).catch(() => {});
    // Lo que tiene que ver con una historia lleva a ella (una borrada ya no existe);
    // un seguidor nuevo, a su perfil
    if (n.storyId && ['like', 'comment', 'chapter', 'new_story'].includes(n.type)) {
      router.push(`/story/${n.storyId}`);
    } else if (n.type === 'follow' && n.fromUid) {
      router.push({ pathname: '/user/[uid]', params: { uid: n.fromUid } });
    }
  };

  const hasUnread = items.some(n => !n.read);

  return (
    <View style={styles.container}>
      <AppHeader onBack={() => router.back()} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notificaciones</Text>
        <TouchableOpacity
          style={[styles.readAllBtn, !hasUnread && { opacity: 0.35 }]}
          disabled={!hasUnread || !user}
          onPress={() => user && markAllNotificationsRead(user.uid).catch(() => {})}
          activeOpacity={0.7}
        >
          <MaterialIcons name="done-all" size={20} color={Colors.emerald} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={Colors.emerald} /></View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="notifications-none" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyText}>No tienes notificaciones</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={n => n.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: n }) => {
            const t = TYPE_ICON[n.type] ?? TYPE_ICON.news;
            return (
              <TouchableOpacity
                style={[styles.item, !n.read && styles.itemUnread]}
                onPress={() => handlePress(n)}
                activeOpacity={0.8}
              >
                <View style={[styles.iconWrap, { backgroundColor: t.color + '22' }]}>
                  <MaterialIcons name={t.icon as any} size={20} color={t.color} />
                </View>
                <View style={styles.itemText}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{n.title}</Text>
                  <Text style={styles.itemBody}>{n.body}</Text>
                  <Text style={styles.itemTime}>{timeAgo(n.createdAt)}</Text>
                </View>
                {!n.read && <View style={styles.unreadDot} />}
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => user && deleteNotification(user.uid, n.id).catch(() => {})}
                  hitSlop={8}
                >
                  <MaterialIcons name="close" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn:     { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  readAllBtn:  { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText:   { color: Colors.textMuted, fontSize: 14 },
  list:        { paddingVertical: 8 },
  item: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '60',
  },
  itemUnread: { backgroundColor: Colors.emerald + '0D' },
  iconWrap:   { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  itemText:   { flex: 1, gap: 3 },
  itemTitle:  { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  itemBody:   { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  itemTime:   { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  unreadDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.emerald, marginTop: 6 },
  deleteBtn:  { paddingTop: 2 },
});
