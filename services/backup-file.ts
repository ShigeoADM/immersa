import { ts } from '@/i18n';

// Avisos pensados para enseñarse tal cual a quien importa una copia
export class BackupError extends Error { name = 'BackupError'; }

// Archivo de copia de seguridad de una historia (.immersa).
//
// Por dentro son los mismos datos que antes se exportaban en .json, pero comprimidos y
// revueltos para que el archivo no se pueda abrir y leer con un editor de texto.
//
// Esto es discreción, no seguridad: la forma de leerlo está aquí mismo, en la web. Lo que
// de verdad protege una historia es que solo su autor puede exportarla.
//
// Formato: "IMMERSA" + 1 byte de versión + contenido
//   versión 1: JSON → gzip → revuelto
//   versión 2: JSON → revuelto (navegadores que no saben comprimir)
// Al importar se siguen aceptando los .json antiguos.

export const BACKUP_EXTENSION = 'immersa';

const MAGIC = [0x49, 0x4d, 0x4d, 0x45, 0x52, 0x53, 0x41]; // "IMMERSA"
const KEY = [0x9e, 0x37, 0x79, 0xb9, 0x7f, 0x4a, 0x7c, 0x15, 0xf3, 0x9c, 0xc0, 0x60, 0x5c, 0xed, 0xc8, 0x34, 0x1b];

// Revolver y desrevolver son la misma operación
function scramble(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ KEY[i % KEY.length] ^ (i & 0xff);
  return out;
}

async function pipe(bytes: Uint8Array, stream: any): Promise<Uint8Array> {
  const g = globalThis as any;
  const result = new g.Response(new g.Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await result.arrayBuffer());
}

export async function encodeBackup(data: unknown): Promise<Uint8Array> {
  const g = globalThis as any;
  const json: Uint8Array = new g.TextEncoder().encode(JSON.stringify(data));
  let version = 2;
  let body = json;
  if (typeof g.CompressionStream === 'function') {
    try {
      body = await pipe(json, new g.CompressionStream('gzip'));
      version = 1;
    } catch { /* sin comprimir */ }
  }
  const scrambled = scramble(body);
  const file = new Uint8Array(MAGIC.length + 1 + scrambled.length);
  file.set(MAGIC, 0);
  file[MAGIC.length] = version;
  file.set(scrambled, MAGIC.length + 1);
  return file;
}

export async function decodeBackup(buffer: ArrayBuffer): Promise<any> {
  const g = globalThis as any;
  const bytes = new Uint8Array(buffer);
  const isBackup = bytes.length > MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
  // Copia antigua: un .json tal cual
  if (!isBackup) return JSON.parse(new g.TextDecoder().decode(bytes));

  const version = bytes[MAGIC.length];
  let body = scramble(bytes.subarray(MAGIC.length + 1));
  if (version === 1) {
    if (typeof g.DecompressionStream !== 'function') {
      throw new BackupError(ts('Este navegador no puede abrir la copia. Prueba con uno más reciente.'));
    }
    body = await pipe(body, new g.DecompressionStream('gzip'));
  } else if (version !== 2) {
    throw new BackupError(ts('Esta copia es de una versión más nueva de Immersa.'));
  }
  return JSON.parse(new g.TextDecoder().decode(body));
}
