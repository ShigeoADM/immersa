// Eliminar la cuenta del usuario y sus datos.

import { EmailAuthProvider, deleteUser, reauthenticateWithCredential } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { deleteStoryWithCascade } from '@/services/stories';
import { setChapterLike, setFollow, setLike } from '@/services/social';

// Borra todo lo que hay en una subcolección del usuario
async function clearCollection(path: string) {
  const snap = await getDocs(collection(db, path));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
}

// Elimina la cuenta: historias (avisando a sus lectores), me gusta, seguimientos,
// biblioteca, notificaciones, perfil y, por último, el acceso.
// Pide la contraseña porque Firebase exige una autenticación reciente para borrar.
// Los comentarios dejados en historias de otras personas no se borran.
export async function deleteAccount(password: string) {
  const user = auth.currentUser;
  if (!user || !user.email) throw new Error('No hay ninguna sesión iniciada.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));

  const uid = user.uid;
  const me = { uid, name: user.displayName ?? '' };
  const quietly = (p: Promise<unknown>) => p.catch(() => {}); // un fallo suelto no detiene el borrado

  // 1. Sus historias, con sus capítulos, páginas y comentarios
  const stories = await getDocs(query(collection(db, 'stories'), where('uid', '==', uid)));
  for (const s of stories.docs) await quietly(deleteStoryWithCascade(s.id, 'author'));

  // 2. Lo que dejó en historias y perfiles de otros: me gusta, seguimientos y marcas de lectura
  const [liked, following, library, followers] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'likedStories')),
    getDocs(collection(db, 'users', uid, 'following')),
    getDocs(collection(db, 'users', uid, 'library')),
    getDocs(collection(db, 'profiles', uid, 'followers')),
  ]);
  await Promise.all([
    ...liked.docs.flatMap(d => {
      const chapters: string[] = Array.isArray(d.data().chapters) ? d.data().chapters : [];
      return chapters.length
        ? chapters.map(ch => quietly(setChapterLike(d.id, ch, false, me, {})))
        : [quietly(setLike(d.id, false, me, {}))]; // formato antiguo: un me gusta por historia
    }),
    ...following.docs.map(d => quietly(setFollow(me, d.id, false))),
    ...library.docs.flatMap(d => [
      quietly(deleteDoc(doc(db, 'stories', d.id, 'readers', uid))),
      quietly(deleteDoc(doc(db, 'stories', d.id, 'saves', uid))),
    ]),
    ...followers.docs.map(d => quietly(deleteDoc(d.ref))),
  ]);

  // 3. Sus datos privados y su perfil público
  await Promise.all(
    ['library', 'notifications', 'following', 'likedStories'].map(sub => quietly(clearCollection(`users/${uid}/${sub}`))),
  );
  await quietly(deleteDoc(doc(db, 'profiles', uid)));
  await quietly(deleteDoc(doc(db, 'users', uid)));

  // 4. El acceso (a partir de aquí la sesión deja de existir)
  await deleteUser(user);
}
