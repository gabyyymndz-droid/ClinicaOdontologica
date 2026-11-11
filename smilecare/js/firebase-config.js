/**
 * firebase-config.js
 * Inicialización de Firebase (SDK v9+ modular, cargado desde CDN como ES Modules).
 * Reemplaza los valores de firebaseConfig con los de tu proyecto:
 * Consola de Firebase → Configuración del proyecto → Tus apps → SDK config.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxx",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

auth.languageCode = "es";

/** Datos de la clínica usados en mensajes y recordatorios. */
export const CLINIC_CONFIG = {
  nombre: "SmileCare Clínica Dental",
  direccion: "Col. Escalón, San Salvador",
  telefono: "2222-2222",
  codigoPais: "503", // El Salvador. Se antepone a números locales de 8 dígitos.
};
