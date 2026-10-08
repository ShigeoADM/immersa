import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import { collection, addDoc, doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { AppAlert, useDialogAccent } from '@/components/app-dialog';
import { ADULT_AUDIENCES, ADULT_CONTENT, AUDIENCES, GENRES } from '@/constants/story-meta';
import { useAuth } from '@/context/AuthContext';
import { DesktopColumn } from '@/components/desktop-column';
import { uploadImage, deleteStoredFile } from '@/services/media';
import { coverUsedByAnotherStory } from '@/services/stories';
import { withUploadNotice } from '@/components/upload-notice';
import { tutorialEvent, tutorialIntercept, tutorialZone } from '@/components/tutorial';

const LANGUAGES = ['Español', 'English', 'Português', 'Français', 'Deutsch', 'Otro'];

const STATUSES = [
  { key: 'ongoing',   label: 'En curso' },
  { key: 'completed', label: 'Completada' },
  { key: 'hiatus',    label: 'En pausa' },
  { key: 'upcoming',  label: 'Próximamente' },
];

const UI_DETAIL_COLORS: { hex: string; label: string }[] = [
  { hex: '#00C878', label: 'Verde'    },
  { hex: '#4A90D9', label: 'Azul'     },
  { hex: '#9B59B6', label: 'Morado'   },
  { hex: '#FF69B4', label: 'Rosa'     },
  { hex: '#FF4444', label: 'Rojo'     },
  { hex: '#FF6B35', label: 'Naranja'  },
  { hex: '#FFD700', label: 'Amarillo' },
];

export default function ModernoDetailsScreen() {
  const router = useRouter();
  const { storyId, format: formatParam } = useLocalSearchParams<{ storyId?: string; format?: string }>();
  const isEditing = !!storyId;
  const { publicName } = useAuth(); // nombre del autor en la historia (para el buscador)
  // Formato de la historia: al crear viene de la pestaña Escribir; al editar, del documento
  const [format, setFormat] = useState<'Moderno' | 'Webnovel'>(formatParam === 'Webnovel' ? 'Webnovel' : 'Moderno');
  // Color de acento del formato (verde Moderno, morado Webnovel) para toda la pantalla
  const accent = Colors.formatColors[format];
  const styles = useMemo(() => makeStyles(accent), [accent]);
  useDialogAccent(accent);

  const [loadingInitial, setLoadingInitial] = useState(isEditing);
  const [coverOrientation, setCoverOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const [title, setTitle]           = useState('');
  const [subtitle, setSubtitle]     = useState('');
  const [synopsis, setSynopsis]     = useState('');
  const [credits, setCredits]       = useState('');
  const [language, setLanguage]     = useState('Español');
  const [langOpen, setLangOpen]     = useState(false);
  const [genres, setGenres]         = useState<string[]>([]);
  const [genreOpen, setGenreOpen]   = useState(false);
  const [audience, setAudience]     = useState('');
  const [isAdult, setIsAdult]       = useState(false);
  const [adultContent, setAdultContent] = useState<string[]>([]);
  const [status, setStatus]         = useState('ongoing');
  const [recommendedUiColor, setRecommendedUiColor] = useState<string | null>(null);

  const [coverUri,       setCoverUri]       = useState<string | null>(null);
  const [coverUrl,       setCoverUrl]       = useState('');
  const originalCoverRef = useRef(''); // portada guardada, para borrar su archivo si se cambia
  const [uploadingCover, setUploadingCover] = useState(false);

  const [saving, setSaving] = useState(false);

  // ── Cargar datos existentes en modo edición ───────────────────────────────
  useEffect(() => {
    if (!isEditing) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'stories', storyId as string));
        if (snap.exists()) {
          const d = snap.data();
          setCoverOrientation(d.coverOrientation ?? 'vertical');
          setTitle(d.title ?? '');
          setSubtitle(d.subtitle ?? '');
          setSynopsis(d.synopsis ?? '');
          setCredits(d.credits ?? '');
          setLanguage(d.language ?? 'Español');
          setGenres(d.genres ?? []);
          // Historias guardadas antes de esta regla: +18 con público menor → 18-25
          const adult = d.isAdult ?? false;
          setIsAdult(adult);
          setAudience(adult && !ADULT_AUDIENCES.includes(d.audience) ? '18-25' : (d.audience ?? ''));
          setAdultContent(d.adultContent ?? []);
          setStatus(d.status ?? 'ongoing');
          setRecommendedUiColor(d.recommendedUiColor ?? null);
          setFormat(d.format === 'Webnovel' ? 'Webnovel' : 'Moderno');
          if (d.coverUrl) { setCoverUri(d.coverUrl); setCoverUrl(d.coverUrl); originalCoverRef.current = d.coverUrl; }
        }
      } catch (e) {
        console.error('Error cargando historia para editar:', e);
      } finally {
        setLoadingInitial(false);
      }
    })();
  }, []);

  // Activar +18 obliga a un público adulto: si no lo era, pasa a 18-25
  const handleAdultToggle = (value: boolean) => {
    setIsAdult(value);
    if (value && !ADULT_AUDIENCES.includes(audience)) setAudience('18-25');
  };

  const toggleGenre = (g: string) =>
    setGenres(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const toggleAdultContent = (key: string) =>
    setAdultContent(prev => prev.includes(key) ? prev.filter(x => x !== key) : [...prev, key]);

  const handlePickCover = () => withUploadNotice(pickCover);
  const pickCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      AppAlert.alert('Permiso denegado', 'Necesitamos acceso a tu galería para añadir la portada.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      setCoverUri(localUri);   // preview inmediato
      setUploadingCover(true);
      try {
        const url = await uploadImage(localUri, `covers/${auth.currentUser?.uid}/${Date.now()}`, 1400);
        setCoverUrl(url);
        setCoverUri(url);
      } catch (e: any) {
        console.error('Error subiendo portada:', e);
        AppAlert.alert('Error al subir portada', e?.message ?? 'Inténtalo de nuevo.');
        setCoverUri(null);
        setCoverUrl('');
      } finally {
        setUploadingCover(false);
      }
    }
  };

  const canContinue = title.trim().length > 0 && genres.length > 0 && audience !== '' && !uploadingCover;

  const handleSave = async () => {
    if (!canContinue || saving) return;
    setSaving(true);
    try {
      if (isEditing) {
        // ── Actualizar historia existente ──
        await updateDoc(doc(db, 'stories', storyId as string), {
          title: title.trim(),
          authorName: publicName,
          subtitle: subtitle.trim(),
          synopsis: synopsis.trim(),
          credits: credits.trim(),
          language,
          genres,
          audience,
          isAdult,
          adultContent: isAdult ? adultContent : [],
          status,
          coverOrientation,
          coverUrl,
          recommendedUiColor: recommendedUiColor ?? null,
          updatedAt: new Date().toISOString(),
        });
        // La portada anterior ya no se usa: se borra su archivo
        // (salvo que la comparta con otra historia tuya, como una copia importada)
        const oldCover = originalCoverRef.current;
        if (oldCover && oldCover !== coverUrl) {
          coverUsedByAnotherStory(auth.currentUser?.uid, oldCover, storyId as string)
            .then(shared => { if (!shared) deleteStoredFile(oldCover); });
        }
        router.back();
      } else {
        // ── Crear historia nueva ──
        const docRef = await addDoc(collection(db, 'stories'), {
          uid: auth.currentUser?.uid,
          format,
          title: title.trim(),
          authorName: publicName,
          subtitle: subtitle.trim(),
          synopsis: synopsis.trim(),
          credits: credits.trim(),
          language,
          genres,
          audience,
          isAdult,
          adultContent: isAdult ? adultContent : [],
          status,
          coverOrientation,
          coverUrl,
          chapters: [],
          published: false,
          recommendedUiColor: recommendedUiColor ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        tutorialEvent('storyCreated', { storyId: docRef.id }); // el tutorial esperaba esto para seguir
        router.replace(`/create/editor-moderno?storyId=${docRef.id}&title=${encodeURIComponent(title.trim())}&format=${format}`);
      }
    } catch (e) {
      console.error('Error guardando historia:', e);
      AppAlert.alert('Error', 'No se pudieron guardar los cambios. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  if (loadingInitial) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
        <ActivityIndicator color={accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.bg }}>
        <View style={styles.header}>
          {/* (durante el tutorial no se sale sin crear la historia: sale su aviso) */}
          <TouchableOpacity onPress={() => { if (!tutorialIntercept()) router.back(); }} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isEditing ? 'Editar detalles' : 'Detalles de la historia'}
          </Text>
          <TouchableOpacity
            style={[styles.nextBtn, (!canContinue || saving) && styles.nextBtnDisabled]}
            disabled={!canContinue || saving}
            onPress={handleSave}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator size="small" color="#000" />
              : <Text style={[styles.nextBtnText, !canContinue && styles.nextBtnTextDisabled]}>
                  {isEditing ? 'Guardar' : 'Siguiente'}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <DesktopColumn>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ─── PORTADA ─── */}
        <Text style={styles.sectionLabel}>Portada</Text>
        <View style={styles.coverSection}>
          {/* Selector de orientación */}
          <View style={styles.orientationRow}>
            {(['vertical', 'horizontal'] as const).map(o => (
              <TouchableOpacity
                key={o}
                style={[styles.orientationBtn, coverOrientation === o && styles.orientationBtnActive]}
                onPress={() => setCoverOrientation(o)}
              >
                <Text style={[styles.orientationText, coverOrientation === o && styles.orientationTextActive]}>
                  {o === 'vertical' ? 'Vertical' : 'Horizontal'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Área de portada */}
          <TouchableOpacity
            style={[
              styles.coverPlaceholder,
              coverOrientation === 'horizontal' ? styles.coverHorizontal : styles.coverVertical,
            ]}
            activeOpacity={0.7}
            onPress={handlePickCover}
            disabled={uploadingCover}
          >
            {coverUri ? (
              <>
                <Image
                  source={{ uri: coverUri }}
                  style={[StyleSheet.absoluteFill, { borderRadius: 4 }]}
                  contentFit="cover" transition={150}
                />
                {/* Botón de cambio encima de la imagen */}
                {!uploadingCover && (
                  <View style={styles.coverChangeOverlay}>
                    <MaterialIcons name="edit" size={18} color="#fff" />
                    <Text style={styles.coverChangeText}>Cambiar portada</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <MaterialIcons name="add-photo-alternate" size={32} color={Colors.textMuted} />
                <Text style={styles.coverPlaceholderText}>Añadir portada</Text>
              </>
            )}
            {uploadingCover && (
              <View style={[StyleSheet.absoluteFill, styles.coverUploadingOverlay]}>
                <ActivityIndicator color={accent} />
                <Text style={styles.coverUploadingText}>Subiendo…</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* ─── INFORMACIÓN ─── */}
        <Text style={styles.sectionLabel}>Información</Text>

        <Text style={styles.fieldLabel}>Título <Text style={styles.required}>*</Text></Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Título de la historia"
          placeholderTextColor={Colors.textMuted}
          maxLength={80}
        />

        <Text style={styles.fieldLabel}>Subtítulo <Text style={styles.optional}>(opcional)</Text></Text>
        <TextInput
          style={styles.input}
          value={subtitle}
          onChangeText={setSubtitle}
          placeholder="Subtítulo"
          placeholderTextColor={Colors.textMuted}
          maxLength={80}
        />

        <Text style={styles.fieldLabel}>Sinopsis <Text style={styles.required}>*</Text></Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={synopsis}
          onChangeText={setSynopsis}
          placeholder="Describe tu historia..."
          placeholderTextColor={Colors.textMuted}
          multiline
          numberOfLines={4}
          maxLength={500}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{synopsis.length}/500</Text>

        <Text style={styles.fieldLabel}>Créditos <Text style={styles.optional}>(opcional)</Text></Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={credits}
          onChangeText={setCredits}
          placeholder={'De quién es la música, las imágenes o la portada.\nEj.: Música: «Título» de Autor (sitio.com)'}
          placeholderTextColor={Colors.textMuted}
          multiline
          numberOfLines={4}
          maxLength={1000}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{credits.length}/1000</Text>

        {/* ─── CLASIFICACIÓN ─── */}
        <Text style={styles.sectionLabel}>Clasificación</Text>

        {/* Idioma — desplegable */}
        <TouchableOpacity
          style={styles.dropdownHeader}
          onPress={() => setLangOpen(o => !o)}
          activeOpacity={0.8}
        >
          <View>
            <Text style={styles.dropdownLabel}>Idioma</Text>
            <Text style={styles.dropdownValue}>{language}</Text>
          </View>
          <MaterialIcons
            name={langOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
            size={22}
            color={Colors.textSecondary}
          />
        </TouchableOpacity>
        {langOpen && (
          <View style={styles.dropdownBody}>
            {LANGUAGES.map(l => (
              <TouchableOpacity
                key={l}
                style={styles.dropdownRow}
                onPress={() => { setLanguage(l); setLangOpen(false); }}
              >
                <Text style={[styles.dropdownRowText, language === l && styles.dropdownRowTextActive]}>
                  {l}
                </Text>
                {language === l && (
                  <MaterialIcons name="check" size={16} color={accent} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Género — desplegable multiselecte */}
        <TouchableOpacity
          style={[styles.dropdownHeader, { marginTop: 6 }]}
          onPress={() => setGenreOpen(o => !o)}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.dropdownLabel}>
              Género <Text style={styles.required}>*</Text>
            </Text>
            <Text style={styles.dropdownValue} numberOfLines={1}>
              {genres.length === 0
                ? 'Seleccionar géneros'
                : genres.join(', ')}
            </Text>
          </View>
          <MaterialIcons
            name={genreOpen ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
            size={22}
            color={Colors.textSecondary}
          />
        </TouchableOpacity>
        {genreOpen && (
          <View style={styles.dropdownBody}>
            <View style={styles.genreGrid}>
              {GENRES.map(g => (
                <TouchableOpacity
                  key={g}
                  style={[styles.chip, genres.includes(g) && styles.chipActive]}
                  onPress={() => toggleGenre(g)}
                >
                  <Text style={[styles.chipText, genres.includes(g) && styles.chipTextActive]}>
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.fieldLabel}>Público dirigido <Text style={styles.required}>*</Text></Text>
        {AUDIENCES.map(a => {
          const blocked = isAdult && !ADULT_AUDIENCES.includes(a.key);
          return (
            <TouchableOpacity
              key={a.key}
              style={[styles.radioRow, blocked && { opacity: 0.35 }]}
              onPress={() => setAudience(a.key)}
              disabled={blocked}
            >
              <View style={[styles.radio, audience === a.key && styles.radioActive]}>
                {audience === a.key && <View style={styles.radioDot} />}
              </View>
              <Text style={styles.radioLabel}>{a.label}</Text>
              {blocked && <MaterialIcons name="lock" size={14} color={Colors.textMuted} />}
            </TouchableOpacity>
          );
        })}
        {isAdult && (
          <Text style={styles.toggleDesc}>
            Con contenido +18 solo puede dirigirse a mayores de 18 años.
          </Text>
        )}

        {/* ─── CONTENIDO +18 ─── */}
        <Text style={styles.sectionLabel}>Contenido</Text>

        <View style={styles.toggleRow} nativeID={tutorialZone('adult')}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Contenido +18</Text>
            <Text style={styles.toggleDesc}>
              Activa esto si tu historia contiene material adulto.
            </Text>
          </View>
          <Switch
            value={isAdult}
            onValueChange={handleAdultToggle}
            trackColor={{ false: Colors.border, true: accent + '66' }}
            thumbColor={isAdult ? accent : Colors.textMuted}
          />
        </View>

        {isAdult && (
          <View style={styles.adultOptions}>
            {ADULT_CONTENT.map(c => (
              <TouchableOpacity
                key={c.key}
                style={styles.checkRow}
                onPress={() => toggleAdultContent(c.key)}
              >
                <View style={[styles.checkbox, adultContent.includes(c.key) && styles.checkboxActive]}>
                  {adultContent.includes(c.key) && (
                    <MaterialIcons name="check" size={12} color="#000" />
                  )}
                </View>
                <Text style={styles.checkLabel}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ─── COLOR DE INTERFAZ RECOMENDADO (solo formato Moderno) ─── */}
        {format === 'Moderno' && (
        <>
        <Text style={styles.sectionLabel}>Color de interfaz</Text>
        <Text style={styles.fieldLabel}>
          Recomienda un color de acento para el lector{' '}
          <Text style={styles.optional}>(opcional)</Text>
        </Text>
        <View style={styles.uiColorRow}>
          {/* Opción "Sin recomendación" */}
          <TouchableOpacity
            style={[styles.uiColorNone, recommendedUiColor === null && styles.uiColorNoneActive]}
            onPress={() => setRecommendedUiColor(null)}
            activeOpacity={0.75}
          >
            <MaterialIcons name="block" size={14} color={recommendedUiColor === null ? accent : Colors.textMuted} />
            <Text style={[styles.uiColorNoneText, recommendedUiColor === null && { color: accent }]}>
              Ninguno
            </Text>
          </TouchableOpacity>
          {/* Paleta de colores */}
          {UI_DETAIL_COLORS.map(c => (
            <TouchableOpacity
              key={c.hex}
              style={[
                styles.uiColorSwatch,
                { backgroundColor: c.hex },
                recommendedUiColor === c.hex && styles.uiColorSwatchActive,
              ]}
              onPress={() => setRecommendedUiColor(c.hex)}
              activeOpacity={0.8}
            />
          ))}
        </View>
        {recommendedUiColor && (
          <Text style={[styles.uiColorHint, { color: recommendedUiColor }]}>
            ● Los lectores verán la interfaz en este color por defecto
          </Text>
        )}
        </>
        )}

        {/* ─── ESTADO ─── */}
        <Text style={styles.sectionLabel}>Estado</Text>
        {STATUSES.map(s => (
          <TouchableOpacity
            key={s.key}
            style={styles.radioRow}
            onPress={() => setStatus(s.key)}
          >
            <View style={[styles.radio, status === s.key && styles.radioActive]}>
              {status === s.key && <View style={styles.radioDot} />}
            </View>
            <Text style={styles.radioLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
      </DesktopColumn>
    </View>
  );
}

const makeStyles = (accent: string) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  nextBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: accent,
  },
  nextBtnDisabled: {
    backgroundColor: Colors.border,
  },
  nextBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
  nextBtnTextDisabled: {
    color: Colors.textMuted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
    marginTop: 8,
  },
  fieldLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 8,
    fontWeight: '500',
  },
  required: {
    color: accent,
  },
  optional: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.textPrimary,
    fontSize: 14,
    marginBottom: 18,
  },
  inputMultiline: {
    minHeight: 100,
    paddingTop: 12,
    marginBottom: 4,
  },
  charCount: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'right',
    marginBottom: 18,
  },
  coverSection: {
    marginBottom: 28,
    alignItems: 'center',
    gap: 14,
  },
  orientationRow: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'flex-start',
  },
  orientationBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    backgroundColor: Colors.card,
  },
  orientationBtnActive: {
    borderColor: accent,
    backgroundColor: accent + '18',
  },
  orientationText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  orientationTextActive: {
    color: accent,
  },
  coverPlaceholder: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    alignSelf: 'center',
  },
  coverVertical: {
    width: 140,
    height: 200,
  },
  coverHorizontal: {
    width: 240,
    height: 150,
  },
  coverPlaceholderText: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  coverChangeOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  coverChangeText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  coverUploadingOverlay: {
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  coverUploadingText: {
    fontSize: 12,
    color: accent,
    fontWeight: '600',
  },
  chipsScroll: {
    marginBottom: 18,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 20,
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  chipActive: {
    borderColor: accent,
    backgroundColor: accent + '18',
  },
  chipText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  chipTextActive: {
    color: accent,
    fontWeight: '600',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '80',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: accent,
  },
  radioLabel: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    backgroundColor: Colors.card,
    marginBottom: 12,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  toggleDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  adultOptions: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 12,
    gap: 2,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '60',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: accent,
    borderColor: accent,
  },
  checkLabel: {
    fontSize: 14,
    color: Colors.textPrimary,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 2,
  },
  dropdownLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 2,
  },
  dropdownValue: {
    fontSize: 14,
    color: Colors.textPrimary,
    maxWidth: 260,
  },
  dropdownBody: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 18,
  },
  dropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border + '60',
  },
  dropdownRowText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  dropdownRowTextActive: {
    color: accent,
    fontWeight: '600',
  },

  // ── Selector de color recomendado ────────────────────────────────────────
  uiColorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  uiColorNone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  uiColorNoneActive: {
    borderColor: accent,
    backgroundColor: accent + '18',
  },
  uiColorNoneText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  uiColorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  uiColorSwatchActive: {
    borderColor: '#fff',
    transform: [{ scale: 1.15 }],
  },
  uiColorHint: {
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 18,
  },
});
