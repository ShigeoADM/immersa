import React from 'react';
import { Text, View } from 'react-native';

// Versión web del texto con borde. En el móvil se dibuja con Skia (outline-text.tsx);
// en el navegador basta el trazo de texto de CSS, sin cargar ningún motor gráfico.
// "paint-order: stroke fill" pinta el trazo debajo del relleno, de modo que el borde
// queda por fuera de la letra en vez de comérsela.

export type OutlineSegment = {
  text: string;
  color?: string;
  outlineColor?: string;
  bold?: boolean;
  underline?: boolean;
  onPress?: (pageX: number, pageY: number) => void;
};

export type OutlineStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontWeight?: number;
  color: string;
  outlineColor?: string;
  outlineWidth?: number;
};

type Props = {
  segments: OutlineSegment[];
  style: OutlineStyle;
  inline?: boolean;
};

export function OutlineText({ segments, style, inline }: Props) {
  const outlineWidth = style.outlineWidth ?? 2;
  const stroke = (color: string) => ({
    WebkitTextStroke: `${outlineWidth * 2}px ${color}`,
    paintOrder: 'stroke fill',
  } as any);

  const text = (
    <Text
      style={[
        {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          fontWeight: String(style.fontWeight ?? 400) as any,
          color: style.color,
        },
        stroke(style.outlineColor ?? '#000'),
      ]}
    >
      {segments.map((seg, i) =>
        seg.color || seg.outlineColor || seg.bold || seg.underline || seg.onPress
          ? (
            <Text
              key={i}
              style={[
                seg.color ? { color: seg.color } : null,
                seg.bold ? { fontWeight: '900' as const } : null,
                seg.underline ? { textDecorationLine: 'underline' as const } : null,
                seg.outlineColor ? stroke(seg.outlineColor) : null,
                seg.onPress ? ({ cursor: 'pointer' } as any) : null,
              ]}
              onPress={seg.onPress
                ? (e: any) => {
                    e.stopPropagation?.();
                    seg.onPress!(e.nativeEvent.pageX ?? 0, e.nativeEvent.pageY ?? 0);
                  }
                : undefined}
            >{seg.text}</Text>
          )
          : seg.text,
      )}
    </Text>
  );

  // El margen deja sitio al borde de las letras de los extremos
  return inline
    ? <View style={{ paddingHorizontal: outlineWidth, paddingVertical: outlineWidth }}>{text}</View>
    : <View style={{ width: '100%', paddingHorizontal: outlineWidth + 1 }}>{text}</View>;
}
