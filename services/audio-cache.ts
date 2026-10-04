import * as FileSystem from 'expo-file-system';

// Caché de audio en el almacenamiento del móvil.
//
// La música de las historias está en internet: reproducirla directamente obliga a
// esperar a la red cada vez (al abrir la historia, al cambiar de capítulo). Aquí cada
// pista se guarda en un archivo la primera vez, y las siguientes se abre desde el
// móvil, que es inmediato. Es una caché: el sistema puede vaciarla si falta espacio.

const DIR = `${FileSystem.cacheDirectory ?? ''}audio/`;
const MAX_BYTES = 200 * 1024 * 1024;

let dirReady: Promise<void> | null = null;
const ensureDir = () => {
  if (!dirReady) {
    dirReady = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  }
  return dirReady;
};

// Nombre de archivo estable para una URL
function fileFor(url: string): string {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 << 5) + h2 + c * 31) | 0;
  }
  // La extensión ayuda al reproductor a reconocer el formato
  const ext = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?=$|[?#])/i.exec(url.split('?')[0])?.[1] ?? 'mp3';
  return `${DIR}${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${url.length.toString(36)}.${ext.toLowerCase()}`;
}

// Archivo local de una pista, si ya está descargada
export async function cachedAudioUri(url: string): Promise<string | null> {
  if (!FileSystem.cacheDirectory) return null;
  try {
    const info = await FileSystem.getInfoAsync(fileFor(url));
    return info.exists && (info as any).size > 0 ? info.uri : null;
  } catch {
    return null;
  }
}

// Descarga una pista (si no lo está ya) y devuelve su archivo local.
// Las descargas en curso se comparten: pedir dos veces la misma no la baja dos veces.
const downloading = new Map<string, Promise<string>>();
export function downloadAudio(url: string): Promise<string> {
  let p = downloading.get(url);
  if (!p) {
    p = (async () => {
      const cached = await cachedAudioUri(url);
      if (cached) return cached;
      if (!FileSystem.cacheDirectory) throw new Error('Sin almacenamiento de caché');
      await ensureDir();
      const target = fileFor(url);
      // Se descarga con otro nombre y se renombra al acabar: nunca se usa un archivo a medias
      const partial = `${target}.part`;
      const result = await FileSystem.downloadAsync(url, partial);
      if (result.status < 200 || result.status >= 300) {
        await FileSystem.deleteAsync(partial, { idempotent: true }).catch(() => {});
        throw new Error(`Descarga de audio fallida (${result.status})`);
      }
      await FileSystem.moveAsync({ from: partial, to: target });
      return target;
    })();
    p.then(() => downloading.delete(url), () => downloading.delete(url));
    downloading.set(url, p);
  }
  return p;
}

// Borra un archivo que no se pudo reproducir (descarga corrupta o formato no reconocido)
export function discardCachedAudio(url: string): void {
  FileSystem.deleteAsync(fileFor(url), { idempotent: true }).catch(() => {});
}

// Mantiene la caché por debajo del tamaño máximo, borrando lo más antiguo
export async function pruneAudioCache(): Promise<void> {
  if (!FileSystem.cacheDirectory) return;
  try {
    const names = await FileSystem.readDirectoryAsync(DIR);
    const files: { uri: string; size: number; time: number }[] = [];
    for (const name of names) {
      const info = await FileSystem.getInfoAsync(DIR + name);
      if (info.exists) files.push({ uri: info.uri, size: (info as any).size ?? 0, time: (info as any).modificationTime ?? 0 });
    }
    let total = files.reduce((sum, f) => sum + f.size, 0);
    files.sort((a, b) => a.time - b.time);
    for (const f of files) {
      if (total <= MAX_BYTES) break;
      await FileSystem.deleteAsync(f.uri, { idempotent: true });
      total -= f.size;
    }
  } catch {
    // La carpeta aún no existe o no se pudo leer: no hay nada que limpiar
  }
}
