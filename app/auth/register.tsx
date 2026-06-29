import React, { useState } from 'react';
import {
  View,
  Text,
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
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { Colors } from '@/constants/theme';

export default function RegisterScreen() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password || !confirm) {
      setError('Rellena todos los campos.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
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
        email: email.trim(),
        createdAt: new Date().toISOString(),
        stories: [],
      });
      router.replace('/(tabs)');
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use') {
        setError('Ese correo ya está registrado.');
      } else {
        setError('Error al crear la cuenta. Inténtalo de nuevo.');
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
              <Text style={styles.logoText}>immersa</Text>
              <Text style={styles.tagline}>Crea tu cuenta</Text>
            </View>

            {/* Formulario */}
            <View style={styles.form}>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Text style={styles.label}>Nombre de usuario</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="tu_nombre"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
              />

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
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
              />

              <Text style={styles.label}>Confirmar contraseña</Text>
              <TextInput
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Repite tu contraseña"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
              />

              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleRegister}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={styles.btnText}>Crear cuenta</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Pie */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>¿Ya tienes cuenta? </Text>
              <TouchableOpacity onPress={() => router.back()}>
                <Text style={styles.footerLink}>Inicia sesión</Text>
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
