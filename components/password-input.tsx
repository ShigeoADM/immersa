import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, type TextInputProps } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Colors } from '@/constants/theme';

// Campo de contraseña con el botón de "mostrar contraseña" (el ojo) a la derecha.
// Se usa igual que un TextInput; por defecto el texto va oculto.
export function PasswordInput({ style, ...props }: TextInputProps) {
  const [visible, setVisible] = useState(false);
  // Los márgenes del estilo pasan al contenedor, para que el ojo quede centrado en el campo
  const { margin, marginTop, marginBottom, marginLeft, marginRight, marginVertical, marginHorizontal, ...inputStyle }
    = (StyleSheet.flatten(style) ?? {}) as any;
  return (
    <View style={{ margin, marginTop, marginBottom, marginLeft, marginRight, marginVertical, marginHorizontal, justifyContent: 'center' }}>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[inputStyle, styles.input]}
        secureTextEntry={!visible}
      />
      <TouchableOpacity
        style={styles.eye}
        onPress={() => setVisible(v => !v)}
        activeOpacity={0.7}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        <MaterialIcons name={visible ? 'visibility-off' : 'visibility'} size={20} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { paddingRight: 46 },
  eye: { position: 'absolute', right: 6, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
