import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import { deleteStoryWithCascade } from '@/services/stories';
import { useIsDesktop } from '@/hooks/use-is-desktop';

const FORMATS = [
  {
    key: 'Moderno',
    label: 'Moderno',
    description: 'Estilo novela visual con imágenes de fondo y música.',
    color: Colors.formatColors.Moderno,
  },
  {
    key: 'Webnovel',
    label: 'Webnovel',
    description: 'Formato de scroll continuo, lectura rápida y cómoda.',
    color: Colors.formatColors.Webnovel,
  },
];

const STATUS_LABELS: Record<string, string> = {
  ongoing:   'En curso',
  completed: 'Completada',
  hiatus:    'En pausa',
  upcoming:  'Próximamente',
};

interface Story {
  id: string;
  title: string;
  format: string;
  status: string;
  published?: boolean;
}

export default function WriteScreen() {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const { user, suspended } = useAuth();

  // Una cuenta suspendida no puede crear historias (las reglas también lo impiden)
  const startStory = (format: string) => {
    if (suspended) {
      AppAlert.alert('Cuenta suspendida', 'Tu cuenta está suspendida: no puedes publicar ni editar historias.');
      return;
    }
    router.push(`/create/moderno-details?format=${format}`);
  };

  const [stories, setStories]               = useState<Story[]>([]);
  const [loadingStories, setLoadingStories] = useState(true);
  const [activeTab, setActiveTab]           = useState<'books' | 'new'>('books');
  // Web: el menú de la barra superior abre directamente "Mis libros" o "Nuevo libro"
  const { tab: tabParam, t: tabNonce } = useLocalSearchParams<{ tab?: string; t?: string }>();
  useEffect(() => {
    if (tabParam === 'books' || tabParam === 'new') setActiveTab(tabParam);
  }, [tabParam, tabNonce]);

  const anims = useRef(
    FORMATS.map(() => ({
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(25),
    }))
  ).current;

  const titleAnim = useRef({
    opacity: new Animated.Value(0),
    translateY: new Animated.Value(20),
  }).current;

  const runEntryAnims = () => {
    anims.forEach(a => { a.opacity.setValue(0); a.translateY.setValue(25); });
    titleAnim.opacity.setValue(0);
    titleAnim.translateY.setValue(20);
    Animated.parallel([
      Animated.timing(titleAnim.opacity,    { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.timing(titleAnim.translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      ...anims.flatMap((a, i) => [
        Animated.timing(a.opacity,    { toValue: 1, duration: 200, delay: 60 + i * 70, useNativeDriver: true }),
        Animated.timing(a.translateY, { toValue: 0, duration: 200, delay: 60 + i * 70, useNativeDriver: true }),
      ]),
    ]).start();
  };

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'stories'), where('uid', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Story, 'id'>) }));
      setStories(data);
      setLoadingStories(false);
    }, () => setLoadingStories(false));
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!loadingStories && (stories.length === 0 || activeTab === 'new')) {
      runEntryAnims();
    }
  }, [loadingStories, activeTab, stories.length]);

  const handleDeleteStory = (story: Story) => {
    AppAlert.alert(
      'Borrar libro',
      `¿Seguro que quieres borrar "${story.title}"? Se borrarán también todos sus capítulos y páginas.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteStoryWithCascade(story.id);
            } catch (e) {
              console.error('Error borrando historia:', e);
            }
          },
        },
      ]
    );
  };

  // En escritorio la cabecera es la barra superior común (WebTopBar)
  const Header = () => isDesktop ? null : (
    <SafeAreaView edges={['top']} style={styles.headerWrap}>
      <View style={styles.headerBar}>
        <TouchableOpacity onPress={() => router.navigate('/(tabs)')} activeOpacity={0.7}>
          <Image
            source={require('@/assets/images/logo.png')}
            style={styles.logo}
            contentFit="contain"
          />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (loadingStories) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />
        <Header />
        <View style={styles.centered}><ActivityIndicator color={Colors.emerald} /></View>
      </View>
    );
  }

  if (stories.length === 0) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />
        <Header />
        <Animated.View style={[styles.newHeader, { opacity: titleAnim.opacity, transform: [{ translateY: titleAnim.translateY }] }]}>
          <Text style={styles.sectionTitle}>Nueva historia</Text>
          <Text style={styles.sectionSubtitle}>Elige el formato</Text>
        </Animated.View>
        <View style={styles.formatList}>
          {FORMATS.map((f, i) => (
            <Animated.View key={f.key} style={{ opacity: anims[i].opacity, transform: [{ translateY: anims[i].translateY }] }}>
              <TouchableOpacity
                style={styles.formatCard}
                activeOpacity={0.75}
                onPress={() => startStory(f.key)}
              >
                <View style={[styles.cardTopBevel, { backgroundColor: f.color }]} />
                <View style={styles.formatInfo}>
                  <Text style={[styles.formatLabel, { color: f.color }]}>{f.label}</Text>
                  <Text style={styles.formatDesc}>{f.description}</Text>
                </View>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.emerald} />
      <Header />

      <View style={styles.tabRow}>
        <TouchableOpacity style={styles.tabBtn} activeOpacity={0.7} onPress={() => setActiveTab('books')}>
          <Text style={[styles.tabText, activeTab === 'books' && styles.tabTextActive]}>Mis libros</Text>
          {activeTab === 'books' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabBtn} activeOpacity={0.7} onPress={() => setActiveTab('new')}>
          <Text style={[styles.tabText, activeTab === 'new' && styles.tabTextActive]}>Nuevo Libro</Text>
          {activeTab === 'new' && <View style={styles.tabUnderline} />}
        </TouchableOpacity>
      </View>
      <View style={styles.tabSeparator} />

      {activeTab === 'books' ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {stories.map((story) => {
            const fmtColor = Colors.formatColors[story.format as keyof typeof Colors.formatColors] ?? Colors.emerald;
            return (
              <View key={story.id} style={styles.storyRow}>
                <TouchableOpacity
                  style={styles.storyRowInner}
                  activeOpacity={0.8}
                  onPress={() => router.push(`/create/editor-moderno?storyId=${story.id}&title=${encodeURIComponent(story.title)}&format=${story.format}`)}
                >
                  <View style={[styles.storyAccent, { backgroundColor: fmtColor }]} />
                  <View style={styles.storyInfo}>
                    <Text style={styles.storyTitle} numberOfLines={1}>{story.title}</Text>
                    <View style={styles.storyMeta}>
                      <Text style={[styles.storyFormat, { color: fmtColor }]}>{story.format}</Text>
                      <Text style={styles.storyDot}>·</Text>
                      <Text style={styles.storyStatus}>
                        {story.published ? 'Publicada' : (STATUS_LABELS[story.status] ?? story.status)}
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} activeOpacity={0.7} onPress={() => handleDeleteStory(story)}>
                  <MaterialIcons name="delete-outline" size={18} color="#FF6B6B" />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.newHeader, { opacity: titleAnim.opacity, transform: [{ translateY: titleAnim.translateY }] }]}>
            <Text style={styles.sectionTitle}>Nueva historia</Text>
            <Text style={styles.sectionSubtitle}>Elige el formato</Text>
          </Animated.View>
          <View style={styles.formatList}>
            {FORMATS.map((f, i) => (
              <Animated.View key={f.key} style={{ opacity: anims[i].opacity, transform: [{ translateY: anims[i].translateY }] }}>
                <TouchableOpacity
                  style={styles.formatCard}
                  activeOpacity={0.75}
                  onPress={() => startStory(f.key)}
                >
                  <View style={[styles.cardTopBevel, { backgroundColor: f.color }]} />
                  <View style={styles.formatInfo}>
                    <Text style={[styles.formatLabel, { color: f.color }]}>{f.label}</Text>
                    <Text style={styles.formatDesc}>{f.description}</Text>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.bg },
  centered:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerWrap: {
    backgroundColor: Colors.emerald,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 10,
  },
  headerBar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  logo:           { height: 40, width: 40, borderRadius: 6 },
  tabRow:         { flexDirection: 'row', justifyContent: 'center', paddingTop: 22, gap: 40 },
  tabBtn:         { paddingBottom: 12, alignItems: 'center' },
  tabText:        { fontSize: 17, fontWeight: '500', color: Colors.textMuted, letterSpacing: 0.2 },
  tabTextActive:  { color: Colors.textPrimary, fontWeight: '700' },
  tabUnderline:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: Colors.emerald, borderRadius: 1 },
  tabSeparator:   { height: 1, backgroundColor: Colors.border },
  scroll:         { flex: 1 },
  scrollContent:  { paddingTop: 8, paddingBottom: 24 },
  storyRow:       { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: Colors.border },
  storyRowInner:  { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
  storyAccent:    { width: 3, alignSelf: 'stretch', marginRight: 16, borderRadius: 2 },
  storyInfo:      { flex: 1, gap: 4 },
  storyTitle:     { fontSize: 15, fontWeight: '600', color: Colors.textPrimary, letterSpacing: 0.2 },
  storyMeta:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  storyFormat:    { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  storyDot:       { fontSize: 12, color: Colors.textMuted },
  storyStatus:    { fontSize: 12, color: Colors.textSecondary },
  deleteBtn:      { paddingHorizontal: 16, paddingVertical: 16 },
  newHeader:      { paddingHorizontal: 22, paddingTop: 28, paddingBottom: 24 },
  sectionTitle:   { fontSize: 24, fontWeight: '300', color: Colors.textPrimary, letterSpacing: 0.5, marginBottom: 4 },
  sectionSubtitle:{ fontSize: 13, color: Colors.textSecondary, letterSpacing: 0.3 },
  formatList:     { paddingHorizontal: 20, gap: 14 },
  formatCard: {
    backgroundColor: Colors.card,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 22,
    paddingVertical: 26,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  cardTopBevel:   { position: 'absolute', top: 0, left: 0, right: 0, height: 10 },
  formatInfo:     { gap: 6 },
  formatLabel:    { fontSize: 17, fontWeight: '700', letterSpacing: 0.3 },
  formatDesc:     { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
});
