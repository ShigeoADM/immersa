// Comentarios de una novela: stories/{storyId}/comments/{id}.
// Cada comentario pertenece a una página (Moderno) o a un capítulo (Webnovel). Guarda el
// número de capítulo y de página del momento en que se escribió (para mostrar
// "Cap. 1 · Pág. 3" sin lecturas extra) y el nombre y avatar de quien lo escribió.
//
// Respuestas: un solo nivel, como en Wattpad. Una respuesta apunta al comentario con el
// que empieza el hilo (replyTo) y guarda a qué comentario contesta (replyToId: el del hilo
// u otra respuesta) y su autor (replyToUid / replyToName). ancestorUids son los autores de
// toda la cadena hacia arriba: pueden borrarla (al borrar su comentario, con él se van
// todas las respuestas que cuelgan de él).
//
// Comentarios de párrafo (Webnovel): paragraph es el número de párrafo y paragraphKey una
// huella de su texto, para encontrarlo aunque el autor añada o quite párrafos antes.

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { notifyUser } from '@/services/notifications';

export const COMMENT_MAX_LENGTH = 500;

export interface StoryComment {
  id: string;
  uid: string;
  userName: string;
  userAvatar: string;
  text: string;
  createdAt: string; // ISO
  chapterId: string;
  pageId: string;
  chapterNumber: number;
  pageNumber: number;
  replyTo?: string;      // id del comentario con el que empieza el hilo
  replyToUid?: string;   // a quién responde
  replyToName?: string;
  replyToId?: string;    // comentario exacto al que responde
  ancestorUids?: string[];
  paragraph?: number;    // Webnovel: párrafo comentado
  paragraphKey?: string;
}

// Huella corta del texto de un párrafo (sin marcas de formato ni espacios de más)
export function paragraphKey(text: string): string {
  const t = text.replace(/\*+/g, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 300);
  let a = 5381, b = 52711;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = ((a * 33) ^ c) >>> 0; b = ((b * 31) + c) >>> 0; }
  return `${a.toString(36)}${b.toString(36)}`;
}

// Hilos: los comentarios que empiezan un hilo (más nuevos primero) con sus respuestas
// (más antiguas primero). Una respuesta cuyo hilo ya no existe se muestra como hilo propio.
export type CommentThread = { comment: StoryComment; replies: StoryComment[] };
export function toThreads(comments: StoryComment[]): CommentThread[] {
  const roots = new Map<string, CommentThread>();
  for (const c of comments) if (!c.replyTo) roots.set(c.id, { comment: c, replies: [] });
  const orphans: CommentThread[] = [];
  for (const c of comments) {
    if (!c.replyTo) continue;
    const root = roots.get(c.replyTo);
    if (root) root.replies.push(c); else orphans.push({ comment: c, replies: [] });
  }
  const threads = [...roots.values(), ...orphans];
  threads.forEach(t => t.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  return threads.sort((a, b) => b.comment.createdAt.localeCompare(a.comment.createdAt));
}

// A quién se responde: el hilo y la persona (el autor del hilo o el de una respuesta)
export type ReplyTarget = { rootId: string; commentId: string; uid: string; name: string; ancestorUids: string[] };
export const replyTargetFor = (c: StoryComment): ReplyTarget => ({
  rootId: c.replyTo ?? c.id, commentId: c.id, uid: c.uid, name: c.userName,
  ancestorUids: [...new Set([...(c.ancestorUids ?? []), c.uid])].slice(-20),
});

// Comentario del que cuelga una respuesta (las antiguas, sin replyToId, cuelgan del hilo)
const parentOf = (c: StoryComment) => c.replyToId ?? c.replyTo;

// Respuestas que cuelgan de un comentario, a cualquier profundidad, dentro de una lista
export function descendantsOf(comments: StoryComment[], id: string): StoryComment[] {
  const out: StoryComment[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const c of comments) {
      if (c.replyTo && parentOf(c) === cur && !out.includes(c)) { out.push(c); queue.push(c.id); }
    }
  }
  return out;
}

const commentsCol = (storyId: string) => collection(db, 'stories', storyId, 'comments');
const toComment = (d: any): StoryComment => ({ id: d.id, ...(d.data() as Omit<StoryComment, 'id'>) });
const newestFirst = (a: StoryComment, b: StoryComment) => b.createdAt.localeCompare(a.createdAt);

// Comentarios de un capítulo (el lector los carga una vez y los reparte por página)
export async function listChapterComments(storyId: string, chapterId: string): Promise<StoryComment[]> {
  const snap = await getDocs(query(commentsCol(storyId), where('chapterId', '==', chapterId)));
  return snap.docs.map(toComment).sort(newestFirst);
}

// Últimos comentarios de toda la novela
export async function listStoryComments(storyId: string, max = 50): Promise<StoryComment[]> {
  const snap = await getDocs(query(commentsCol(storyId), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map(toComment);
}

export async function addComment(
  storyId: string,
  comment: Omit<StoryComment, 'id' | 'createdAt' | 'replyTo' | 'replyToUid' | 'replyToName' | 'replyToId' | 'ancestorUids'>,
  story: { authorUid?: string | null; title?: string },
  reply?: ReplyTarget | null,
): Promise<StoryComment> {
  const data: Omit<StoryComment, 'id'> = {
    ...comment,
    text: comment.text.trim(),
    createdAt: new Date().toISOString(),
    ...(reply ? {
      replyTo: reply.rootId, replyToId: reply.commentId, replyToUid: reply.uid,
      replyToName: reply.name.slice(0, 60), ancestorUids: reply.ancestorUids,
    } : {}),
  };
  // Sin campos vacíos: Firestore no los admite
  Object.keys(data).forEach(k => (data as any)[k] === undefined && delete (data as any)[k]);
  const ref = await addDoc(commentsCol(storyId), data);
  const preview = `${data.userName}: ${data.text.length > 90 ? data.text.slice(0, 90) + '…' : data.text}`;

  // Aviso a quien se responde (si no es uno mismo)
  if (reply) {
    notifyUser(reply.uid, {
      type: 'reply',
      title: `Nueva respuesta en "${story.title ?? 'tu novela'}"`,
      tx: { title: 'Nueva respuesta en "{story}"', p: { story: story.title ?? '' } },
      body: preview,
      storyId,
      commentId: reply.commentId,
    }).catch(e => console.error('Error avisando de la respuesta:', e));
  }

  // Aviso al autor de la novela (notifyUser no avisa si comenta el propio autor). Si la
  // respuesta es para él, ya le ha llegado el aviso de respuesta.
  if (story.authorUid && story.authorUid !== reply?.uid) {
    notifyUser(story.authorUid, {
      type: 'comment',
      title: `Nuevo comentario en "${story.title ?? 'tu novela'}"`,
      tx: { title: 'Nuevo comentario en "{story}"', p: { story: story.title ?? '' } },
      body: preview,
      storyId,
    }).catch(e => console.error('Error avisando al autor del comentario:', e));
  }
  return { id: ref.id, ...data };
}

// Borra un comentario y todas las respuestas que cuelgan de él, a cualquier profundidad
// (el de un hilo se lleva el hilo entero). Primero las respuestas y al final el
// comentario, que es lo que permite a las reglas comprobar quién empezó el hilo.
// Devuelve los ids borrados, para quitarlos de la pantalla.
export async function deleteComment(storyId: string, commentId: string): Promise<string[]> {
  const ref = doc(db, 'stories', storyId, 'comments', commentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [commentId];
  const c = toComment(snap);
  const rootId = c.replyTo ?? c.id;
  const thread = (await getDocs(query(commentsCol(storyId), where('replyTo', '==', rootId)))).docs.map(toComment);
  const doomed = descendantsOf(thread, c.id);
  await Promise.all(doomed.map(r => deleteDoc(doc(db, 'stories', storyId, 'comments', r.id))));
  await deleteDoc(ref);
  return [c.id, ...doomed.map(r => r.id)];
}
