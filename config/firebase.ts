import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, browserLocalPersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { Platform } from 'react-native';

// Proyecto de Firebase de Immersa. Quien colabore usa el suyo propio (de pruebas) poniendo
// sus datos en un archivo .env (ver .env.example y CONTRIBUTING.md): así nadie trabaja
// contra los datos reales de la web.
const env = process.env;
const firebaseConfig = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID
  ? {
      apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.EXPO_PUBLIC_FIREBASE_APP_ID,
    }
  : {
      apiKey: "AIzaSyDVHK9ID3I4jwarKkJzYIoxc9TTsnp7ipI",
      authDomain: "immersa-94cc9.firebaseapp.com",
      projectId: "immersa-94cc9",
      storageBucket: "immersa-94cc9.firebasestorage.app",
      messagingSenderId: "967534103203",
      appId: "1:967534103203:web:803f1a47d5e10cd21f0d16",
      measurementId: "G-GCVSDJ0H45",
    };

const app = initializeApp(firebaseConfig);

// En web, AsyncStorage y getReactNativePersistence no existen.
// Usamos browserLocalPersistence en web y AsyncStorage en móvil.
let auth: ReturnType<typeof getAuth>;
if (Platform.OS === 'web') {
  auth = initializeAuth(app, { persistence: browserLocalPersistence });
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
}

export { auth };
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
