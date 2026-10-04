import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { doc, getDoc, collection, getDocs, query, orderBy, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { AppAlert, AppDialogHost } from '@/components/app-dialog';
import { adultContentLabel, audienceLabel } from '@/constants/story-meta';
import { hasLiked, setLike, setSaved } from '@/services/social';
import { AdultGate } from '@/components/adult-gate';
import { ReportModal } from '@/components/report-modal';
import type { ReportTarget } from '@/services/reports';
import { formatReadingStats, sortChapters } from '@/services/stories';
import { adminDeleteStory } from '@/services/admin';
import { type PublicProfile, getPublicProfile, getStaffRoles } from '@/services/profiles';
import type { Role } from '@/constants/permissions';
import { RoleBadge } from '@/components/role-badge';
import { WEBNOVEL_THEMES, WEBNOVEL_THEME_DEFAULT, type WebnovelTheme, getWebnovelTheme } from '@/constants/webnovel';
import { type StoryComment, deleteComment, listStoryComments } from '@/services/comments';
import { CommentItem } from '@/components/comment-item';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { promptLogin } from '@/components/login-prompt';

interface Story {
  id: string;
  title: string;
  subtitle?: string;
  format: string;
  status: string;
  synopsis?: string;
  coverUrl?: string;
  publishedAt?: string;
  uid?: string;
  published?: boolean;
  likeCount?: number;
  genres?: string[];
  audience?: string;
  isAdult?: boolean;
  adultContent?: string[];
}

interface Chapter {
  id: string;
  title: string;
  published: boolean;
  publishedAt?: string;
  createdAt: string;
  wordCount?: number;
  pageIds?: string[]; // ids de sus páginas en orden (lo mantiene el editor de capítulo)
}

const STATUS_LABELS: Record<string, string> = {
  ongoing:   'En curso',
  completed: 'Completada',
  hiatus:    'En pausa',
  upcoming:  'Próximamente',
};

export default function StoryDetailScreen() {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, can, publicName, isAdult, blocked } = useAuth();
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null); // denuncia en curso
  // Moderación (permiso 'deleteStories'): eliminar la historia con un motivo opcional
  const [moderating, setModerating]   = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const [removing, setRemoving]       = useState(false);
  // Autor (perfil público) y comentarios de toda la novela
  const [author, setAuthor]     = useState<PublicProfile | null>(null);
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [staffRoles, setStaffRoles] = useState<Map<string, Role>>(new Map());
  // Me gusta
  const [liked, setLiked]         = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking]       = useState(false);
  // Tema de lectura Webnovel del lector (se relee al volver, por si lo cambió en ajustes)
  const [wnTheme, setWnTheme] = useState<WebnovelTheme>(WEBNOVEL_THEME_DEFAULT);
  useFocusEffect(useCallback(() => { getWebnovelTheme().then(setWnTheme); }, []));

  const [story, setStory]             = useState<Story | null>(null);
  const [chapters, setChapters]       = useState<Chapter[]>([]);
  const [loading, setLoading]         = useState(true);
  const [isInterested, setIsInterested]   = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  // Progreso de lectura (guardado automáticamente)
  const [readingProgress, setReadingProgress] = useState<{ chapterId: string; pageIndex: number; pageId?: string } | null>(null);
  // Marcador manual del lector
  const [bookmark, setBookmark] = useState<{ chapterId: string; pageIndex: number; pageId?: string; chapterTitle?: string } | null>(null);
  // URL del lector según el formato. En Moderno se abre en una página concreta (el id
  // tiene prioridad: no cambia al reordenar); en Webnovel, el capítulo (el lector
  // recupera por sí mismo la posición del scroll).
  const readerUrl = (p: { chapterId: string; pageIndex?: number; pageId?: string }): Href =>
    (story?.format === 'Webnovel'
      ? `/reader/webnovel?storyId=${id}&chapterId=${p.chapterId}`
      : `/reader/page-moderno?storyId=${id}&chapterId=${p.chapterId}&pageIndex=${p.pageIndex ?? 0}${p.pageId ? `&pageId=${p.pageId}` : ''}`) as Href;

  // Se recarga al volver a la pantalla (p. ej. desde el lector) para que
  // "Continuar" y el marcador reflejen la última lectura.
  useFocusEffect(useCallback(() => {
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
          const authorUid = storySnap.data().uid as string | undefined;
          if (authorUid) {
            getPublicProfile(authorUid).then(setAuthor)
              .catch(e => console.error('Error cargando autor:', e));
          }
          setLikeCount(storySnap.data().likeCount ?? 0);
          if (user) {
            hasLiked(id as string, user.uid).then(setLiked)
              .catch(e => console.error('Error cargando me gusta:', e));
          }
          listStoryComments(id as string).then(setComments)
            .catch(e => console.error('Error cargando comentarios:', e));
          getStaffRoles().then(setStaffRoles)
            .catch(e => console.error('Error cargando el equipo:', e));
        }
        const allChapters = sortChapters<Chapter & { order?: number }>(
          chaptersSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as Omit<Chapter, 'id'>) }))
        );
        setChapters(allChapters.filter((c: Chapter) => c.published === true));
        if (librarySnap?.exists()) {
          const ld = librarySnap.data();
          setIsInterested(ld.isInterested === true);
          if (ld.isReading && ld.lastChapterId) {
            setReadingProgress({ chapterId: ld.lastChapterId, pageIndex: ld.lastPageIndex ?? 0, pageId: ld.lastPageId ?? undefined });
          }
          if (ld.bookmarkChapterId) {
            setBookmark({
              chapterId: ld.bookmarkChapterId, pageIndex: ld.bookmarkPageIndex ?? 0,
              pageId: ld.bookmarkPageId ?? undefined, chapterTitle: ld.bookmarkChapterTitle ?? undefined,
            });
          }
        }
      } catch (e) {
        console.error('Error cargando historia:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, user]));

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
      if (story.uid !== user.uid) setSaved(story.id, user.uid, newVal); // estadística para el autor
    } catch (e) {
      console.error('Error actualizando biblioteca:', e);
    } finally {
      setBookmarkLoading(false);
    }
  };

  const handleAdminDelete = async () => {
    if (!story || removing) return;
    setRemoving(true);
    try {
      await adminDeleteStory(story.id, removeReason);
      setModerating(false);
      router.back();
    } catch (e: any) {
      console.error('Error eliminando historia como administrador:', e);
      AppAlert.alert('Error', e?.message ?? 'No se pudo eliminar la historia.');
    } finally {
      setRemoving(false);
    }
  };

  // "Cap. X · Pág. Y" de un comentario según el orden ACTUAL de capítulos y páginas.
  // Si el capítulo aún no tiene guardado su orden de páginas (o la página se borró),
  // se usa el número que tenía al escribirse.
  const withCurrentLocation = (c: StoryComment): StoryComment => {
    const chapterIdx = chapters.findIndex(ch => ch.id === c.chapterId);
    const pageIdx = chapterIdx >= 0 ? (chapters[chapterIdx].pageIds?.indexOf(c.pageId) ?? -1) : -1;
    return {
      ...c,
      chapterNumber: chapterIdx >= 0 ? chapterIdx + 1 : c.chapterNumber,
      pageNumber: pageIdx >= 0 ? pageIdx + 1 : c.pageNumber,
    };
  };

  // Me gusta: se pinta al instante y se deshace si falla
  const toggleLike = async () => {
    if (!user) { // invitado
      promptLogin(() => router.push('/auth/login'), 'Necesitas una cuenta para dar me gusta.');
      return;
    }
    if (!story || liking) return;
    const next = !liked;
    setLiking(true);
    setLiked(next);
    setLikeCount(c => Math.max(0, c + (next ? 1 : -1)));
    try {
      await setLike(
        story.id, next,
        { uid: user.uid, name: publicName || 'Alguien' },
        { authorUid: story.uid, title: story.title, coverUrl: story.coverUrl, format: story.format },
      );
    } catch (e: any) {
      setLiked(!next);
      setLikeCount(c => Math.max(0, c + (next ? -1 : 1)));
      AppAlert.alert('Error', e?.message ?? 'No se pudo guardar tu me gusta.');
    } finally {
      setLiking(false);
    }
  };

  // Sin los comentarios de usuarios bloqueados
  const visibleComments = comments.filter(c => !blocked.has(c.uid));

  const handleDeleteComment = (c: StoryComment) => {
    AppAlert.alert('Borrar comentario', '¿Seguro que quieres borrar este comentario?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(id as string, c.id);
            setComments(prev => prev.filter(x => x.id !== c.id));
          } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo borrar el comentario.'); }
        },
      },
    ]);
  };

  // En una Webnovel, la ficha (sinopsis, capítulos, botones) usa el tema de lectura del
  // lector cuando es sepia o claro. En oscuro, y en las novelas Moderno, queda como siempre.
  const wn = story?.format === 'Webnovel' && wnTheme !== 'dark' ? WEBNOVEL_THEMES[wnTheme] : null;
  const themed = {
    container: wn ? { backgroundColor: wn.background } : null,
    text:      wn ? { color: wn.text } : null,
    muted:     wn ? { color: wn.muted } : null,
    row:       wn ? { borderBottomColor: wn.border } : null,
    footer:    wn ? { backgroundColor: wn.background, borderTopColor: wn.border } : null,
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
        <TouchableOpacity style={[styles.backBtn, { marginTop: 48, marginLeft: 16 }]} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={{ color: Colors.textMuted, textAlign: 'center', marginTop: 80 }}>Historia no encontrada</Text>
      </View>
    );
  }

  // Contenido +18: solo para mayores de edad (el autor y moderación siempre pueden verla)
  const isOwnStory = !!user && story.uid === user.uid;
  if (story.isAdult && !isOwnStory && !can('deleteStories') && isAdult !== true) {
    return <AdultGate onBack={() => router.back()} />;
  }

  return (
    <View style={[styles.container, themed.container]}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

      {/* ── Moderación: eliminar como administrador ── */}
      <Modal visible={moderating} transparent animationType="fade" onRequestClose={() => setModerating(false)}>
        <View style={styles.modOverlay}>
          <AppDialogHost />
          <View style={styles.modBox}>
            <Text style={styles.modTitle}>Eliminar historia</Text>
            <Text style={styles.modText}>
              Se borrará "{story.title}" con todos sus capítulos. Sus lectores y el autor
              recibirán un aviso de que la eliminó un administrador. No se puede deshacer.
            </Text>
            <TextInput
              style={styles.modInput}
              value={removeReason}
              onChangeText={setRemoveReason}
              placeholder="Motivo (opcional, se envía al autor)"
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
              maxLength={200}
            />
            <View style={styles.modActions}>
              <TouchableOpacity style={styles.modCancel} onPress={() => setModerating(false)} disabled={removing}>
                <Text style={styles.modCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modDelete, removing && { opacity: 0.5 }]} onPress={handleAdminDelete} disabled={removing}>
                {removing
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.modDeleteText}>Eliminar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Portada / hero ── */}
      <View style={[styles.hero, isDesktop && (story.coverUrl ? styles.heroDesktop : styles.heroDesktopNoCover)]}>
        {story.coverUrl
          ? <Image
              source={{ uri: story.coverUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={150}
              blurRadius={isDesktop ? 40 : 0}
            />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0A0A0A' }]} />
        }
        <View style={styles.heroOverlay} />

        <SafeAreaView edges={['top']} style={styles.heroHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.heroActions}>
          {/* Denunciar la historia (no la propia) */}
          {user && !isOwnStory && (
            <TouchableOpacity
              style={[styles.bookmarkBtn, { marginRight: 0 }]}
              onPress={() => setReportTarget({ type: 'story', storyId: story.id, storyTitle: story.title, targetUid: story.uid })}
              activeOpacity={0.8}
            >
              <MaterialIcons name="outlined-flag" size={20} color="#fff" />
            </TouchableOpacity>
          )}
          {can('deleteStories') && story.uid !== user?.uid && (
            <TouchableOpacity
              style={[styles.bookmarkBtn, { marginRight: 0 }]}
              onPress={() => { setRemoveReason(''); setModerating(true); }}
              activeOpacity={0.8}
            >
              <MaterialIcons name="gavel" size={20} color="#FF6B6B" />
            </TouchableOpacity>
          )}
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
          </View>
        </SafeAreaView>

        <View style={isDesktop ? styles.heroDesktopRow : undefined}>
        {/* Escritorio: la portada con su proporción, a la izquierda del título */}
        {isDesktop && story.coverUrl ? (
          <Image
            source={{ uri: story.coverUrl }}
            style={(story as any).coverOrientation === 'horizontal' ? styles.coverCardWide : styles.coverCardTall}
            contentFit="cover"
            transition={150}
          />
        ) : null}
        <View style={[styles.heroInfo, isDesktop && { flex: 1 }]}>
          <View style={[styles.formatBadge, { backgroundColor: fmtColor + 'CC' }]}>
            <Text style={styles.formatBadgeText}>{story.format}</Text>
          </View>
          <Text style={styles.heroTitle}>{story.title}</Text>
          {story.uid ? (
            <TouchableOpacity
              style={styles.authorRow}
              activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/user/[uid]', params: { uid: story.uid! } })}
            >
              <MaterialIcons name="person" size={13} color="rgba(255,255,255,0.75)" />
              <Text style={styles.authorName} numberOfLines={1}>{author?.displayName ?? 'Ver autor'}</Text>
              <RoleBadge role={author?.role} size="sm" />
            </TouchableOpacity>
          ) : null}
          {story.subtitle ? (
            <Text style={styles.heroSubtitle}>{story.subtitle}</Text>
          ) : null}
          <View style={styles.heroBottomRow}>
            <Text style={styles.heroStatus}>{STATUS_LABELS[story.status] ?? story.status ?? 'En curso'}</Text>
            {/* Me gusta (solo en historias publicadas) */}
            {story.published && (
              <TouchableOpacity
                style={[styles.likeBtn, liked && styles.likeBtnOn]}
                onPress={toggleLike}
                disabled={liking}
                activeOpacity={0.8}
              >
                <MaterialIcons name={liked ? 'favorite' : 'favorite-border'} size={16} color={liked ? '#FF69B4' : '#fff'} />
                <Text style={styles.likeCountText}>{likeCount}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Sinopsis */}
        {story.synopsis ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, themed.muted]}>Sinopsis</Text>
            <Text style={[styles.description, themed.text]}>{story.synopsis}</Text>
          </View>
        ) : null}

        {/* Clasificación: géneros, público y contenido +18 con sus motivos */}
        {(story.genres?.length || story.audience || story.isAdult) ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, themed.muted]}>Detalles</Text>

            {story.genres && story.genres.length > 0 && (
              <View style={styles.chipRow}>
                {story.genres.map(g => (
                  <View key={g} style={[styles.chip, { borderColor: fmtColor + '70', backgroundColor: fmtColor + '18' }]}>
                    <Text style={[styles.chipText, { color: fmtColor }]}>{g}</Text>
                  </View>
                ))}
              </View>
            )}

            {audienceLabel(story.audience) && (
              <View style={styles.metaRow}>
                <MaterialIcons name="groups" size={15} color={wn ? wn.muted : Colors.textMuted} />
                <Text style={[styles.metaText, themed.text]}>Público: {audienceLabel(story.audience)}</Text>
              </View>
            )}

            {story.isAdult && (
              <View style={styles.adultBlock}>
                <View style={styles.metaRow}>
                  <View style={styles.adultBadge}>
                    <Text style={styles.adultBadgeText}>+18</Text>
                  </View>
                  <Text style={[styles.metaText, themed.text]}>Contenido para adultos</Text>
                </View>
                {story.adultContent && story.adultContent.length > 0 && (
                  <View style={styles.chipRow}>
                    {story.adultContent.map(k => (
                      <View key={k} style={[styles.chip, styles.adultChip]}>
                        <Text style={[styles.chipText, styles.adultChipText]}>{adultContentLabel(k)}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        ) : null}

        {/* Capítulos */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, themed.muted]}>Capítulos ({chapters.length})</Text>

          {chapters.length === 0 ? (
            <Text style={[styles.emptyChapters, themed.muted]}>No hay capítulos publicados aún.</Text>
          ) : (
            chapters.map((ch, i) => {
              const isBookmarked = bookmark?.chapterId === ch.id;
              return (
                <TouchableOpacity
                  key={ch.id}
                  style={[styles.chapterRow, themed.row]}
                  activeOpacity={0.8}
                  onPress={() => router.push(readerUrl({ chapterId: ch.id }))}
                >
                  <View style={[styles.chapterNum, { borderColor: fmtColor + '50', backgroundColor: fmtColor + '15' }]}>
                    <Text style={[styles.chapterNumText, { color: fmtColor }]}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.chapterTitle, themed.text]} numberOfLines={1}>{ch.title}</Text>
                    {ch.wordCount ? (
                      <Text style={[styles.chapterStats, themed.muted]}>{formatReadingStats(ch.wordCount)}</Text>
                    ) : null}
                    {isBookmarked && (
                      <Text style={styles.chapterBookmarkHint}>
                        Marcador · pág. {(bookmark!.pageIndex) + 1}
                      </Text>
                    )}
                  </View>
                  {isBookmarked && (
                    <TouchableOpacity
                      onPress={() => router.push(readerUrl(bookmark!))}
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

        {/* ── Comentarios de toda la novela (por página en Moderno, por capítulo en Webnovel) ── */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, themed.muted]}>
            Comentarios{visibleComments.length > 0 ? ` · ${visibleComments.length}` : ''}
          </Text>
          {visibleComments.length === 0 ? (
            <Text style={[styles.emptyChapters, themed.muted]}>
              {story.format === 'Webnovel'
                ? 'Todavía no hay comentarios. Se escriben al final de cada capítulo.'
                : 'Todavía no hay comentarios. Se escriben desde cada página, al leer.'}
            </Text>
          ) : visibleComments.map(c => (
            <CommentItem
              key={c.id}
              comment={withCurrentLocation(c)}
              role={staffRoles.get(c.uid)}
              canDelete={!!user && (c.uid === user.uid || story.uid === user.uid || can('deleteStories'))}
              onDelete={handleDeleteComment}
              onReport={user && c.uid !== user.uid
                ? () => setReportTarget({
                    type: 'comment', storyId: story.id, storyTitle: story.title,
                    commentId: c.id, commentText: c.text, targetUid: c.uid,
                  })
                : undefined}
              onPressUser={uid => router.push({ pathname: '/user/[uid]', params: { uid } })}
              colors={wn ? { name: wn.text, text: wn.text, muted: wn.muted } : undefined}
            />
          ))}
        </View>

      </ScrollView>

      {/* ── Botones de lectura ── */}
      {chapters.length > 0 && (
        <SafeAreaView edges={['bottom']} style={[styles.footer, themed.footer]}>
          {/* Ir al marcador — solo si existe */}
          {bookmark && (
            <TouchableOpacity
              style={[styles.readBtn, styles.bookmarkReadBtn]}
              activeOpacity={0.85}
              onPress={() => router.push(readerUrl(bookmark))}
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
                router.push(readerUrl(readingProgress));
              } else {
                router.push(readerUrl({ chapterId: chapters[0].id }));
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
  // Escritorio: más alto, con la portada a la izquierda y el título al lado
  heroDesktop:    { height: 370 },
  // Sin portada no hace falta tanta altura: quedaría un bloque vacío
  heroDesktopNoCover: { height: 220 },
  heroDesktopRow: { flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 28, paddingBottom: 8 },
  coverCardTall:  { width: 170, height: 255, borderRadius: 8, marginBottom: 12, backgroundColor: '#000' },
  coverCardWide:  { width: 340, height: 191, borderRadius: 8, marginBottom: 12, backgroundColor: '#000' },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  heroHeader:  { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backBtn:     { margin: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  bookmarkBtn: { margin: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  heroActions: { flexDirection: 'row', alignItems: 'center' },
  authorRow:   { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 2 },
  authorName:  { fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: '600', textDecorationLine: 'underline' },
  // Moderación
  modOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modBox:      { width: '100%', backgroundColor: Colors.surface, borderRadius: 8, padding: 20, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  modTitle:    { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  modText:     { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  modInput:    { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary, fontSize: 14, minHeight: 70 },
  modActions:  { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modCancel:   { paddingHorizontal: 16, paddingVertical: 10 },
  modCancelText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },
  modDelete:   { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 6, backgroundColor: '#D9363E', minWidth: 90, alignItems: 'center' },
  modDeleteText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  heroInfo:    { padding: 20, gap: 6 },
  formatBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  formatBadgeText: { fontSize: 10, fontWeight: '700', color: '#000', letterSpacing: 0.5 },
  heroTitle:    { fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: 0.3, lineHeight: 30 },
  heroSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.75)', fontStyle: 'italic' },
  heroStatus:   { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  heroBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  likeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  likeBtnOn:     { borderColor: '#FF69B4' },
  likeCountText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  // Contenido
  scroll:        { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  section:       { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel:  { fontSize: 12, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  description:   { fontSize: 14, color: Colors.textSecondary, lineHeight: 22 },
  emptyChapters: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },

  // Clasificación
  chipRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  chipText:  { fontSize: 12, fontWeight: '600' },
  metaRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  metaText:  { fontSize: 13, color: Colors.textSecondary },
  adultBlock:     { gap: 8 },
  adultBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#D9363E' },
  adultBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  adultChip:      { borderColor: '#D9363E90', backgroundColor: '#D9363E1A' },
  adultChipText:  { color: '#E0555C' },

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
  chapterStats: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  chapterBookmarkHint: { fontSize: 11, color: Colors.emerald, fontWeight: '500', marginTop: 2 },
  chapterBookmarkBtn:  { padding: 4 },
});
