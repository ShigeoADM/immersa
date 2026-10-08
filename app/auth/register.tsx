import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { MIN_AGE, ageOf, buildBirthDate } from '@/constants/age';
import { BirthDateInput, EMPTY_BIRTH_DATE } from '@/components/birth-date-input';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { PasswordInput } from '@/components/password-input';
import { useT } from '@/i18n';

export default function RegisterScreen() {
  const t = useT();
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [birth, setBirth]       = useState(EMPTY_BIRTH_DATE);
  const [accepted, setAccepted] = useState(false); // términos de uso y política de privacidad
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password || !confirm) {
      setError('Rellena todos los campos.');
      return;
    }
    if (password !== confirm) {
      setError(t('register.mismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('register.short'));
      return;
    }
    const birthDate = buildBirthDate(birth.day, birth.month, birth.year);
    if (!birthDate) {
      setError(t('register.birthInvalid'));
      return;
    }
    if (ageOf(birthDate) < MIN_AGE) {
      setError(t('register.minAge', { n: MIN_AGE }));
      return;
    }
    if (!accepted) {
      setError(t('register.mustAccept'));
      return;
    }
    setError('');
    setLoading(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(credential.user, { displayName: username.trim() });
      // Guardar perfil en Firestore
      await setDoc(doc(db, 'users', credential.user.uid), {
        uid: credential.user.uid,
        username: username.trim(),
        displayName: username.trim(),
        email: email.trim(),
        birthDate,                                  // privado: decide el acceso al contenido +18
        acceptedTermsAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        stories: [],
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use') {
        setError(t('register.emailTaken'));
      } else {
        setError(t('register.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.inner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo / título */}
            <View style={styles.logoArea}>
              {isDesktop && (
                <Image source={require('@/assets/images/logo-mark.png')} style={styles.logoMark} resizeMode="contain" />
              )}
              <Text style={styles.logoText}>immersa</Text>
              <Text style={styles.tagline}>{t('register.tagline')}</Text>
            </View>

            {/* Formulario */}
            <View style={styles.form}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Text style={styles.label}>{t('register.username')}</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder={t('register.usernamePlaceholder')}
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
              />

              <Text style={styles.label}>{t('login.email')}</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t('login.emailPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.label}>{t('login.password')}</Text>
              <PasswordInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t('register.passwordPlaceholder')}
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.label}>{t('register.confirm')}</Text>
              <PasswordInput
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                placeholder={t('register.confirmPlaceholder')}
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.label}>{t('register.birth')}</Text>
              <BirthDateInput value={birth} onChange={setBirth} />
              <Text style={styles.hint}>
                {t('register.birthHint')}
              </Text>

              {/* Aceptación de los textos legales */}
              <View style={styles.acceptRow}>
                <TouchableOpacity onPress={() => setAccepted(v => !v)} hitSlop={8} activeOpacity={0.7}>
                  <MaterialIcons
                    name={accepted ? 'check-box' : 'check-box-outline-blank'}
                    size={22}
                    color={accepted ? Colors.emerald : Colors.textMuted}
                  />
                </TouchableOpacity>
                <Text style={styles.acceptText}>
                  {t('register.accept1')}
                  <Text style={styles.footerLink} onPress={() => router.push('/auth/legal?doc=terms' as Href)}>
                    {t('register.terms')}
                  </Text>
                  {t('register.accept2')}
                  <Text style={styles.footerLink} onPress={() => router.push('/auth/legal?doc=privacy' as Href)}>
                    {t('register.privacy')}
                  </Text>
                  {t('register.accept3')}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleRegister}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={styles.btnText}>{t('register.submit')}</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Pie */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('register.haveAccount')}</Text>
              <TouchableOpacity onPress={() => router.back()}>
                <Text style={styles.footerLink}>{t('register.signIn')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  inner: {
    paddingHorizontal: 28,
    paddingTop: 60,
    paddingBottom: 40,
    gap: 32,
  },
  logoArea: {
    alignItems: 'center',
    gap: 8,
  },
  // Solo en escritorio: el logo encima del nombre
  logoMark: {
    width: 96,
    height: 118,
    marginBottom: 8,
  },
  logoText: {
    fontSize: 36,
    fontWeight: '300',
    color: Colors.emerald,
    letterSpacing: 6,
  },
  tagline: {
    fontSize: 14,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  form: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
    marginBottom: 4,
    marginTop: 10,
  },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: Colors.textPrimary,
    fontSize: 14,
  },
  hint:       { fontSize: 11, color: Colors.textMuted, marginTop: 4, lineHeight: 16 },
  acceptRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  acceptText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  errorText: {
    fontSize: 13,
    color: '#FF6B6B',
    textAlign: 'center',
    marginBottom: 4,
  },
  btn: {
    marginTop: 20,
    backgroundColor: Colors.emerald,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 0.5,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  footerText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  footerLink: {
    fontSize: 13,
    color: Colors.emerald,
    fontWeight: '600',
  },
});
