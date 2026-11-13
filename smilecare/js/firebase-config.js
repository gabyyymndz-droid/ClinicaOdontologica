/**
 * firebase-config.js
 * Inicialización de Firebase (SDK v9+ modular, cargado desde CDN como ES Modules).
 * Reemplaza los valores de firebaseConfig con los de tu proyecto:
 * Consola de Firebase → Configuración del proyecto → Tus apps → SDK config.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCHL8E4FV9Fn0AJCpOi3VRX1KGiGybHm2Q",
  authDomain: "smilecare-24006.firebaseapp.com",
  projectId: "smilecare-24006",
  storageBucket: "smilecare-24006.firebasestorage.app",
  messagingSenderId: "919717139935",
  appId: "1:919717139935:web:e2008b70ecafde2175606a",
  measurementId: "G-J9HHQBG4ZJ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/** Datos de la clínica usados en mensajes y recordatorios. */
export const CLINIC_CONFIG = {
  nombre: "SmileCare Clínica Dental",
  direccion: "Col. Escalón, San Salvador",
  telefono: "2222-2222",
  codigoPais: "503", // El Salvador. Se antepone a números locales de 8 dígitos.
};
