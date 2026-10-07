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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/config/firebase';
import { Colors } from '@/constants/theme';
import { AppAlert } from '@/components/app-dialog';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { PasswordInput } from '@/components/password-input';
import { IS_DEV_SITE } from '@/constants/site';

export default function LoginScreen() {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError('Rellena todos los campos.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError('Correo o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  // Recuperar contraseña: Firebase envía un correo con un enlace para crear una nueva.
  // El mensaje es el mismo exista o no la cuenta, para no revelar qué correos están registrados.
  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Escribe tu correo y pulsa de nuevo "¿Olvidaste tu contraseña?".');
      return;
    }
    setError('');
    try { await sendPasswordResetEmail(auth, email.trim()); } catch { /* mismo mensaje */ }
    AppAlert.alert(
      'Revisa tu correo',
      'Si hay una cuenta con ese correo, te hemos enviado un enlace para crear una contraseña nueva. Mira también en la carpeta de spam.',
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={styles.inner}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Logo / título */}
          <View style={styles.logoArea}>
            {isDesktop && (
              <Image source={require('@/assets/images/logo-mark.png')} style={styles.logoMark} resizeMode="contain" />
            )}
            <Text style={styles.logoText}>immersa</Text>
            <Text style={styles.tagline}>Bienvenido de nuevo</Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Text style={styles.label}>Correo electrónico</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="tu@correo.com"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Contraseña</Text>
            <PasswordInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={Colors.textMuted}
            />
            <TouchableOpacity onPress={handleForgotPassword} style={{ alignSelf: 'flex-end' }} hitSlop={8}>
              <Text style={styles.footerLink}>¿Olvidaste tu contraseña?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={styles.btnText}>Iniciar sesión</Text>
              }
            </TouchableOpacity>
          </View>

          {/* Pie */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>¿No tienes cuenta? </Text>
            <TouchableOpacity onPress={() => router.push('/auth/register')}>
              <Text style={styles.footerLink}>Regístrate</Text>
            </TouchableOpacity>
          </View>
          {/* Web: también se puede explorar y leer sin cuenta */}
          {Platform.OS === 'web' && !IS_DEV_SITE && (
            <TouchableOpacity style={{ alignSelf: 'center', paddingVertical: 6 }} onPress={() => router.replace('/(tabs)')}>
              <Text style={[styles.footerText, { textDecorationLine: 'underline' }]}>Explorar sin cuenta</Text>
            </TouchableOpacity>
          )}
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
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
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
