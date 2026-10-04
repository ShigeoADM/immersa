import React from 'react';
import { Text, View } from 'react-native';

// Versión web del texto con borde. En el móvil se dibuja con Skia (outline-text.tsx);
// en el navegador se hace con sombras de texto de CSS, sin cargar ningún motor gráfico.
//
// El borde son muchas sombras nítidas repartidas en círculo alrededor de la letra, que
// juntas forman un contorno redondeado. Antes se usaba el trazo de texto de CSS
// (-webkit-text-stroke), pero une las esquinas en pico y dejaba puntas en letras como
// la A o la M.

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

// Sombras en dos anillos: el exterior marca el borde y el interior rellena el hueco
// entre el borde y la letra cuando el borde es grueso.
const RING = 24;
const shadowCache = new Map<string, string>();
function outlineShadow(width: number, color: string): string {
  const key = `${width.toFixed(2)}|${color}`;
  let css = shadowCache.get(key);
  if (!css) {
    const parts: string[] = [];
    for (const radius of [width, width / 2]) {
      for (let i = 0; i < RING; i++) {
        const angle = (i / RING) * Math.PI * 2;
        parts.push(`${(Math.cos(angle) * radius).toFixed(2)}px ${(Math.sin(angle) * radius).toFixed(2)}px 0 ${color}`);
      }
    }
    css = parts.join(', ');
    shadowCache.set(key, css);
  }
  return css;
}

type Props = {
  segments: OutlineSegment[];
  style: OutlineStyle;
  inline?: boolean;
};

export function OutlineText({ segments, style, inline }: Props) {
  const outlineWidth = style.outlineWidth ?? 2;
  const stroke = (color: string) => ({ textShadow: outlineShadow(outlineWidth, color) } as any);

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
