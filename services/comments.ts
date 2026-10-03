// Comentarios de una novela: stories/{storyId}/comments/{id}.
// Cada comentario pertenece a una página. Guarda el número de capítulo y de página del
// momento en que se escribió (para mostrar "Cap. 1 · Pág. 3" sin lecturas extra) y el
// nombre y avatar del autor del comentario.

import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, where,
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
  comment: Omit<StoryComment, 'id' | 'createdAt'>,
  story: { authorUid?: string | null; title?: string },
): Promise<StoryComment> {
  const data = { ...comment, text: comment.text.trim(), createdAt: new Date().toISOString() };
  const ref = await addDoc(commentsCol(storyId), data);

  // Aviso al autor de la novela (notifyUser no avisa si comenta el propio autor)
  if (story.authorUid) {
    notifyUser(story.authorUid, {
      type: 'comment',
      title: `Nuevo comentario en "${story.title ?? 'tu novela'}"`,
      body: `${data.userName}: ${data.text.length > 90 ? data.text.slice(0, 90) + '…' : data.text}`,
      storyId,
    }).catch(e => console.error('Error avisando al autor del comentario:', e));
  }
  return { id: ref.id, ...data };
}

export const deleteComment = (storyId: string, commentId: string) =>
  deleteDoc(doc(db, 'stories', storyId, 'comments', commentId));
