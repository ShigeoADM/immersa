import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '@/constants/theme';
import { LANGUAGES, setLang, useLang } from '@/i18n';

// Selector de idioma de la web: tres botones, uno por idioma. Se usa donde no llega el de
// la barra superior de escritorio (pantalla de acceso, ajustes).
export function LanguagePicker({ compact }: { compact?: boolean }) {
  const lang = useLang();
  return (
    <View style={[styles.row, compact && { justifyContent: 'center' }]}>
      {LANGUAGES.map(l => (
        <TouchableOpacity
          key={l.key}
          style={[styles.chip, compact && styles.chipCompact, l.key === lang && styles.chipActive]}
          onPress={() => setLang(l.key)}
          activeOpacity={0.75}
        >
          <Text style={[styles.text, compact && { fontSize: 12 }, l.key === lang && styles.textActive]}>{l.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  chipCompact: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6 },
  chipActive: { borderColor: Colors.emerald, backgroundColor: Colors.emerald + '18' },
  text: { fontSize: 14, color: Colors.textSecondary },
  textActive: { color: Colors.emerald, fontWeight: '700' },
});
