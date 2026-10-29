import React from 'react';
import { Text, TouchableOpacity, View, type TextStyle } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { parseRichText } from '@/constants/webnovel';

// Pinta el contenido de un capítulo Webnovel: un párrafo por línea, con **negrita**
// y *cursiva*. Las líneas en blanco no se pintan (el espaciado lo da paragraphSpacing).
//
// Comentarios por párrafo (como en Wattpad): si se pasa onParagraphPress, cada párrafo
// lleva a su derecha un globo con sus comentarios (casi transparente si no tiene ninguno).
export const RichText = React.memo(function RichText({ content, style, paragraphSpacing, counts, onParagraphPress, bubbleColor, mutedColor }: {
  content: string;
  style: TextStyle;
  paragraphSpacing: number;
  counts?: number[];
  onParagraphPress?: (index: number) => void;
  bubbleColor?: string;
  mutedColor?: string;
}) {
  const paragraphs = content.split('\n').filter(line => line.trim().length > 0);
  const text = (line: string, i: number, extra?: TextStyle) => (
    <Text key={i} style={[style, { marginBottom: paragraphSpacing }, extra]}>
      {parseRichText(line).map((seg, j) =>
        seg.bold || seg.italic
          ? <Text
              key={j}
              style={{
                fontWeight: seg.bold ? '700' : undefined,
                fontStyle: seg.italic ? 'italic' : undefined,
              }}
            >{seg.text}</Text>
          : seg.text
      )}
    </Text>
  );
  if (!onParagraphPress) return <View>{paragraphs.map((line, i) => text(line, i))}</View>;
  return (
    <View>
      {paragraphs.map((line, i) => {
        const n = counts?.[i] ?? 0;
        return (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            {text(line, i, { flex: 1 })}
            <TouchableOpacity
              onPress={() => onParagraphPress(i)}
              hitSlop={6}
              activeOpacity={0.6}
              style={{ width: 34, alignItems: 'center', paddingTop: 2, opacity: n > 0 ? 1 : 0.22 }}
            >
              <MaterialIcons name={n > 0 ? 'mode-comment' : 'add-comment'} size={17} color={n > 0 ? bubbleColor : mutedColor} />
              {n > 0 && (
                <Text style={{ fontSize: 10, fontWeight: '700', color: bubbleColor, marginTop: 1 }}>{n > 99 ? '99+' : n}</Text>
              )}
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
});
