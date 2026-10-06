import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, ActivityIndicator, AppState,
  TextInput, KeyboardAvoidingView, Platform,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeKeepAwake } from '@/hooks/use-safe-keep-awake';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db, auth } from '@/config/firebase';
import {
  WEBNOVEL_FONT, WEBNOVEL_FONT_SIZES, WEBNOVEL_FONT_SIZE_DEFAULT, WEBNOVEL_THEMES, WEBNOVEL_THEME_DEFAULT,
  type WebnovelTheme, getWebnovelFontSize, getWebnovelTheme, setWebnovelFontSize,
} from '@/constants/webnovel';
import { RichText } from '@/components/rich-text';
import { Colors } from '@/constants/theme';
import { sortChapters } from '@/services/stories';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/constants/permissions';
import {
  type StoryComment, COMMENT_MAX_LENGTH, addComment, deleteComment, listChapterComments,
} from '@/services/comments';
import { getStaffRoles } from '@/services/profiles';
import { enterReading, leaveReading, hasLikedChapter, setChapterLike } from '@/services/social';
import { CommentItem } from '@/components/comment-item';
import { AppAlert } from '@/components/app-dialog';
import { ReportModal } from '@/components/report-modal';
import type { ReportTarget } from '@/services/reports';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { promptLogin } from '@/components/login-prompt';

type ChapterRef = { id: string; title: string };

// Lector Webnovel: un capítulo en vertical con scroll continuo.
// El tema (oscuro / sepia / claro) lo elige el lector en sus ajustes; el tamaño de
// letra se cambia aquí mismo. Se recuerda por dónde iba para "Continuar leyendo".
export default function WebnovelReaderScreen() {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const { storyId, chapterId, preview } = useLocalSearchParams<{
    storyId: string;
    chapterId: string;
    preview?: string; // '1' = abierto por el autor para probar: no guarda progreso
  }>();
  const isPreview = preview === '1';

  useSafeKeepAwake(); // la pantalla no se apaga mientras se lee

  const [loading, setLoading]   = useState(true);
  const [title, setTitle]       = useState('');
  const [content, setContent]   = useState('');
  // Me gusta del capítulo
  const [liked, setLiked]         = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking]       = useState(false);
  const [chapterNumber, setChapterNumber] = useState(1);
  const [prevChapter, setPrevChapter] = useState<ChapterRef | null>(null);
  const [nextChapter, setNextChapter] = useState<ChapterRef | null>(null);
  const [themeName, setThemeName] = useState<WebnovelTheme>(WEBNOVEL_THEME_DEFAULT);
  const [fontSize, setFontSize]   = useState(WEBNOVEL_FONT_SIZE_DEFAULT);
  const theme = WEBNOVEL_THEMES[themeName];

  // Comentarios del capítulo (al final del texto)
  const { publicName, publicAvatar, can, blocked, suspended } = useAuth();
  const [comments, setComments]       = useState<StoryComment[]>([]);
  const [staffRoles, setStaffRoles]   = useState<Map<string, Role>>(new Map());
  const [commentText, setCommentText] = useState('');
  const [sending, setSending]         = useState(false);
  const [isAuthor, setIsAuthor]       = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  // Datos de la historia para guardar el progreso sin lecturas extra
  const storyRef = useRef<Record<string, any> | null>(null);
  // Scroll: posición actual (0–1) y posición a restaurar al abrir
  const scrollRef     = useRef<ScrollView>(null);
  const progressRef   = useRef(0);
  const restoreRef    = useRef<number | null>(null);
  const viewportRef   = useRef(0);
  const viewCountedRef = useRef(false); // ya se intentó contar la lectura en esta apertura

  // ── Preferencias del lector ───────────────────────────────────────────────
  useEffect(() => {
    getWebnovelTheme().then(setThemeName);
    getWebnovelFontSize().then(setFontSize);
  }, []);

  const changeFontSize = (dir: -1 | 1) => {
    const i = WEBNOVEL_FONT_SIZES.indexOf(fontSize);
    const next = WEBNOVEL_FONT_SIZES[Math.max(0, Math.min(WEBNOVEL_FONT_SIZES.length - 1, i + dir))];
    if (next === fontSize) return;
    setFontSize(next);
    setWebnovelFontSize(next);
  };

  // ── Cargar capítulo ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!storyId || !chapterId) return;
    let cancelled = false;
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        const [storySnap, chapterSnap, chaptersSnap, librarySnap] = await Promise.all([
          getDoc(doc(db, 'stories', storyId)),
          getDoc(doc(db, 'stories', storyId, 'chapters', chapterId)),
          getDocs(collection(db, 'stories', storyId, 'chapters')),
          uid && !isPreview ? getDoc(doc(db, 'users', uid, 'library', storyId)) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        storyRef.current = storySnap.exists() ? storySnap.data() : null;
        if (chapterSnap.exists()) {
          setTitle(chapterSnap.data().title ?? '');
          setContent(chapterSnap.data().content ?? '');
          setLikeCount(chapterSnap.data().likeCount ?? 0);
        }
        if (uid && !isPreview) {
          hasLikedChapter(storyId, chapterId, uid).then(v => { if (!cancelled) setLiked(v); })
            .catch(e => console.error('Error cargando me gusta:', e));
        }

        // Capítulo anterior / siguiente (publicados; el autor ve también los borradores)
        const isAuthor = !!uid && storyRef.current?.uid === uid;
        setIsAuthor(isAuthor);
        // Comentarios (si fallan, el lector funciona igual)
        listChapterComments(storyId, chapterId).then(setComments)
          .catch(e => console.error('Error cargando comentarios:', e));
        getStaffRoles().then(setStaffRoles)
          .catch(e => console.error('Error cargando el equipo:', e));
        const visible = sortChapters(chaptersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
          .filter(c => isAuthor || c.published === true || c.id === chapterId);
        const idx = visible.findIndex(c => c.id === chapterId);
        if (idx !== -1) {
          setChapterNumber(idx + 1);
          const p = visible[idx - 1], n = visible[idx + 1];
          setPrevChapter(p ? { id: p.id, title: p.title ?? 'Capítulo anterior' } : null);
          setNextChapter(n ? { id: n.id, title: n.title ?? 'Siguiente capítulo' } : null);
        }

        // Si se vuelve al capítulo donde se dejó la lectura, restaurar la posición
        const lib = librarySnap?.exists() ? librarySnap.data() : null;
        if (lib?.lastChapterId === chapterId && typeof lib.lastScroll === 'number') {
          restoreRef.current = lib.lastScroll;
          progressRef.current = lib.lastScroll;
        }
      } catch (e) {
        console.error('Error cargando capítulo:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storyId, chapterId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Progreso de lectura ───────────────────────────────────────────────────
  const saveProgress = useCallback(async () => {
    const uid = auth.currentUser?.uid;
    const story = storyRef.current;
    if (isPreview || !uid || !story || !storyId || !chapterId) return;
    try {
      const now = new Date().toISOString();
      const libraryRef = doc(db, 'users', uid, 'library', storyId);
      const existing = await getDoc(libraryRef);
      await setDoc(libraryRef, {
        storyId,
        title: story.title ?? '',
        coverUrl: story.coverUrl ?? null,
        format: story.format ?? 'Webnovel',
        coverOrientation: story.coverOrientation ?? 'vertical',
        status: story.status ?? 'ongoing',
        isReading: true,
        isInterested: existing.exists() ? existing.data().isInterested ?? false : false,
        lastChapterId: chapterId,
        lastChapterTitle: title || null,
        lastScroll: progressRef.current,
        lastReadAt: now,
        addedAt: existing.exists() ? existing.data().addedAt ?? now : now,
      }, { merge: true });
      // Lecturas (estadística del autor): se intenta una vez por apertura del lector,
      // no en cada guardado (al salir tras leer un rato contaría una lectura de más)
      if (!viewCountedRef.current) {
        viewCountedRef.current = true;
        enterReading(storyId, uid, story.uid);
      }
    } catch (e) {
      console.error('Error guardando progreso de lectura:', e);
    }
  }, [storyId, chapterId, title, isPreview]);

  // Guardar al abrir, al salir y al mandar la app a segundo plano
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  useEffect(() => {
    if (loading) return;
    saveProgressRef.current();
    const readerUid = isPreview ? undefined : auth.currentUser?.uid;
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'background') return;
      saveProgressRef.current();
      // Apunta la hora por si la app se cierra desde el fondo (la sesión sigue abierta)
      if (readerUid) leaveReading(storyId, readerUid, false);
    });
    // Al salir: guardar la posición y apuntar que se deja de leer
    return () => {
      sub.remove();
      saveProgressRef.current();
      if (readerUid) leaveReading(storyId, readerUid);
    };
  }, [loading]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const max = contentSize.height - layoutMeasurement.height;
    progressRef.current = max > 0 ? Math.min(1, Math.max(0, contentOffset.y / max)) : 0;
  };

  // Restaurar la posición guardada cuando el contenido ya tiene altura
  const handleContentSizeChange = (_w: number, h: number) => {
    if (restoreRef.current === null || viewportRef.current === 0) return;
    const max = h - viewportRef.current;
    if (max <= 0) return;
    scrollRef.current?.scrollTo({ y: restoreRef.current * max, animated: false });
    restoreRef.current = null;
  };

  // ── Comentarios ───────────────────────────────────────────────────────────
  // Invitado: al intentar comentar se le pregunta si quiere iniciar sesión
  const askLoginToComment = () =>
    promptLogin(() => router.push('/auth/login'), 'Necesitas una cuenta para comentar.');

  // Me gusta al capítulo (los invitados tienen que iniciar sesión)
  const toggleLike = async () => {
    const me = auth.currentUser;
    if (!me) {
      promptLogin(() => router.push('/auth/login'), 'Necesitas una cuenta para dar me gusta.');
      return;
    }
    if (!storyId || !chapterId || liking) return;
    const next = !liked;
    setLiking(true);
    setLiked(next);
    setLikeCount(c => Math.max(0, c + (next ? 1 : -1)));
    try {
      const s = storyRef.current;
      await setChapterLike(storyId, chapterId, next, { uid: me.uid, name: publicName || 'Alguien' }, {
        authorUid: s?.uid, title: s?.title, coverUrl: s?.coverUrl ?? null, format: s?.format,
      });
    } catch (e: any) {
      setLiked(!next);
      setLikeCount(c => Math.max(0, c + (next ? -1 : 1)));
      AppAlert.alert('Error', e?.message ?? 'No se pudo guardar el me gusta.');
    } finally {
      setLiking(false);
    }
  };

  const handleSendComment = async () => {
    const text = commentText.trim();
    const me = auth.currentUser;
    if (!me) { askLoginToComment(); return; } // invitado
    if (!text || !storyId || !chapterId || sending) return;
    if (suspended) {
      AppAlert.alert('Cuenta suspendida', 'Tu cuenta está suspendida: no puedes comentar.');
      return;
    }
    setSending(true);
    try {
      const created = await addComment(
        storyId,
        {
          uid: me.uid, userName: publicName || 'Sin nombre', userAvatar: publicAvatar, text,
          chapterId, pageId: '', chapterNumber, pageNumber: 0, // sin página: es del capítulo
        },
        { authorUid: storyRef.current?.uid, title: storyRef.current?.title },
      );
      setComments(prev => [created, ...prev]);
      setCommentText('');
    } catch (e: any) {
      AppAlert.alert('Error', e?.message ?? 'No se pudo publicar el comentario.');
    } finally {
      setSending(false);
    }
  };

  const handleDeleteComment = (c: StoryComment) => {
    AppAlert.alert('Borrar comentario', '¿Seguro que quieres borrar este comentario?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar', style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(storyId, c.id);
            setComments(prev => prev.filter(x => x.id !== c.id));
          } catch (e: any) { AppAlert.alert('Error', e?.message ?? 'No se pudo borrar el comentario.'); }
        },
      },
    ]);
  };

  // Sin los comentarios de usuarios bloqueados
  const visibleComments = comments.filter(c => !blocked.has(c.uid));

  const goToChapter = (id: string) =>
    router.replace(`/reader/webnovel?storyId=${storyId}&chapterId=${id}${isPreview ? '&preview=1' : ''}`);

  const lineHeight = Math.round(fontSize * 1.65);
  const fontIdx = WEBNOVEL_FONT_SIZES.indexOf(fontSize);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={theme.statusBar} backgroundColor={theme.bar} />
      <ReportModal target={reportTarget} onClose={() => setReportTarget(null)} />

      {/* ── Cabecera ── */}
      <SafeAreaView edges={['top']} style={[styles.header, { backgroundColor: theme.bar, borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.muted }]} numberOfLines={1}>
          {loading ? '' : `Capítulo ${chapterNumber}`}
        </Text>
        <View style={styles.fontControls}>
          <TouchableOpacity
            style={[styles.headerBtn, fontIdx <= 0 && { opacity: 0.3 }]}
            onPress={() => changeFontSize(-1)}
            disabled={fontIdx <= 0}
            activeOpacity={0.7}
          >
            <Text style={[styles.fontBtnSmall, { color: theme.text }]}>A</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.headerBtn, fontIdx >= WEBNOVEL_FONT_SIZES.length - 1 && { opacity: 0.3 }]}
            onPress={() => changeFontSize(1)}
            disabled={fontIdx >= WEBNOVEL_FONT_SIZES.length - 1}
            activeOpacity={0.7}
          >
            <Text style={[styles.fontBtnLarge, { color: theme.text }]}>A</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={theme.muted} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={64}
          onLayout={e => { viewportRef.current = e.nativeEvent.layout.height; }}
          onContentSizeChange={handleContentSizeChange}
        >
          <Text style={[styles.chapterTitle, { color: theme.text, fontFamily: WEBNOVEL_FONT }]}>{title}</Text>

          {content.trim() ? (
            <RichText
              content={content}
              paragraphSpacing={Math.round(fontSize * 0.9)}
              style={{ fontFamily: WEBNOVEL_FONT, fontSize, lineHeight, color: theme.text }}
            />
          ) : (
            <Text style={[styles.empty, { color: theme.muted }]}>Este capítulo todavía no tiene texto.</Text>
          )}

          {/* ── Navegación entre capítulos ── */}
          <View style={[styles.chapterNav, { borderTopColor: theme.border }]}>
            {nextChapter ? (
              <TouchableOpacity
                style={[styles.nextBtn, { backgroundColor: theme.bar, borderColor: theme.border }]}
                onPress={() => goToChapter(nextChapter.id)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.navLabel, { color: theme.muted }]}>Siguiente capítulo</Text>
                  <Text style={[styles.navTitle, { color: theme.text }]} numberOfLines={1}>{nextChapter.title}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={theme.text} />
              </TouchableOpacity>
            ) : (
              <Text style={[styles.endText, { color: theme.muted }]}>— Has llegado al último capítulo publicado —</Text>
            )}
            {prevChapter && (
              <TouchableOpacity style={styles.prevBtn} onPress={() => goToChapter(prevChapter.id)} activeOpacity={0.7}>
                <MaterialIcons name="chevron-left" size={18} color={theme.muted} />
                <Text style={[styles.prevText, { color: theme.muted }]} numberOfLines={1}>{prevChapter.title}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Me gusta del capítulo ── */}
          {!isPreview && (
            <TouchableOpacity
              style={[styles.likeBtn, { borderColor: liked ? '#FF69B4' : theme.border, backgroundColor: theme.bar }]}
              onPress={toggleLike}
              disabled={liking}
              activeOpacity={0.8}
            >
              <MaterialIcons name={liked ? 'favorite' : 'favorite-border'} size={18} color={liked ? '#FF69B4' : theme.muted} />
              <Text style={[styles.likeBtnText, { color: liked ? '#FF69B4' : theme.text }]}>
                {liked ? 'Te gusta este capítulo' : 'Me gusta este capítulo'}{likeCount > 0 ? `  ·  ${likeCount}` : ''}
              </Text>
            </TouchableOpacity>
          )}

          {/* ── Comentarios del capítulo (no en el modo prueba del autor) ── */}
          {!isPreview && (
            <View style={[styles.commentsBlock, { borderTopColor: theme.border }]}>
              <Text style={[styles.commentsTitle, { color: theme.text }]}>
                Comentarios{visibleComments.length > 0 ? ` · ${visibleComments.length}` : ''}
              </Text>
              <View style={styles.commentInputRow}>
                <TextInput
                  style={[styles.commentInput, { color: theme.text, backgroundColor: theme.bar, borderColor: theme.border }]}
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder="Escribe un comentario…"
                  placeholderTextColor={theme.muted}
                  maxLength={COMMENT_MAX_LENGTH}
                  multiline
                  // Invitado: no se le deja escribir; se le pregunta si quiere entrar
                  onFocus={e => {
                    if (auth.currentUser) return;
                    (e.target as any)?.blur?.();
                    askLoginToComment();
                  }}
                />
                <TouchableOpacity
                  style={[styles.commentSendBtn, (!commentText.trim() || sending) && { opacity: 0.4 }]}
                  onPress={handleSendComment}
                  disabled={!commentText.trim() || sending}
                  activeOpacity={0.8}
                >
                  {sending
                    ? <ActivityIndicator size="small" color="#000" />
                    : <MaterialIcons name="send" size={16} color="#000" />}
                </TouchableOpacity>
              </View>
              {visibleComments.length === 0 ? (
                <Text style={[styles.commentsEmpty, { color: theme.muted }]}>
                  Nadie ha comentado este capítulo todavía.
                </Text>
              ) : visibleComments.map(c => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  role={staffRoles.get(c.uid)}
                  showLocation={false}
                  canDelete={c.uid === auth.currentUser?.uid || isAuthor || can('deleteStories')}
                  onDelete={handleDeleteComment}
                  onReport={c.uid !== auth.currentUser?.uid
                    ? () => setReportTarget({
                        type: 'comment', storyId, storyTitle: storyRef.current?.title ?? '',
                        commentId: c.id, commentText: c.text, targetUid: c.uid,
                      })
                    : undefined}
                  onPressUser={uid => router.push({ pathname: '/user/[uid]', params: { uid } })}
                  colors={{ name: theme.text, text: theme.text, muted: theme.muted }}
                />
              ))}
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Escritorio: el fondo del tema ocupa toda la ventana y el texto va en una columna
  // centrada, ancha pero con margen a los lados para que las líneas no sean eternas
  contentDesktop: { width: '100%', maxWidth: 980, alignSelf: 'center', paddingHorizontal: 48 },
  likeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    alignSelf: 'center', marginTop: 28, paddingHorizontal: 18, paddingVertical: 11,
    borderRadius: 22, borderWidth: 1,
  },
  likeBtnText: { fontSize: 14, fontWeight: '600' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 6, borderBottomWidth: 1,
  },
  headerBtn:    { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600' },
  fontControls: { flexDirection: 'row', alignItems: 'center' },
  fontBtnSmall: { fontSize: 14, fontWeight: '700' },
  fontBtnLarge: { fontSize: 21, fontWeight: '700' },
  // Columna de lectura cómoda también en pantallas anchas
  content:      { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 48, width: '100%', maxWidth: 720, alignSelf: 'center' },
  chapterTitle: { fontSize: 24, fontWeight: '700', lineHeight: 32, marginBottom: 24, textAlign: 'center' },
  empty:        { fontSize: 14, fontStyle: 'italic' },
  chapterNav:   { marginTop: 28, paddingTop: 20, borderTopWidth: 1, gap: 14 },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 8, borderWidth: 1,
  },
  navLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  navTitle: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  endText:  { fontSize: 13, textAlign: 'center', fontStyle: 'italic' },
  prevBtn:  { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: 6 },
  prevText: { fontSize: 13 },
  commentsBlock:   { marginTop: 28, paddingTop: 20, borderTopWidth: 1, gap: 6 },
  commentsTitle:   { fontSize: 16, fontWeight: '700', marginBottom: 6 },
  commentsEmpty:   { fontSize: 13, fontStyle: 'italic', marginTop: 8 },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 6 },
  commentInput: {
    flex: 1, maxHeight: 110, fontSize: 14, borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  commentSendBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.formatColors.Webnovel,
  },
});
