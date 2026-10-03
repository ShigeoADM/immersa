import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
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
