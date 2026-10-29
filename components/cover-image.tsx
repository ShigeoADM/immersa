import React, { useEffect, useState } from 'react';
import { StyleSheet, type ImageStyle, type StyleProp } from 'react-native';
import { Image } from 'expo-image';

// Portada de una tarjeta. Prueba las imágenes en orden (la miniatura y, si falla, la
// portada completa) y, si ninguna carga (no hay, o el archivo se borró del almacenamiento),
// muestra `fallback`: la tarjeta queda igual que la de una historia sin portada.
export function CoverImage({ sources, fallback, style = StyleSheet.absoluteFill }: {
  sources: (string | null | undefined)[];
  fallback: React.ReactElement;
  style?: StyleProp<ImageStyle>;
}) {
  const list = sources.filter((s): s is string => !!s);
  const key = list.join('|');
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [key]);
  if (index >= list.length) return fallback;
  return (
    <Image
      source={{ uri: list[index] }}
      style={style}
      contentFit="cover"
      transition={150}
      onError={() => setIndex(i => i + 1)}
    />
  );
}
