import React, { useEffect, useState } from 'react';
import { type Href } from 'expo-router';
import { startTutorial } from '@/components/tutorial';
import { markTutorialNoticeSeen, useTutorialNotice } from '@/services/tutorial-notice';
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
import { t, useT, ts } from '@/i18n';

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
  if (mins < 1)  return t('notif.now');
  if (mins < 60) return t('notif.mins', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('notif.hours', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('notif.days', { n: days });
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  useT(); // la pantalla se repinta al cambiar de idioma
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

  // ── Aviso fijo del tutorial ───────────────────────────────────────────────
  // Va siempre arriba y no se puede borrar. Al tocarlo se despliega con las dos opciones.
  const tutorialNotice = useTutorialNotice();
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const openTutorialNotice = () => {
    if (user) markTutorialNoticeSeen(user.uid);
    setTutorialOpen(v => !v);
  };
  const beginTutorial = () => {
    setTutorialOpen(false);
    // Se vuelve al inicio que ya está abierto debajo, en vez de abrir otro encima
    if (router.canDismiss()) router.dismissAll();
    router.navigate('/(tabs)' as Href);
    startTutorial();
  };
  const tutorialCard = tutorialNotice.visible && (
    <View style={[styles.tutorialCard, tutorialNotice.unread && styles.itemUnread]}>
      <TouchableOpacity style={styles.tutorialHead} onPress={openTutorialNotice} activeOpacity={0.8}>
        <View style={[styles.iconWrap, { backgroundColor: Colors.emerald + '22' }]}>
          <MaterialIcons name="school" size={20} color={Colors.emerald} />
        </View>
        <View style={styles.itemText}>
          <Text style={styles.itemTitle} numberOfLines={1}>{t('notif.tutorialTitle')}</Text>
          <Text style={styles.itemBody}>{t('notif.tutorialBody')}</Text>
        </View>
        {tutorialNotice.unread && <View style={styles.unreadDot} />}
        <MaterialIcons name={tutorialOpen ? 'expand-less' : 'expand-more'} size={20} color={Colors.textMuted} />
      </TouchableOpacity>
      {tutorialOpen && (
        <View style={styles.tutorialBody}>
          <Text style={styles.itemBody}>
            {t('notif.tutorialLong')}
          </Text>
          <View style={styles.tutorialActions}>
            <TouchableOpacity style={styles.tutorialSkip} onPress={() => setTutorialOpen(false)} activeOpacity={0.75}>
              <Text style={styles.tutorialSkipText}>{t('notif.tutorialSkip')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tutorialStart} onPress={beginTutorial} activeOpacity={0.85}>
              <Text style={styles.tutorialStartText}>{t('notif.tutorialStart')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <AppHeader onBack={() => router.back()} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('notif.title')}</Text>
        <TouchableOpacity
          style={[styles.readAllBtn, !hasUnread && { opacity: 0.35 }]}
          disabled={!hasUnread || !user}
          onPress={() => user && markAllNotificationsRead(user.uid).catch(() => {})}
          activeOpacity={0.7}
        >
          <MaterialIcons name="done-all" size={20} color={Colors.emerald} />
        </TouchableOpacity>
      </View>

      {tutorialCard}

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={Colors.emerald} /></View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="notifications-none" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyText}>{t('notif.empty')}</Text>
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
                  <Text style={styles.itemTitle} numberOfLines={1}>{n.tx?.title ? ts(n.tx.title, n.tx.p) : ts(n.title)}</Text>
                  <Text style={styles.itemBody}>{n.tx?.body ? ts(n.tx.body, n.tx.p) : n.body}</Text>
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
  tutorialCard: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  tutorialHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  tutorialBody: { paddingLeft: 66, paddingRight: 16, paddingBottom: 16, gap: 14 },
  tutorialActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tutorialSkip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  tutorialSkipText: { fontSize: 13, color: Colors.textSecondary },
  tutorialStart: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 8, backgroundColor: Colors.emerald },
  tutorialStartText: { fontSize: 13, fontWeight: '700', color: '#000' },
});
