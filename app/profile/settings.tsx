import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Switch,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { signOut, updateProfile } from 'firebase/auth';
import { auth, db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { uploadImage } from '@/services/media';
import { AppAlert } from '@/components/app-dialog';
import { deleteAccount } from '@/services/account';
import {
  WEBNOVEL_THEMES, WEBNOVEL_THEME_DEFAULT, WEBNOVEL_THEME_ORDER,
  type WebnovelTheme, getWebnovelTheme, setWebnovelTheme,
} from '@/constants/webnovel';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { DesktopColumn } from '@/components/desktop-column';
import { PasswordInput } from '@/components/password-input';
import { useT } from '@/i18n';
import { LanguagePicker } from '@/components/language-picker';

export default function SettingsScreen() {
  const isDesktop = useIsDesktop();
  const router  = useRouter();
  const { user } = useAuth();
  const t = useT();

  const [displayName,    setDisplayName]    = useState('');
  const [bio,            setBio]            = useState('');
  const [avatarUrl,      setAvatarUrl]      = useState('');
  const [emailPublic,    setEmailPublic]    = useState(false);   // privado por defecto
  const [uploadingAvatar,setUploadingAvatar]= useState(false);
  const [saving,         setSaving]         = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  // Tema de lectura Webnovel: preferencia del lector, se guarda en el móvil al elegirla
  const [webnovelTheme, setWebnovelThemeState] = useState<WebnovelTheme>(WEBNOVEL_THEME_DEFAULT);
  useEffect(() => { getWebnovelTheme().then(setWebnovelThemeState); }, []);
  const pickWebnovelTheme = (t: WebnovelTheme) => { setWebnovelThemeState(t); setWebnovelTheme(t); };

  // Cargar perfil existente
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const d = snap.data();
          setDisplayName(d.displayName ?? user.displayName ?? '');
          setBio(d.bio ?? '');
          setAvatarUrl(d.avatarUrl ?? user.photoURL ?? '');
          setEmailPublic(d.emailPublic === true);  // false si no existe
        } else {
          setDisplayName(user.displayName ?? '');
          setAvatarUrl(user.photoURL ?? '');
        }
      } catch (e) {
        console.error('Error cargando ajustes:', e);
      } finally {
        setLoadingInitial(false);
      }
    })();
  }, [user]);

  // ── Subir avatar ────────────────────────────────────────────────────────────
  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      AppAlert.alert('Permiso denegado', 'Necesitamos acceso a tu galería.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const localUri = result.assets[0].uri;
      setAvatarUrl(localUri);
      setUploadingAvatar(true);
      try {
        const url = await uploadImage(localUri, `avatars/${user!.uid}/${Date.now()}`, 512);
        setAvatarUrl(url);
      } catch (e: any) {
        AppAlert.alert('Error al subir foto', e?.message ?? 'Inténtalo de nuevo.');
        setAvatarUrl(user?.photoURL ?? '');
      } finally {
        setUploadingAvatar(false);
      }
    }
  };

  // ── Guardar cambios ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user || saving || uploadingAvatar) return;
    setSaving(true);
    try {
      // Actualizar Firebase Auth displayName
      await updateProfile(user, {
        displayName: displayName.trim() || null,
        photoURL: avatarUrl || null,
      });
      // Guardar/crear doc en Firestore
      await setDoc(doc(db, 'users', user.uid), {
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarUrl,
        emailPublic,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      router.back();
    } catch (e: any) {
      console.error('Error guardando ajustes:', e);
      AppAlert.alert('Error', e?.message ?? 'No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  // ── Eliminar cuenta ─────────────────────────────────────────────────────────
  // Pide la contraseña (Firebase exige haberse autenticado hace poco para borrar)
  const [deleteOpen, setDeleteOpen]         = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError]       = useState('');
  const [deleting, setDeleting]             = useState(false);

  const handleDeleteAccount = async () => {
    if (!deletePassword || deleting) return;
    setDeleteError('');
    setDeleting(true);
    try {
      await deleteAccount(deletePassword);
      setDeleteOpen(false);
      router.replace('/auth/login');
    } catch (e: any) {
      const wrong = e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential';
      setDeleteError(wrong ? 'La contraseña no es correcta.' : (e?.message ?? 'No se pudo eliminar la cuenta.'));
    } finally {
      setDeleting(false);
    }
  };

  // ── Cerrar sesión ───────────────────────────────────────────────────────────
  const handleSignOut = () => {
    AppAlert.alert(
      'Cerrar sesión',
      '¿Seguro que quieres cerrar sesión?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar sesión',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut(auth);
              router.replace('/auth/login');
            } catch (e) {
              console.error('Error cerrando sesión:', e);
            }
          },
        },
      ]
    );
  };

  if (loadingInitial) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color={Colors.emerald} />
      </View>
    );
  }

  const initials = (displayName || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ajustes de perfil</Text>
          <TouchableOpacity
            style={[styles.saveBtn, (saving || uploadingAvatar) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving || uploadingAvatar}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator size="small" color="#000" />
              : <Text style={styles.saveBtnText}>Guardar</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <DesktopColumn>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── Avatar ── */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={handlePickAvatar}
            disabled={uploadingAvatar}
            activeOpacity={0.8}
          >
            {avatarUrl
              ? <Image source={{ uri: avatarUrl }} style={styles.avatar} />
              : <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initials}</Text>
                </View>
            }
            {/* Cámara overlay */}
            {!uploadingAvatar && (
              <View style={styles.avatarEditOverlay}>
                <MaterialIcons name="photo-camera" size={16} color="#fff" />
              </View>
            )}
            {uploadingAvatar && (
              <View style={[styles.avatarEditOverlay, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
                <ActivityIndicator size="small" color={Colors.emerald} />
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Toca para cambiar la foto</Text>
        </View>

        {/* ── Nombre ── */}
        <Text style={styles.fieldLabel}>Nombre</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Tu nombre o alias"
          placeholderTextColor={Colors.textMuted}
          maxLength={50}
          autoCorrect={false}
        />

        {/* ── Descripción ── */}
        <Text style={styles.fieldLabel}>Descripción</Text>
        <TextInput
          style={[styles.input, styles.inputMultiline]}
          value={bio}
          onChangeText={setBio}
          placeholder="Cuéntanos algo sobre ti o sobre lo que escribes…"
          placeholderTextColor={Colors.textMuted}
          multiline
          numberOfLines={4}
          maxLength={200}
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{bio.length}/200</Text>

        {/* ── Cuenta ── */}
        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>Cuenta</Text>

        {user?.email ? (
          <View style={styles.emailRow}>
            <MaterialIcons name="email" size={16} color={Colors.textMuted} />
            <Text style={styles.emailText} numberOfLines={1}>{user.email}</Text>
          </View>
        ) : null}

        {/* Toggle visibilidad del email */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleTitle}>Mostrar email en perfil público</Text>
            <Text style={styles.toggleDesc}>
              {emailPublic ? 'Tu email es visible para otros usuarios.' : 'Tu email está oculto (privado).'}
            </Text>
          </View>
          <Switch
            value={emailPublic}
            onValueChange={setEmailPublic}
            trackColor={{ false: Colors.border, true: Colors.emerald + '66' }}
            thumbColor={emailPublic ? Colors.emerald : Colors.textMuted}
          />
        </View>

        {/* Tema de lectura de las novelas en formato Webnovel */}
        <View style={styles.themeBlock}>
          <Text style={styles.toggleTitle}>Lectura Webnovel · Tema</Text>
          <Text style={styles.toggleDesc}>Colores con los que lees las novelas de scroll continuo.</Text>
          <View style={styles.themeRow}>
            {WEBNOVEL_THEME_ORDER.map(t => {
              const th = WEBNOVEL_THEMES[t];
              const active = webnovelTheme === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.themeOption,
                    { backgroundColor: th.background, borderColor: active ? Colors.emerald : th.border },
                    active && { borderWidth: 2 },
                  ]}
                  onPress={() => pickWebnovelTheme(t)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.themeSample, { color: th.text }]}>Aa</Text>
                  <Text style={[styles.themeLabel, { color: th.text }]}>{th.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Cerrar sesión (en escritorio está en el menú del perfil) ── */}
        {!isDesktop && <TouchableOpacity style={styles.signOutBtn} activeOpacity={0.8} onPress={handleSignOut}>
          <MaterialIcons name="logout" size={18} color="#FF6B6B" />
          <Text style={styles.signOutText}>Cerrar sesión</Text>
        </TouchableOpacity>}

        {/* ── Usuarios bloqueados ── */}
        <TouchableOpacity
          style={styles.blockedRow}
          activeOpacity={0.8}
          onPress={() => router.push('/profile/lists?tab=blocked' as Href)}
        >
          <MaterialIcons name="block" size={18} color={Colors.textSecondary} />
          <Text style={styles.blockedText}>Usuarios bloqueados</Text>
          <MaterialIcons name="chevron-right" size={20} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* ── Idioma de la web ── */}
        <View style={{ marginTop: 26, gap: 10 }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>
            {t('common.language')}
          </Text>
          <LanguagePicker />
        </View>

        {/* ── Textos legales ── */}
        <View style={styles.legalRow}>
          <TouchableOpacity onPress={() => router.push('/auth/legal?doc=terms' as Href)} hitSlop={8}>
            <Text style={styles.legalLink}>Términos de uso</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => router.push('/auth/legal?doc=privacy' as Href)} hitSlop={8}>
            <Text style={styles.legalLink}>Política de privacidad</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.legalRow, { marginTop: 10 }]}>
          <TouchableOpacity onPress={() => router.push('/auth/legal?doc=uploads' as Href)} hitSlop={8}>
            <Text style={styles.legalLink}>Imágenes, música y derechos de autor</Text>
          </TouchableOpacity>
        </View>

        {/* ── Eliminar cuenta ── */}
        <TouchableOpacity
          style={styles.deleteAccountBtn}
          activeOpacity={0.8}
          onPress={() => { setDeletePassword(''); setDeleteError(''); setDeleteOpen(true); }}
        >
          <Text style={styles.deleteAccountText}>Eliminar mi cuenta</Text>
        </TouchableOpacity>

        <Modal
          visible={deleteOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => { if (!deleting) setDeleteOpen(false); }}
        >
          <View style={styles.deleteOverlay}>
            <View style={styles.deleteBox}>
              <Text style={styles.deleteTitle}>Eliminar cuenta</Text>
              <Text style={styles.deleteText}>
                Se borrarán para siempre tu perfil, tus historias con todos sus capítulos, tu biblioteca,
                tus me gusta y tus notificaciones. Los lectores de tus historias recibirán un aviso.
                No se puede deshacer.
              </Text>
              <Text style={styles.deleteText}>Escribe tu contraseña para confirmar:</Text>
              <PasswordInput
                style={styles.deleteInput}
                value={deletePassword}
                onChangeText={setDeletePassword}
                placeholder="Contraseña"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                editable={!deleting}
              />
              {deleteError ? <Text style={styles.deleteErrorText}>{deleteError}</Text> : null}
              <View style={styles.deleteActions}>
                <TouchableOpacity style={styles.deleteCancel} onPress={() => setDeleteOpen(false)} disabled={deleting}>
                  <Text style={styles.deleteCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.deleteConfirm, (!deletePassword || deleting) && { opacity: 0.4 }]}
                  onPress={handleDeleteAccount}
                  disabled={!deletePassword || deleting}
                >
                  {deleting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.deleteConfirmText}>Eliminar</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <View style={{ height: 40 }} />
      </ScrollView>
      </DesktopColumn>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg },
  headerWrap: { backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerBar:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:    { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle:{ fontSize: 16, fontWeight: '600', color: Colors.textPrimary, letterSpacing: 0.3 },
  saveBtn:    { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: Colors.emerald },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText:{ fontSize: 13, fontWeight: '700', color: '#000' },

  scroll:       { flex: 1 },
  scrollContent:{ paddingHorizontal: 20, paddingTop: 28 },

  // Avatar
  avatarSection: { alignItems: 'center', marginBottom: 32 },
  avatarWrap:    { position: 'relative' },
  avatar:        { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: Colors.emerald },
  avatarFallback:{ width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.emerald + '22', borderWidth: 2, borderColor: Colors.emerald, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 38, fontWeight: '700', color: Colors.emerald },
  avatarEditOverlay: {
    position: 'absolute', bottom: 0, right: 0,
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.emerald,
    borderWidth: 2, borderColor: Colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarHint: { marginTop: 8, fontSize: 12, color: Colors.textMuted },

  // Form
  fieldLabel:     { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  input:          { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: 14, marginBottom: 20 },
  inputMultiline: { minHeight: 100, paddingTop: 12, marginBottom: 4 },
  charCount:      { fontSize: 11, color: Colors.textMuted, textAlign: 'right', marginBottom: 20 },

  // Cuenta
  divider:    { height: 1, backgroundColor: Colors.border, marginBottom: 24 },
  sectionLabel:{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 16 },
  emailRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: Colors.card, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, marginBottom: 12 },
  emailText:  { fontSize: 14, color: Colors.textSecondary },

  themeBlock:  { marginTop: 22, gap: 4 },
  themeRow:    { flexDirection: 'row', gap: 10, marginTop: 10 },
  themeOption: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 8, borderWidth: 1, gap: 2 },
  themeSample: { fontSize: 20, fontWeight: '700' },
  themeLabel:  { fontSize: 12, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: Colors.card, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12,
  },
  toggleInfo:  { flex: 1, marginRight: 12 },
  toggleTitle: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, marginBottom: 2 },
  toggleDesc:  { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },

  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 6, borderWidth: 1, borderColor: '#FF6B6B22', backgroundColor: '#FF6B6B10' },
  signOutText:{ fontSize: 14, fontWeight: '600', color: '#FF6B6B' },
  blockedRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, marginTop: 12 },
  blockedText: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  legalRow:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 24 },
  legalLink:  { fontSize: 12, color: Colors.textSecondary, textDecorationLine: 'underline' },
  legalSep:   { fontSize: 12, color: Colors.textMuted },
  deleteAccountBtn:  { alignSelf: 'center', marginTop: 18, paddingVertical: 8, paddingHorizontal: 12 },
  deleteAccountText: { fontSize: 12, color: Colors.textMuted, textDecorationLine: 'underline' },
  deleteOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  deleteBox: {
    width: '100%', maxWidth: 400, gap: 10,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 20, borderWidth: 1, borderColor: Colors.border,
  },
  deleteTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  deleteText:  { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  deleteInput: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 6,
    paddingHorizontal: 12, paddingVertical: 10, color: Colors.textPrimary, fontSize: 14,
  },
  deleteErrorText:   { fontSize: 13, color: '#FF6B6B' },
  deleteActions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  deleteCancel:      { paddingHorizontal: 16, paddingVertical: 10 },
  deleteCancelText:  { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },
  deleteConfirm:     { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 6, backgroundColor: '#D9363E', minWidth: 90, alignItems: 'center' },
  deleteConfirmText: { fontSize: 14, color: '#fff', fontWeight: '700' },
});
