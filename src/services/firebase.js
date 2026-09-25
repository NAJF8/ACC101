import { initializeApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, getAuth, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { connectDatabaseEmulator, equalTo, getDatabase, orderByChild, query, ref, set, get, push, update, remove, onValue, serverTimestamp, runTransaction } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "AIzaSyCzmUhkN29ey7B1BpexJvgh8miI2RlAn74",
  authDomain: "acc-101.firebaseapp.com",
  projectId: "acc-101",
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || "acc-101.firebasestorage.app",
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "1027289206201",
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || "1:1027289206201:web:3c58deb7fe132066723a68"
};

// Pin the app to the MASTER Firebase project in every local build. Node-only
// emulator runs may opt into an explicitly local namespace for integration tests.
const emulatorHost = typeof process !== "undefined" ? process.env.FIREBASE_EMULATOR_HOST : '';
firebaseConfig.databaseURL = emulatorHost
  ? `http://${emulatorHost}:9000?ns=${firebaseConfig.projectId}-default-rtdb`
  : "https://acc-101-default-rtdb.europe-west1.firebasedatabase.app";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Local visual QA must never fall through to production Auth or RTDB.
const localQa = Boolean(import.meta.env?.DEV) && typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
if (localQa) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
}

export { app, auth, db, ref, set, get, push, update, remove, onValue, serverTimestamp, runTransaction, onAuthStateChanged, setPersistence, browserLocalPersistence, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, query, orderByChild, equalTo };
