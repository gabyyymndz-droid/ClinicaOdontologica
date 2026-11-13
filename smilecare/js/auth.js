/**
 * auth.js
 * Login, cierre de sesión, carga del perfil/rol desde Firestore (users/{uid})
 * y guardias de navegación por rol y por permiso.
 */
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ------------------------------------------------------------------ */
/* Roles y permisos                                                    */
/* ------------------------------------------------------------------ */
export const ROLES = Object.freeze({ DOCTOR: "doctor", SECRETARIA: "secretaria" });

export const ROLE_LABELS = Object.freeze({
  [ROLES.DOCTOR]: "Doctor Principal",
  [ROLES.SECRETARIA]: "Secretaria",
});

function normalizeRole(role) {
  return role === "secretary" ? ROLES.SECRETARIA : role;
}

/** La lectura de pacientes, historial y citas está permitida a ambos roles. */
const PERMISSIONS = Object.freeze({
  [ROLES.DOCTOR]: [
    "patients:create", "patients:update", "patients:delete",
    "consultations:create", "consultations:delete",
    "appointments:create", "appointments:update", "appointments:delete",
    "reminders:send",
  ],
  [ROLES.SECRETARIA]: [
    "patients:create",
    "appointments:create", "appointments:update",
    "reminders:send",
  ],
});

/** Vistas de la SPA y roles que pueden entrar en ellas (guardia de navegación). */
const VIEW_ACCESS = Object.freeze({
  dashboard: [ROLES.DOCTOR, ROLES.SECRETARIA],
  pacientes: [ROLES.DOCTOR, ROLES.SECRETARIA],
  expediente: [ROLES.DOCTOR, ROLES.SECRETARIA],
  citas: [ROLES.DOCTOR, ROLES.SECRETARIA],
});

let currentUser = null; // { uid, email, nombre, rol }

/* ------------------------------------------------------------------ */
/* Perfil                                                              */
/* ------------------------------------------------------------------ */
async function loadProfile(firebaseUser) {
  const snap = await getDoc(doc(db, "users", firebaseUser.uid));
  const data = snap.exists() ? snap.data() : null;
  const rol = normalizeRole(data?.rol);
  if (!data || !PERMISSIONS[rol]) {
    await signOut(auth);
    currentUser = null;
    sessionStorage.removeItem("userRole");
    localStorage.removeItem("userRole");
    throw new Error("Tu cuenta no tiene un rol asignado. Contacta al administrador de la clínica.");
  }

  currentUser = {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    nombre: data.nombre || firebaseUser.email,
    rol,
  };
  sessionStorage.setItem("userRole", currentUser.rol);
  return currentUser;
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */
export async function login(email, password, remember = true) {
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return loadProfile(cred.user);
}

export async function logout(redirectTo = "./login.html") {
  await signOut(auth);
  currentUser = null;
  sessionStorage.removeItem("userRole");
  localStorage.removeItem("userRole");
  window.location.replace(redirectTo);
}

export async function requestPasswordReset(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

export const getCurrentUser = () => currentUser;

export function can(permission) {
  return Boolean(currentUser && PERMISSIONS[currentUser.rol]?.includes(permission));
}

/** Lanza un error si el usuario activo no tiene el permiso (defensa en el cliente; las reglas de Firestore son la defensa real). */
export function assertPermission(permission) {
  if (!can(permission)) {
    const err = new Error("Tu rol no tiene permiso para realizar esta acción.");
    err.code = "permission-denied";
    throw err;
  }
}

export function canAccessView(view) {
  return Boolean(currentUser && VIEW_ACCESS[view]?.includes(currentUser.rol));
}

/** Resuelve una sola vez con el usuario (con perfil) o null. */
export function waitForAuth() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      unsubscribe();
      if (!firebaseUser) return resolve(null);
      try {
        resolve(await loadProfile(firebaseUser));
      } catch {
        resolve(null);
      }
    });
  });
}

/** Guardia para páginas protegidas: redirige al login si no hay sesión válida. */
export async function protectPage(loginUrl = "./login.html") {
  const user = await waitForAuth();
  if (!user) {
    window.location.replace(loginUrl);
    return null;
  }
  return user;
}

/** Guardia para el login: si ya hay sesión, envía al panel. */
export async function redirectIfAuthenticated(homeUrl = "./index.html") {
  const user = await waitForAuth();
  if (user) window.location.replace(homeUrl);
  return user;
}

/** Detecta cierres de sesión posteriores (p. ej., desde otra pestaña). */
export function watchSession(onSignedOut) {
  return onAuthStateChanged(auth, (firebaseUser) => {
    if (!firebaseUser) {
      currentUser = null;
      onSignedOut?.();
    }
  });
}

export function getAuthErrorMessage(error) {
  const messages = {
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/wrong-password": "Correo o contraseña incorrectos.",
    "auth/user-not-found": "Correo o contraseña incorrectos.",
    "auth/invalid-email": "El formato del correo no es válido.",
    "auth/user-disabled": "Esta cuenta fue deshabilitada.",
    "auth/too-many-requests": "Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.",
    "auth/network-request-failed": "Sin conexión. Revisa tu internet e inténtalo de nuevo.",
    "auth/missing-email": "Escribe tu correo electrónico.",
  };
  return messages[error?.code] || error?.message || "No se pudo iniciar sesión.";
}

function setupLoginForm() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const alertBox = document.getElementById("loginAlert");
  const button = document.getElementById("loginBtn");

  const showAlert = (message, type = "danger") => {
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;
  };
  const setLoading = (loading) => {
    button.disabled = loading;
    button.querySelector(".spinner-border").classList.toggle("d-none", !loading);
    button.querySelector(".btn-label").textContent = loading ? "Verificando…" : "Entrar";
  };

  setLoading(true);
  redirectIfAuthenticated("./index.html").finally(() => setLoading(false));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    form.classList.add("was-validated");
    if (!form.checkValidity()) return;

    setLoading(true);
    alertBox.classList.add("d-none");
    try {
      await login(emailInput.value, passwordInput.value, document.getElementById("remember").checked);
      showAlert("Acceso concedido. Redirigiendo…", "success");
      window.location.replace("./index.html");
    } catch (err) {
      showAlert(getAuthErrorMessage(err));
      setLoading(false);
    }
  });

  document.getElementById("forgotPassword").addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email) {
      showAlert("Escribe tu correo arriba y vuelve a pulsar «¿Olvidaste tu contraseña?».", "warning");
      return;
    }
    try {
      await requestPasswordReset(email);
      showAlert("Si el correo está registrado, recibirás un enlace para restablecer la contraseña.", "info");
    } catch (err) {
      showAlert(getAuthErrorMessage(err));
    }
  });

  document.getElementById("togglePassword").addEventListener("click", (e) => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    e.currentTarget.innerHTML = `<i class="bi bi-eye${show ? "-slash" : ""}"></i>`;
    e.currentTarget.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
  });
}

setupLoginForm();
