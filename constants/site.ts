import { Platform } from 'react-native';

// Immersa tiene dos webs con el mismo contenido y las mismas cuentas:
//   · la pública, la que usa todo el mundo;
//   · la de desarrollo, donde se prueban las novedades antes de publicarlas. Solo entran
//     las cuentas con el permiso 'developer' (ver components/dev-site.tsx).
// Las dos leen y escriben en la misma base de datos: lo que se crea o se borra en la de
// desarrollo es real.
export const PROD_SITE_URL = 'https://immersa.web.app';
export const DEV_SITE_URL = 'https://immersa-94cc9.web.app';

const DEV_HOSTS = ['immersa-94cc9.web.app', 'immersa-94cc9.firebaseapp.com'];

// ¿Se está viendo la web de desarrollo?
export const IS_DEV_SITE = Platform.OS === 'web'
  && DEV_HOSTS.includes(((globalThis as any).location?.hostname ?? '') as string);

// Versión publicada (la escribe scripts/deploy.mjs): "a1b2c3d · 7 oct 14:32"
export const BUILD_LABEL = process.env.EXPO_PUBLIC_BUILD ?? '';
