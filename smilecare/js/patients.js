/**
 * patients.js
 * CRUD de pacientes (ficha clínica) y de consultas (subcolección patients/{id}/consultations).
 * Incluye la búsqueda en memoria por nombre / DUI con .filter() e .includes().
 */
import { db } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { assertPermission, getCurrentUser } from "./auth.js";

const patientsRef = collection(db, "patients");
const appointmentsRef = collection(db, "appointments");
const consultationsRef = (patientId) => collection(db, "patients", patientId, "consultations");

/* ------------------------------------------------------------------ */
/* Catálogos                                                           */
/* ------------------------------------------------------------------ */
export const GENERAL_TOOTH = "General";

/** Numeración FDI, ordenada como la ve el odontólogo frente al paciente. */
export const TEETH = Object.freeze({
  upperRight: [18, 17, 16, 15, 14, 13, 12, 11],
  upperLeft: [21, 22, 23, 24, 25, 26, 27, 28],
  lowerRight: [48, 47, 46, 45, 44, 43, 42, 41],
  lowerLeft: [31, 32, 33, 34, 35, 36, 37, 38],
});

export const QUADRANTS = Object.freeze([
  { label: "Cuadrante 1 · Superior derecho", teeth: [11, 12, 13, 14, 15, 16, 17, 18] },
  { label: "Cuadrante 2 · Superior izquierdo", teeth: [21, 22, 23, 24, 25, 26, 27, 28] },
  { label: "Cuadrante 3 · Inferior izquierdo", teeth: [31, 32, 33, 34, 35, 36, 37, 38] },
  { label: "Cuadrante 4 · Inferior derecho", teeth: [41, 42, 43, 44, 45, 46, 47, 48] },
]);

export const COMMON_TREATMENTS = Object.freeze([
  "Evaluación inicial", "Limpieza dental (profilaxis)", "Detartraje", "Aplicación de flúor",
  "Sellante de fosas y fisuras", "Resina compuesta", "Amalgama", "Endodoncia",
  "Extracción simple", "Extracción de tercer molar", "Corona de porcelana", "Incrustación",
  "Blanqueamiento", "Prótesis removible", "Ortodoncia - control", "Radiografía periapical",
]);

export const DUI_REGEX = /^\d{8}-\d$/;

/* ------------------------------------------------------------------ */
/* Utilidades puras                                                    */
/* ------------------------------------------------------------------ */
export function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Formatea mientras se escribe: "123456789" → "12345678-9". */
export function formatDUI(value = "") {
  const digits = String(value).replace(/\D/g, "").slice(0, 9);
  return digits.length > 8 ? `${digits.slice(0, 8)}-${digits.slice(8)}` : digits;
}

export function calcAge(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const [y, m, d] = fechaNacimiento.split("-").map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** Búsqueda en tiempo real por nombre (sin acentos ni mayúsculas) o DUI (con o sin guion). */
export function filterPatients(patients, term) {
  const text = normalizeText(term);
  if (!text) return patients;
  const digits = text.replace(/\D/g, "");

  return patients.filter((p) => {
    const nameMatch = normalizeText(p.nombre).includes(text);
    const duiMatch = (p.dui || "").includes(text) ||
      (digits.length > 0 && (p.dui || "").replace(/\D/g, "").includes(digits));
    return nameMatch || duiMatch;
  });
}

/** Más reciente primero; a igual fecha, la registrada más tarde primero. */
export function sortConsultations(list) {
  return list.sort((a, b) =>
    b.fecha.localeCompare(a.fecha) ||
    (b.creadoEn?.getTime?.() ?? 0) - (a.creadoEn?.getTime?.() ?? 0));
}

const localISODate = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const toDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);

function mapPatient(snap) {
  const d = snap.data();
  return { id: snap.id, ...d, creadoEn: toDate(d.creadoEn), actualizadoEn: toDate(d.actualizadoEn) };
}

function mapConsultation(snap) {
  const d = snap.data();
  return { id: snap.id, ...d, costo: Number(d.costo) || 0, creadoEn: toDate(d.creadoEn) };
}

function sanitizePatient(raw) {
  const data = {
    nombre: String(raw.nombre ?? "").trim().replace(/\s+/g, " "),
    dui: formatDUI(raw.dui ?? ""),
    fechaNacimiento: raw.fechaNacimiento || "",
    genero: raw.genero || "",
    telefono: String(raw.telefono ?? "").trim(),
    email: String(raw.email ?? "").trim().toLowerCase(),
    direccion: String(raw.direccion ?? "").trim(),
    alergias: String(raw.alergias ?? "").trim(),
    antecedentes: String(raw.antecedentes ?? "").trim(),
  };

  if (data.nombre.length < 3) throw new Error("El nombre del paciente es obligatorio (mínimo 3 caracteres).");
  if (!DUI_REGEX.test(data.dui)) throw new Error("El DUI debe tener el formato 00000000-0.");
  if (data.telefono.replace(/\D/g, "").length < 8) throw new Error("Ingresa un teléfono válido (mínimo 8 dígitos).");
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error("El correo electrónico no es válido.");
  if (data.fechaNacimiento && data.fechaNacimiento > localISODate()) throw new Error("La fecha de nacimiento no puede ser futura.");
  return data;
}

async function assertUniqueDUI(dui, excludeId = null) {
  const snap = await getDocs(query(patientsRef, where("dui", "==", dui), limit(2)));
  if (snap.docs.some((d) => d.id !== excludeId)) {
    throw new Error(`Ya existe un paciente registrado con el DUI ${dui}.`);
  }
}

/* ------------------------------------------------------------------ */
/* Pacientes                                                           */
/* ------------------------------------------------------------------ */
export async function getPatients() {
  const snap = await getDocs(query(patientsRef, orderBy("nombre")));
  return snap.docs.map(mapPatient);
}

export async function getPatientById(id) {
  const snap = await getDoc(doc(db, "patients", id));
  return snap.exists() ? mapPatient(snap) : null;
}

export async function createPatient(raw) {
  assertPermission("patients:create");
  const data = sanitizePatient(raw);
  await assertUniqueDUI(data.dui);

  const user = getCurrentUser();
  const ref = await addDoc(patientsRef, {
    ...data,
    creadoPor: user.uid,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  });
  const now = new Date();
  return { id: ref.id, ...data, creadoPor: user.uid, creadoEn: now, actualizadoEn: now };
}

/** Actualiza la ficha y sincroniza nombre/teléfono desnormalizados en sus citas. */
export async function updatePatient(id, raw) {
  assertPermission("patients:update");
  const data = sanitizePatient(raw);
  await assertUniqueDUI(data.dui, id);

  const batch = writeBatch(db);
  batch.update(doc(db, "patients", id), { ...data, actualizadoEn: serverTimestamp() });

  const appts = await getDocs(query(appointmentsRef, where("pacienteId", "==", id)));
  appts.forEach((a) => batch.update(a.ref, { pacienteNombre: data.nombre, telefono: data.telefono }));

  await batch.commit();
  return { ...data, actualizadoEn: new Date() };
}

/** Elimina el paciente con sus consultas y citas (un batch admite hasta 500 operaciones). */
export async function deletePatient(id) {
  assertPermission("patients:delete");
  const [consults, appts] = await Promise.all([
    getDocs(consultationsRef(id)),
    getDocs(query(appointmentsRef, where("pacienteId", "==", id))),
  ]);

  const batch = writeBatch(db);
  consults.forEach((d) => batch.delete(d.ref));
  appts.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "patients", id));
  await batch.commit();
}

/* ------------------------------------------------------------------ */
/* Consultas (historial clínico)                                       */
/* ------------------------------------------------------------------ */
export async function getConsultations(patientId) {
  const snap = await getDocs(query(consultationsRef(patientId), orderBy("fecha", "desc")));
  return sortConsultations(snap.docs.map(mapConsultation));
}

export async function addConsultation(patientId, raw) {
  assertPermission("consultations:create");

  const costo = Number.parseFloat(raw.costo);
  const data = {
    fecha: raw.fecha,
    piezaDental: String(raw.piezaDental ?? "").trim(),
    tratamiento: String(raw.tratamiento ?? "").trim(),
    costo: Math.round(costo * 100) / 100,
    notas: String(raw.notas ?? "").trim(),
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.fecha || "")) throw new Error("Selecciona una fecha válida para la consulta.");
  if (data.fecha > localISODate()) throw new Error("La fecha de la consulta no puede ser futura.");
  if (!data.piezaDental) throw new Error("Selecciona la pieza dental trabajada.");
  if (data.tratamiento.length < 3) throw new Error("Describe el tratamiento realizado.");
  if (!Number.isFinite(costo) || costo < 0) throw new Error("El costo debe ser un número igual o mayor a 0.");

  const user = getCurrentUser();
  const meta = { doctorId: user.uid, doctorNombre: user.nombre };
  const ref = await addDoc(consultationsRef(patientId), { ...data, ...meta, creadoEn: serverTimestamp() });
  return { id: ref.id, ...data, ...meta, creadoEn: new Date() };
}

export async function deleteConsultation(patientId, consultationId) {
  assertPermission("consultations:delete");
  await deleteDoc(doc(db, "patients", patientId, "consultations", consultationId));
}
