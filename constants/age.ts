// Edad de los usuarios: mínima para tener cuenta y mayoría de edad para el contenido +18.
// La fecha de nacimiento se guarda en users/{uid}.birthDate ('AAAA-MM-DD'), que es privado.

export const MIN_AGE = 14;    // edad mínima para registrarse
export const ADULT_AGE = 18;  // edad para ver contenido +18

// Devuelve 'AAAA-MM-DD' si día/mes/año forman una fecha real y pasada; si no, null.
export function buildBirthDate(day: string, month: string, year: string): string | null {
  const d = Number(day), m = Number(month), y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  // new Date corrige fechas imposibles (31 de febrero → marzo): se comprueba que no cambió
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  if (date.getTime() > Date.now()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Años cumplidos a día de hoy
export function ageOf(birthDate: string, now = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

// true / false según la fecha de nacimiento; null si todavía no se conoce
export const isAdultFrom = (birthDate?: string | null): boolean | null =>
  birthDate ? ageOf(birthDate) >= ADULT_AGE : null;
