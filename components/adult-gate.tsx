import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/theme';
import { ADULT_AGE, buildBirthDate } from '@/constants/age';
import { BirthDateInput, EMPTY_BIRTH_DATE } from '@/components/birth-date-input';

// Pantalla que sustituye a una historia +18 cuando el lector no puede verla:
//   · menor de edad → aviso de que no está disponible;
//   · sin fecha de nacimiento (cuentas antiguas) → se le pide una vez y se guarda.
export function AdultGate({ onBack }: { onBack: () => void }) {
  const { user, isAdult } = useAuth();
  const [birth, setBirth]   = useState(EMPTY_BIRTH_DATE);
  const [error, setError]   = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!user || saving) return;
    const birthDate = buildBirthDate(birth.day, birth.month, birth.year);
    if (!birthDate) { setError('Introduce una fecha de nacimiento válida.'); return; }
    setError('');
    setSaving(true);
    try {
      // AuthContext escucha este documento: al guardarla, la pantalla se actualiza sola
      await setDoc(doc(db, 'users', user.uid), { birthDate }, { merge: true });
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar la fecha.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <SafeAreaView edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
      </SafeAreaView>

      <View style={styles.body}>
        <View style={styles.badge}><Text style={styles.badgeText}>+18</Text></View>
        <Text style={styles.title}>Contenido para adultos</Text>

        {isAdult === false ? (
          <Text style={styles.text}>
            Esta historia solo está disponible para mayores de {ADULT_AGE} años.
          </Text>
        ) : (
          <>
            <Text style={styles.text}>
              Esta historia es para mayores de {ADULT_AGE} años. Indica tu fecha de nacimiento para continuar.
              Solo se te pedirá una vez, no se muestra a nadie y no se puede cambiar después.
            </Text>
            <BirthDateInput value={birth} onChange={setBirth} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[styles.btn, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.btnText}>Continuar</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  backBtn:   { margin: 12, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 16, paddingBottom: 80 },
  badge:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, backgroundColor: '#D9363E' },
  badgeText: { fontSize: 18, fontWeight: '800', color: '#fff' },
  title:     { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  text:      { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  error:     { fontSize: 13, color: '#FF6B6B', textAlign: 'center' },
  btn: {
    marginTop: 4, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 6,
    backgroundColor: Colors.emerald, minWidth: 160, alignItems: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '700', color: '#000' },
});
