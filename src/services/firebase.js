import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getDatabase, ref, set, get, push, update, remove, onValue, serverTimestamp } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCzmUhkN29ey7B1BpexJvgh8miI2RlAn74",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "acc-101.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "acc-101",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "acc-101.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "1027289206201",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:1027289206201:web:3c58deb7fe132066723a68"
};

const dbUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL;
if (dbUrl) {
  firebaseConfig.databaseURL = dbUrl;
} else {
  firebaseConfig.databaseURL = "https://acc-101-default-rtdb.firebaseio.com";
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export { app, auth, db, ref, set, get, push, update, remove, onValue, serverTimestamp, onAuthStateChanged, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup };
