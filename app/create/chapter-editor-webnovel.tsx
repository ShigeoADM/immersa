import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { AppAlert, useDialogAccent } from '@/components/app-dialog';
import { WEBNOVEL_FONT, findRichMarks, stripRichText } from '@/constants/webnovel';
import { RichText } from '@/components/rich-text';
import { countWords, formatReadingStats } from '@/services/stories';
import { DesktopColumn } from '@/components/desktop-column';

const TITLE_MAX = 80;

// Editor de un capítulo Webnovel: título + texto largo con **negrita** y *cursiva*.
export default function ChapterEditorWebnovelScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { storyId, chapterId, chapterTitle } = useLocalSearchParams<{
    storyId: string; chapterId: string; chapterTitle?: string;
  }>();

  useDialogAccent(Colors.formatColors.Webnovel); // diálogos en morado, como el formato

  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [title, setTitle]       = useState(chapterTitle ? decodeURIComponent(chapterTitle) : '');
  const [content, setContent]   = useState('');
  const [preview, setPreview]   = useState(false);

  // Selección del texto (para aplicar negrita / cursiva)
  const selectionRef = useRef({ start: 0, end: 0 });
  // Selección que se fuerza una vez tras aplicar formato; después manda el usuario
  const [forcedSelection, setForcedSelection] = useState<{ start: number; end: number } | undefined>();

  const chapterRef = doc(db, 'stories', storyId as string, 'chapters', chapterId as string);
  const draftKey = `immersa_webnovel_draft:${storyId}:${chapterId}`;

  // ── Cambios sin guardar ───────────────────────────────────────────────────
  const snapshot = JSON.stringify({ title, content });
  const savedSnapshotRef = useRef<string | null>(null);
  const isDirty = savedSnapshotRef.current !== null && snapshot !== savedSnapshotRef.current;
  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;
  const allowLeaveRef = useRef(false);
  const draftResolvedRef = useRef(false);
  const clearDraft = () => { AsyncStorage.removeItem(draftKey).catch(() => {}); };

  // ── Cargar capítulo (y ofrecer el borrador si la app se cerró sin guardar) ─
  useEffect(() => {
    (async () => {
      let saved = { title, content: '' };
      try {
        const snap = await getDoc(chapterRef);
        if (snap.exists()) {
          saved = { title: snap.data().title ?? title, content: snap.data().content ?? '' };
          setTitle(saved.title);
          setContent(saved.content);
        }
      } catch (e) {
        console.error('Error cargando capítulo:', e);
      }
      savedSnapshotRef.current = JSON.stringify(saved);
      setLoading(false);

      let raw: string | null = null;
      try { raw = await AsyncStorage.getItem(draftKey); } catch { /* sin borrador */ }
      if (!raw || raw === savedSnapshotRef.current) {
        if (raw) clearDraft();
        draftResolvedRef.current = true;
        return;
      }
      AppAlert.alert(
        'Borrador sin guardar',
        'Hay cambios de este capítulo que no llegaste a guardar. ¿Quieres recuperarlos?',
        [
          { text: 'Descartar', style: 'destructive', onPress: () => { clearDraft(); draftResolvedRef.current = true; } },
          {
            text: 'Recuperar',
            onPress: () => {
              try {
                const d = JSON.parse(raw as string);
                setTitle(d.title ?? ''); setContent(d.content ?? '');
              } catch { clearDraft(); }
              draftResolvedRef.current = true;
            },
          },
        ],
        { cancelable: false },
      );
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Borrador automático mientras haya cambios
  useEffect(() => {
    if (!draftResolvedRef.current) return;
    if (!isDirty) { clearDraft(); return; }
    const t = setTimeout(() => { AsyncStorage.setItem(draftKey, snapshot).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [snapshot, isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Salir con cambios → confirmar
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e: any) => {
      if (allowLeaveRef.current || !isDirtyRef.current) return;
      e.preventDefault();
      AppAlert.alert('Cambios sin guardar', 'Si sales ahora perderás los cambios de este capítulo.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Salir sin guardar', style: 'destructive',
          onPress: () => { allowLeaveRef.current = true; clearDraft(); navigation.dispatch(e.data.action); },
        },
      ]);
    });
  }, [navigation]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guardar ───────────────────────────────────────────────────────────────
  const wordCount = countWords(stripRichText(content));

  const handleSave = async () => {
    if (saving) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      AppAlert.alert('Falta el título', 'Ponle un título al capítulo.');
      return;
    }
    setSaving(true);
    try {
      await updateDoc(chapterRef, {
        title: cleanTitle,
        content,
        wordCount,
        updatedAt: new Date().toISOString(),
      });
      allowLeaveRef.current = true;
      clearDraft();
      router.back();
    } catch (e) {
      console.error('Error guardando capítulo:', e);
      AppAlert.alert('Error', 'No se pudo guardar el capítulo. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  // ── Formato visible mientras se escribe ───────────────────────────────────
  // El texto se guarda con marcas (**negrita**, *cursiva*), pero el campo las pinta ya
  // con su estilo y esconde los asteriscos (letra diminuta y transparente: siguen en el
  // texto, pero no se ven ni ocupan sitio).
  const styledContent = useMemo(() => {
    const out: React.ReactNode[] = [];
    let pos = 0;
    findRichMarks(content).forEach((m, i) => {
      if (m.start > pos) out.push(content.slice(pos, m.start));
      const mark = content.slice(m.start, m.start + m.n);
      out.push(
        <Text key={`o${i}`} style={styles.hiddenMark}>{mark}</Text>,
        <Text
          key={`t${i}`}
          style={{ fontWeight: m.n >= 2 ? '700' : undefined, fontStyle: m.n !== 2 ? 'italic' : undefined }}
        >{content.slice(m.start + m.n, m.end - m.n)}</Text>,
        <Text key={`c${i}`} style={styles.hiddenMark}>{mark}</Text>,
      );
      pos = m.end;
    });
    if (pos < content.length) out.push(content.slice(pos));
    return out;
  }, [content]);

  // Si al borrar se toca una marca oculta, se quita el formato entero de ese tramo
  // (si no, quedaría una marca suelta y aparecerían asteriscos sin sentido).
  const handleChangeText = (next: string) => {
    if (next.length === content.length - 1) {
      let p = 0;
      while (p < next.length && next[p] === content[p]) p++;
      if (content[p] === '*') {
        const m = findRichMarks(content).find(x =>
          (p >= x.start && p < x.start + x.n) || (p >= x.end - x.n && p < x.end));
        if (m) {
          const inner = content.slice(m.start + m.n, m.end - m.n);
          setContent(content.slice(0, m.start) + inner + content.slice(m.end));
          const cursor = p < m.start + m.n ? m.start : m.start + inner.length;
          setForcedSelection({ start: cursor, end: cursor });
          return;
        }
      }
    }
    setContent(next);
  };

  // ── Negrita / cursiva ─────────────────────────────────────────────────────
  // Envuelve la selección con la marca (** o *). Si ya estaba envuelta, la quita.
  // Sin selección, inserta las marcas y deja el cursor en medio.
  const applyMark = (mark: '**' | '*') => {
    const { start, end } = selectionRef.current;
    const before = content.slice(0, start);
    const selected = content.slice(start, end);
    const after = content.slice(end);
    const n = mark.length;

    // "*" suelto no debe confundirse con el final de "**"
    const hasMark = (s: string, atEnd: boolean) => {
      const edge = atEnd ? s.slice(-3) : s.slice(0, 3);
      const stars = atEnd ? (edge.match(/\*+$/)?.[0].length ?? 0) : (edge.match(/^\*+/)?.[0].length ?? 0);
      return mark === '**' ? stars >= 2 : stars === 1 || stars === 3;
    };

    if (selected.length > 0 && hasMark(before, true) && hasMark(after, false)) {
      setContent(before.slice(0, -n) + selected + after.slice(n));
      setForcedSelection({ start: start - n, end: end - n });
    } else {
      setContent(before + mark + selected + mark + after);
      setForcedSelection({ start: start + n, end: end + n });
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={Colors.emerald} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />

      {/* ── Cabecera ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Capítulo</Text>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={styles.saveBtnText}>Guardar</Text>}
        </TouchableOpacity>
      </View>

      <DesktopColumn>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Título */}
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="Título del capítulo"
          placeholderTextColor={Colors.textMuted}
          maxLength={TITLE_MAX}
        />

        {/* Barra de formato */}
        <View style={styles.toolbar}>
          <TouchableOpacity
            style={[styles.toolBtn, preview && { opacity: 0.35 }]}
            onPress={() => applyMark('**')}
            disabled={preview}
            activeOpacity={0.7}
          >
            <MaterialIcons name="format-bold" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, preview && { opacity: 0.35 }]}
            onPress={() => applyMark('*')}
            disabled={preview}
            activeOpacity={0.7}
          >
            <MaterialIcons name="format-italic" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.stats} numberOfLines={1}>{formatReadingStats(wordCount)}</Text>
          <TouchableOpacity
            style={[styles.previewBtn, preview && styles.previewBtnActive]}
            onPress={() => setPreview(v => !v)}
            activeOpacity={0.8}
          >
            <MaterialIcons name={preview ? 'edit' : 'visibility'} size={15} color={preview ? '#000' : Colors.textSecondary} />
            <Text style={[styles.previewBtnText, preview && { color: '#000' }]}>{preview ? 'Editar' : 'Vista previa'}</Text>
          </TouchableOpacity>
        </View>

        {/* Texto / vista previa */}
        {preview ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.previewContent}>
            {content.trim()
              ? <RichText content={content} style={styles.previewText} paragraphSpacing={14} />
              : <Text style={styles.hint}>El capítulo está vacío.</Text>}
          </ScrollView>
        ) : (
          <TextInput
            style={styles.contentInput}
            onChangeText={handleChangeText}
            selection={forcedSelection}
            onSelectionChange={e => {
              selectionRef.current = e.nativeEvent.selection;
              if (forcedSelection) setForcedSelection(undefined);
            }}
            placeholder={'Escribe aquí el capítulo…\n\nSelecciona texto y pulsa los botones de arriba para ponerlo en negrita o cursiva.'}
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
            scrollEnabled
            // En el navegador un campo de texto no admite texto con estilos dentro:
            // se escribe con las marcas (**negrita**, *cursiva*) a la vista, y el
            // resultado se comprueba con la vista previa.
            value={Platform.OS === 'web' ? content : undefined}
          >
            {Platform.OS === 'web' ? undefined : styledContent}
          </TextInput>
        )}
      </KeyboardAvoidingView>
      </DesktopColumn>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered:  { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBtn:   { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  saveBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, minWidth: 80, alignItems: 'center',
    backgroundColor: Colors.formatColors.Webnovel,
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#000' },
  titleInput: {
    fontSize: 20, fontWeight: '700', color: Colors.textPrimary,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10,
  },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 6,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border,
  },
  toolBtn: {
    width: 36, height: 36, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  stats: { flex: 1, fontSize: 11, color: Colors.textMuted, textAlign: 'center' },
  previewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  previewBtnActive: { backgroundColor: Colors.formatColors.Webnovel, borderColor: Colors.formatColors.Webnovel },
  previewBtnText:   { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  contentInput: {
    flex: 1, paddingHorizontal: 20, paddingVertical: 14,
    fontSize: 16, lineHeight: 25, color: Colors.textPrimary,
  },
  // Marcas de formato dentro del campo: presentes en el texto, pero invisibles
  hiddenMark: { fontSize: 1, color: 'transparent' },
  previewContent: { paddingHorizontal: 20, paddingVertical: 14 },
  previewText:    { fontFamily: WEBNOVEL_FONT, fontSize: 17, lineHeight: 28, color: Colors.textPrimary },
  hint:           { fontSize: 13, color: Colors.textMuted },
});
