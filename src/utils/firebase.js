import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, browserLocalPersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: 'AIzaSyDAmmBxtTbudW__pM2FWmox73s4mSMFmo4',
  authDomain: 'finovo-331f0.firebaseapp.com',
  projectId: 'finovo-331f0',
  storageBucket: 'finovo-331f0.firebasestorage.app',
  messagingSenderId: '819925698158',
  appId: '1:819925698158:web:6923f36b0951bbb85f887f',
  measurementId: 'G-T749WWYLTH'
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth crossing platforms
export const auth = initializeAuth(app, {
  persistence: Platform.OS === 'web' ? null : getReactNativePersistence(AsyncStorage)
});

// Initialize Firestore DB with long polling to bypass network restrictions
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export default app;
