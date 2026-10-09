import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { AppHeader } from '@/components/app-header';
import { AUDIENCES, GENRES, STORY_LANGUAGES, audienceLabel } from '@/constants/story-meta';
import { useAuth } from '@/context/AuthContext';
import { genreLabel, getLang, useT, formatLabel, ts } from '@/i18n';

interface SearchStory {
  id: string;
  uid?: string;
  title: string;
  subtitle?: string;
  format: string;
  authorName?: string;
  coverUrl?: string;
  genres?: string[];
  language?: string;
  audience?: string;
  isAdult?: boolean;
  likeCount?: number;
  publishedAt?: string;
}

const FORMATS = ['Moderno', 'Webnovel'] as const;
const MAX_STORIES = 500;

// Idioma de las historias que corresponde al idioma en que se ve la web
const READER_LANGUAGE = { es: 'Español', en: 'English', ja: '日本語' } as const;

// Minúsculas y sin acentos, para que "cancion" encuentre "Canción"
const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Buscador de historias. Firestore no tiene búsqueda de texto, así que se cargan las
// historias publicadas una vez y se filtran en el móvil (título, autor, formato,
// géneros, idioma, público y +18).
export default function SearchScreen() {
  const t = useT();
  const router = useRouter();

  const [stories, setStories] = useState<SearchStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText]       = useState('');
  const [format, setFormat]   = useState<string | null>(null);
  const [genres, setGenres]   = useState<string[]>([]);
  const [hideAdult, setHideAdult] = useState(false);
  // De entrada, las historias escritas en el idioma del lector (se quita en Filtros)
  const [languages, setLanguages] = useState<string[]>(() => [READER_LANGUAGE[getLang()]]);
  const [audiences, setAudiences] = useState<string[]>([]);
  const [showMore, setShowMore]   = useState(false);
  const { isAdult, blocked } = useAuth();
  const isMinor = isAdult === false; // los menores nunca ven historias +18

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'stories'), where('published', '==', true), limit(MAX_STORIES)));
        if (!cancelled) setStories(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<SearchStory, 'id'>) })));
      } catch (e) {
        console.error('Error cargando historias para buscar:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const results = useMemo(() => {
    const words = normalize(text).split(/\s+/).filter(Boolean);
    return stories
      .filter(s => {
        if (format && s.format !== format) return false;
        if ((hideAdult || isMinor) && s.isAdult) return false;
        if (s.uid && blocked.has(s.uid)) return false; // autores bloqueados
        // La historia debe tener todos los géneros elegidos
        if (genres.length > 0 && !genres.every(g => s.genres?.includes(g))) return false;
        // Idioma y público: vale cualquiera de los elegidos (sin idioma guardado es español)
        if (languages.length > 0 && !languages.includes(s.language ?? 'Español')) return false;
        if (audiences.length > 0 && !audiences.includes(s.audience ?? '')) return false;
        if (words.length === 0) return true;
        const haystack = normalize(`${s.title} ${s.subtitle ?? ''} ${s.authorName ?? ''}`);
        return words.every(w => haystack.includes(w));
      })
      // Más gustadas primero; a igualdad, las más recientes
      .sort((a, b) =>
        (b.likeCount ?? 0) - (a.likeCount ?? 0) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  }, [stories, text, format, genres, languages, audiences, hideAdult, isMinor, blocked]);

  const toggleGenre = (g: string) =>
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>) => (v: string) =>
    set(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]);
  const toggleLanguage = toggle(setLanguages);
  const toggleAudience = toggle(setAudiences);
  const moreCount = genres.length + languages.length + audiences.length;

  const hasFilters = !!format || moreCount > 0 || hideAdult || text.trim().length > 0;

  return (
    <View style={styles.container}>
      <AppHeader onBack={() => router.back()} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.inputWrap}>
          <MaterialIcons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t('search.placeholder')}
            placeholderTextColor={Colors.textMuted}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
          />
          {text.length > 0 && (
            <TouchableOpacity onPress={() => setText('')} hitSlop={8}>
              <MaterialIcons name="close" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Filtros ── */}
      <View style={styles.filters}>
        <View style={styles.filterRow}>
          {FORMATS.map(f => {
            const color = Colors.formatColors[f];
            const on = format === f;
            return (
              <TouchableOpacity
                key={f}
                style={[styles.chip, on && { backgroundColor: color, borderColor: color }]}
                onPress={() => setFormat(on ? null : f)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, on && { color: '#000' }]}>{formatLabel(f)}</Text>
              </TouchableOpacity>
            );
          })}
          {!isMinor && (
            <TouchableOpacity
              style={[styles.chip, hideAdult && styles.chipOn]}
              onPress={() => setHideAdult(v => !v)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, hideAdult && { color: '#000' }]}>{t('search.noAdult')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.chip, styles.moreChip, (showMore || moreCount > 0) && styles.moreChipOn]}
            onPress={() => setShowMore(v => !v)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="tune" size={13} color={showMore || moreCount > 0 ? Colors.emerald : Colors.textSecondary} />
            <Text style={[styles.chipText, (showMore || moreCount > 0) && { color: Colors.emerald }]}>
              {ts('Filtros')}{moreCount > 0 ? ` · ${moreCount}` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        {showMore && (
          <View style={styles.panel}>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>{ts('Géneros')}</Text>
              <View style={styles.groupChips}>
                {GENRES.map(g => {
                  const on = genres.includes(g);
                  return (
                    <TouchableOpacity key={g} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleGenre(g)} activeOpacity={0.8}>
                      <Text style={[styles.chipText, on && { color: '#000' }]}>{genreLabel(g)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>{ts('Idioma')}</Text>
              <View style={styles.groupChips}>
                {STORY_LANGUAGES.map(l => {
                  const on = languages.includes(l);
                  return (
                    <TouchableOpacity key={l} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleLanguage(l)} activeOpacity={0.8}>
                      <Text style={[styles.chipText, on && { color: '#000' }]}>{l === 'Otro' ? t('details.langOther') : l}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.group}>
              <Text style={styles.groupLabel}>{ts('Público')}</Text>
              <View style={styles.groupChips}>
                {AUDIENCES.map(a => {
                  const on = audiences.includes(a.key);
                  return (
                    <TouchableOpacity key={a.key} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleAudience(a.key)} activeOpacity={0.8}>
                      <Text style={[styles.chipText, on && { color: '#000' }]}>{audienceLabel(a.key)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {moreCount > 0 && (
              <TouchableOpacity
                style={styles.clear}
                onPress={() => { setGenres([]); setLanguages([]); setAudiences([]); }}
                activeOpacity={0.7}
              >
                <Text style={styles.clearText}>{ts('Quitar filtros')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={Colors.emerald} /></View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={s => s.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={styles.count}>
              {t(results.length === 1 ? 'search.countOne' : 'search.countMany', { n: results.length })}
            </Text>
          }
          ListEmptyComponent={
            <View>
              <Text style={styles.empty}>
                {hasFilters ? t('search.noMatch') : t('search.noStories')}
              </Text>
              {languages.length > 0 && (
                <TouchableOpacity style={styles.allLanguages} onPress={() => setLanguages([])} activeOpacity={0.7}>
                  <Text style={styles.clearText}>{ts('Ver historias en todos los idiomas')}</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item: s }) => {
            const fmtColor = Colors.formatColors[s.format as keyof typeof Colors.formatColors] ?? Colors.emerald;
            return (
              <TouchableOpacity style={styles.row} activeOpacity={0.8} onPress={() => router.push(`/story/${s.id}`)}>
                <View style={styles.cover}>
                  {s.coverUrl
                    ? <Image source={{ uri: s.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
                    : <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
                        <MaterialIcons name="menu-book" size={20} color={fmtColor + '60'} />
                      </View>
                  }
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{s.title}</Text>
                  {s.authorName ? <Text style={styles.rowAuthor} numberOfLines={1}>{s.authorName}</Text> : null}
                  <View style={styles.rowMeta}>
                    <View style={[styles.fmtBadge, { backgroundColor: fmtColor + 'CC' }]}>
                      <Text style={styles.fmtBadgeText}>{formatLabel(s.format)}</Text>
                    </View>
                    {s.isAdult && (
                      <View style={styles.adultBadge}><Text style={styles.adultBadgeText}>+18</Text></View>
                    )}
                    {(s.likeCount ?? 0) > 0 && (
                      <View style={styles.likes}>
                        <MaterialIcons name="favorite" size={11} color="#FF69B4" />
                        <Text style={styles.likesText}>{s.likeCount}</Text>
                      </View>
                    )}
                  </View>
                  {s.genres && s.genres.length > 0 && (
                    <Text style={styles.rowGenres} numberOfLines={1}>{s.genres.map(genreLabel).join(' · ')}</Text>
                  )}
                </View>
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
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, height: 40,
  },
  input:     { flex: 1, color: Colors.textPrimary, fontSize: 14, paddingVertical: 0 },
  filters:   { gap: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16 },
  panel:      { gap: 12, paddingHorizontal: 16, paddingTop: 4 },
  group:      { gap: 6 },
  groupLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.textMuted },
  groupChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  allLanguages: { alignSelf: 'center', paddingVertical: 12 },
  clear:      { alignSelf: 'flex-start', paddingVertical: 2 },
  clearText:  { fontSize: 12, fontWeight: '600', color: Colors.emerald, textDecorationLine: 'underline' },
  moreChip:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  moreChipOn: { borderColor: Colors.emerald },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  chipOn:   { backgroundColor: Colors.emerald, borderColor: Colors.emerald },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:     { paddingHorizontal: 16, paddingBottom: 32 },
  count:    { fontSize: 12, color: Colors.textMuted, paddingVertical: 10 },
  empty:    { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 32 },
  row: {
    flexDirection: 'row', gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '60',
  },
  cover: {
    width: 56, height: 84, borderRadius: 5, overflow: 'hidden', backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowInfo:   { flex: 1, gap: 4, justifyContent: 'center' },
  rowTitle:  { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, lineHeight: 20 },
  rowAuthor: { fontSize: 12, color: Colors.textSecondary },
  rowMeta:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fmtBadge:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  fmtBadgeText: { fontSize: 9, fontWeight: '700', color: '#000', letterSpacing: 0.4 },
  adultBadge:     { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: '#D9363E' },
  adultBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  likes:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  likesText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  rowGenres: { fontSize: 11, color: Colors.textMuted },
});
