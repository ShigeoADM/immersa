import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Role } from '@/constants/permissions';

// Insignia de rol: bajo el nombre en los perfiles y junto al nombre en comentarios y autores.
//   DUEÑO → letra y borde celeste claro sobre un azul algo más oscuro
//   ADMIN → lo mismo en rojos
const VARIANTS: Record<Role, { label: string; light: string; dark: string }> = {
  owner: { label: 'DUEÑO', light: '#A6DEFF', dark: '#2F74A6' },
  admin: { label: 'ADMIN', light: '#FFB4B4', dark: '#A63232' },
};

export function RoleBadge({ role, size = 'md' }: {
  role: Role | null | undefined;
  size?: 'md' | 'sm'; // md: bajo el nombre del perfil · sm: en línea junto a un nombre
}) {
  if (!role) return null;
  const v = VARIANTS[role];
  const small = size === 'sm';
  return (
    <View style={[small ? styles.boxSm : styles.box, { borderColor: v.light, backgroundColor: v.dark }]}>
      <Text style={[small ? styles.textSm : styles.text, { color: v.light }]}>{v.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box:    { marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  text:   { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  boxSm:  { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1 },
  textSm: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
});
