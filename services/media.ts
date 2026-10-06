import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/config/firebase';

// Sube un archivo local (uri de ImagePicker / DocumentPicker) a Storage y devuelve su URL.
// La lectura del archivo se corta si tarda demasiado, para no dejar la subida colgada.
export async function uploadLocalFile(localUri: string, storagePath: string, timeoutMs = 30000): Promise<string> {
  const blob: Blob = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload    = () => resolve(xhr.response);
    xhr.onerror   = () => reject(new Error('No se pudo leer el archivo'));
    xhr.ontimeout = () => reject(new Error('Tiempo de espera agotado al leer el archivo'));
    xhr.responseType = 'blob';
    xhr.timeout = timeoutMs;
    xhr.open('GET', localUri, true);
    xhr.send(null);
  });
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}

// ¿Es un archivo subido a nuestro almacenamiento? (Los enlaces externos, como los de
// Drive, no se pueden ni se deben borrar.)
export function isStoredFile(url?: string | null): url is string {
  return !!url && url.includes('firebasestorage.googleapis.com') && url.includes('/o/');
}

// Borra un archivo subido. Si ya no existe o no hay permiso, no pasa nada.
export async function deleteStoredFile(url: string): Promise<void> {
  if (!isStoredFile(url)) return;
  try {
    await deleteObject(ref(storage, url));
  } catch { /* ya borrado, o sin permiso */ }
}

// Ruta de un archivo dentro del almacenamiento ("music/abc/def/123_tema.mp3") a partir de
// su dirección de descarga. Un enlace externo, o una ruta, se devuelven tal cual.
export function storagePathOf(urlOrPath: string): string {
  if (!isStoredFile(urlOrPath)) return urlOrPath;
  try {
    return decodeURIComponent(urlOrPath.split('/o/')[1].split('?')[0]);
  } catch { return urlOrPath; }
}

// Identificador corto y estable de un archivo: sirve de clave para guardar su nombre en
// la historia. Sale de la ruta, no de la dirección entera (que lleva un token que puede
// cambiar), así que vale igual para la dirección de descarga que para la ruta.
export function mediaKey(urlOrPath: string): string {
  const path = storagePathOf(urlOrPath);
  let a = 5381, b = 52711;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    a = ((a * 33) ^ c) >>> 0;
    b = ((b * 31) + c) >>> 0;
  }
  return `m${a.toString(36)}${b.toString(36)}`;
}

// Nombre de un archivo tal como se subió: sin la carpeta y sin la marca de tiempo que
// se le antepone al guardarlo.
export function plainFileName(url: string, fallback: string): string {
  try {
    const path = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? '');
    const name = (path.split('/').pop() ?? '').replace(/^\d{10,}_/, '');
    return name || fallback;
  } catch { return fallback; }
}

// Nombres que el autor ha puesto a sus archivos en el gestor de archivos (se guardan en
// la historia, en mediaNames). Se recuerdan aquí para enseñarlos en los editores.
let customNames: Record<string, string> = {};
export function rememberMediaNames(names?: Record<string, string> | null) {
  customNames = names ?? {};
}
// Nombre para mostrar: el que le puso el autor o, si no, el del archivo
export function mediaDisplayName(url: string, fallback: string): string {
  return customNames[mediaKey(url)] ?? plainFileName(url, fallback);
}
