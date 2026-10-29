import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type ReplyTarget, type StoryComment, toThreads } from '@/services/comments';
import { ts, useT } from '@/i18n';

// Comentarios en hilos: cada comentario con sus respuestas debajo, sangradas. Si un hilo
// tiene muchas respuestas, se enseñan las primeras y un enlace para ver el resto.
// Cada pantalla decide cómo pintar un comentario (renderComment) para conservar sus
// colores, sus permisos de borrar y denunciar, etc.
const VISIBLE_REPLIES = 3;

export function CommentThreads({ comments, renderComment, mutedColor, accentColor }: {
  comments: StoryComment[];
  renderComment: (c: StoryComment, isReply: boolean) => React.ReactNode;
  mutedColor: string;
  accentColor: string;
}) {
  useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <View>
      {toThreads(comments).map(({ comment, replies }) => {
        const all = open[comment.id] || replies.length <= VISIBLE_REPLIES;
        const shown = all ? replies : replies.slice(0, VISIBLE_REPLIES);
        const hidden = replies.length - shown.length;
        return (
          <View key={comment.id}>
            {renderComment(comment, false)}
            {replies.length > 0 && (
              <View style={[styles.replies, { borderLeftColor: mutedColor + '40' }]}>
                {shown.map(r => <View key={r.id}>{renderComment(r, true)}</View>)}
                {hidden > 0 && (
                  <TouchableOpacity onPress={() => setOpen(o => ({ ...o, [comment.id]: true }))} hitSlop={6} style={styles.more}>
                    <Text style={[styles.moreText, { color: accentColor }]}>
                      {hidden === 1 ? ts('Ver 1 respuesta más') : ts('Ver {n} respuestas más', { n: hidden })}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// Aviso encima de la caja de escribir: «Respondiendo a Nombre ✕»
export function ReplyingTo({ target, onCancel, color, mutedColor }: {
  target: ReplyTarget | null;
  onCancel: () => void;
  color: string;
  mutedColor: string;
}) {
  useT();
  if (!target) return null;
  return (
    <View style={styles.replying}>
      <MaterialIcons name="reply" size={14} color={mutedColor} />
      <Text style={[styles.replyingText, { color }]} numberOfLines={1}>
        {ts('Respondiendo a {name}', { name: target.name })}
      </Text>
      <TouchableOpacity onPress={onCancel} hitSlop={8}>
        <MaterialIcons name="close" size={15} color={mutedColor} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  replies:      { marginLeft: 22, paddingLeft: 12, borderLeftWidth: 1 },
  more:         { paddingVertical: 6 },
  moreText:     { fontSize: 12, fontWeight: '700' },
  replying:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: 6 },
  replyingText: { flex: 1, fontSize: 12 },
});
