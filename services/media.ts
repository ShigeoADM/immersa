import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { Platform } from 'react-native';
import { storage } from '@/config/firebase';

// Lee un archivo local (uri de ImagePicker / DocumentPicker). La lectura se corta si
// tarda demasiado, para no dejar la subida colgada.
function readLocalFile(localUri: string, timeoutMs: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload    = () => resolve(xhr.response);
    xhr.onerror   = () => reject(new Error('No se pudo leer el archivo'));
    xhr.ontimeout = () => reject(new Error('Tiempo de espera agotado al leer el archivo'));
    xhr.responseType = 'blob';
    xhr.timeout = timeoutMs;
    xhr.open('GET', localUri, true);
    xhr.send(null);
  });
}

// Sube un archivo local a Storage y devuelve su URL.
export async function uploadLocalFile(localUri: string, storagePath: string, timeoutMs = 30000): Promise<string> {
  const blob = await readLocalFile(localUri, timeoutMs);
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob);
  return getDownloadURL(storageRef);
}

// ── Imágenes: se aligeran antes de subirlas ──────────────────────────────────
// Una foto recién sacada de un programa de dibujo o de una cámara pesa varias veces más
// de lo que hace falta para verse igual. Antes de subirla:
//  · si es más grande de lo que ninguna pantalla va a enseñar, se reduce (`maxSide` es el
//    lado largo máximo, en píxeles);
//  · se guarda en WebP a calidad alta, que a la vista no se distingue del original.
// Si el resultado no pesa claramente menos, se sube el original tal cual. Los GIF (pueden
// estar animados) y los SVG no se tocan.
//
// Se hace en el navegador. En el móvil, el selector de imágenes ya las recomprime.
const IMAGE_QUALITY = 0.9;

async function optimizeImage(blob: Blob, maxSide: number): Promise<Blob> {
  if (Platform.OS !== 'web') return blob;
  if (!/^image\/(jpeg|png|webp|bmp)$/.test(blob.type)) return blob;
  const g = globalThis as any;
  const src = g.URL.createObjectURL(blob);
  try {
    const img: any = await new Promise((resolve, reject) => {
      const el = new g.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('imagen ilegible'));
      el.src = src;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return blob;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = g.document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const encode = (type: string): Promise<Blob | null> =>
      new Promise(resolve => canvas.toBlob(resolve, type, IMAGE_QUALITY));
    let out = await encode('image/webp');
    // Navegador que no sabe guardar WebP (devuelve otra cosa): JPEG, pero solo si el
    // original ya lo era (un PNG puede tener transparencia, y el JPEG la perdería)
    if (!out || out.type !== 'image/webp') out = blob.type === 'image/jpeg' ? await encode('image/jpeg') : null;
    // Solo compensa si ahorra de verdad
    return out && out.size < blob.size * 0.9 ? out : blob;
  } catch {
    return blob; // ante cualquier problema, se sube el original
  } finally {
    g.URL.revokeObjectURL(src);
  }
}

const IMAGE_EXT: Record<string, string> = {
  'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
};

// Sube una imagen, aligerándola antes. `pathNoExt` es la ruta sin extensión: se le añade
// la que corresponda al formato final.
export async function uploadImage(localUri: string, pathNoExt: string, maxSide: number, timeoutMs = 30000): Promise<string> {
  const blob = await optimizeImage(await readLocalFile(localUri, timeoutMs), maxSide);
  const storageRef = ref(storage, `${pathNoExt}.${IMAGE_EXT[blob.type] ?? 'jpg'}`);
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
