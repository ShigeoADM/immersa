import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useIsFounder } from '@/services/founders';
import { ts, useT } from '@/i18n';

// Insignia de autor fundador: como la de rol, en dorado. Solo sale si el dueño de Immersa
// se la ha dado a ese usuario (services/founders.ts).
const LIGHT = '#FFD98A';
const DARK = '#7A5A14';

export function FounderBadge({ uid, size = 'md' }: { uid?: string | null; size?: 'md' | 'sm' }) {
  useT();
  if (!useIsFounder(uid)) return null;
  const small = size === 'sm';
  return (
    <View style={[small ? styles.boxSm : styles.box, { borderColor: LIGHT, backgroundColor: DARK }]}>
      <Text style={[small ? styles.textSm : styles.text, { color: LIGHT }]}>{ts('FUNDADOR')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box:    { marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  text:   { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  boxSm:  { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1 },
  textSm: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
});
