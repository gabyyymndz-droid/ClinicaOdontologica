
 */
import { db, CLINIC_CONFIG } from "./firebase-config.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { assertPermission, getCurrentUser } from "./auth.js";
import { normalizeText, normalizePhone } from "./patients.js";

export { normalizePhone };

const appointmentsRef = collection(db, "appointments");

export const ESTADOS = Object.freeze({
  PROGRAMADA: "programada",
  CONFIRMADA: "confirmada",
  COMPLETADA: "completada",
  CANCELADA: "cancelada",
});

/** Una cita "activa" es la que aún va a ocurrir: programada o confirmada por el paciente. */
export const isActive = (appt) => appt.estado === ESTADOS.PROGRAMADA || appt.estado === ESTADOS.CONFIRMADA;

export const COMMON_REASONS = Object.freeze([
  "Evaluación general", "Limpieza dental", "Control de ortodoncia", "Dolor dental",
  "Continuación de tratamiento", "Endodoncia", "Extracción", "Blanqueamiento",
]);

const HORARIO = { apertura: "07:00", cierre: "19:00" };
const MIN_GAP_MINUTES = 30; // separación mínima entre citas


export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/** "YYYY-MM-DD" → Date en hora local (evita el desfase UTC de new Date("YYYY-MM-DD")). */
export function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function formatDateLong(iso) {
  if (!iso) return "—";
  const text = new Intl.DateTimeFormat("es-SV", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(parseISODate(iso));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDateShort(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-SV", { day: "2-digit", month: "short", year: "numeric" })
    .format(parseISODate(iso));
}

export function formatTime12(hhmm) {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return new Intl.DateTimeFormat("es-SV", { hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

export function toDateTime(appt) {
  const d = parseISODate(appt.fecha);
  const [h, m] = appt.hora.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Cálculo del tiempo restante para la cita y si conviene enviar recordatorio (≤ 48 h). */
export function getReminderInfo(appt, now = new Date()) {
  const when = toDateTime(appt);
  const diffMs = when - now;
  const hoursLeft = diffMs / 36e5;
  const dayDiff = Math.round((parseISODate(appt.fecha) - parseISODate(todayISO(now))) / 864e5);

  let label;
  if (diffMs < 0) label = dayDiff === 0 ? "Hoy (hora pasada)" : `Hace ${Math.abs(dayDiff)} día${Math.abs(dayDiff) === 1 ? "" : "s"}`;
  else if (dayDiff === 0) label = hoursLeft < 1 ? `En ${Math.max(1, Math.round(hoursLeft * 60))} min` : `Hoy · en ${Math.round(hoursLeft)} h`;
  else if (dayDiff === 1) label = "Mañana";
  else label = `En ${dayDiff} días`;

  return {
    when, diffMs, hoursLeft, dayDiff, label,
    isUpcoming: diffMs > 0,
    isDueSoon: diffMs > 0 && hoursLeft <= 48,
  };
}


export function sortAppointments(list) {
  return list.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
}

export function filterAppointments(list, filter = "proximas", term = "") {
  const today = todayISO();
  const filters = {
    hoy: (a) => a.fecha === today && a.estado !== ESTADOS.CANCELADA,
    proximas: (a) => isActive(a) && a.fecha >= today,
    todas: () => true,
    historial: (a) => !isActive(a) || a.fecha < today,
  };

  const text = normalizeText(term);
  let result = list.filter(filters[filter] || filters.todas);
  if (text) {
    result = result.filter((a) =>
      normalizeText(a.pacienteNombre).includes(text) || normalizeText(a.motivo).includes(text));
  }
  return filter === "historial" ? [...result].reverse() : result;
}


const toDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Documento de Firestore → objeto de la app.
 * Acepta el formato nuevo (fecha Timestamp + nombre) y el anterior (fecha "YYYY-MM-DD" + hora + pacienteNombre).
 */
function mapAppointment(snap) {
  const d = snap.data();
  const legacy = typeof d.fecha === "string";
  const fechaHora = legacy ? null : toDate(d.fecha);

  const appt = {
    id: snap.id,
    ...d,
    pacienteNombre: d.nombre ?? d.pacienteNombre ?? "",
    fecha: legacy ? d.fecha : fechaHora ? todayISO(fechaHora) : "",
    hora: legacy ? d.hora : fechaHora ? `${pad2(fechaHora.getHours())}:${pad2(fechaHora.getMinutes())}` : "00:00",
    creadoEn: toDate(d.creadoEn),
    recordatorioFecha: toDate(d.recordatorioFecha),
  };
  appt.fechaHora = fechaHora ?? (appt.fecha ? toDateTime(appt) : null);
  return appt;
}

export async function getAppointments() {
  const snap = await getDocs(query(appointmentsRef, orderBy("fecha", "asc")));
  return sortAppointments(snap.docs.map(mapAppointment).filter((a) => a.fecha));
}

/** Busca choques de horario entre las citas de ese día (rango de Timestamps, índice automático). */
async function assertSlotAvailable(fechaHora) {
  const start = new Date(fechaHora.getFullYear(), fechaHora.getMonth(), fechaHora.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const snap = await getDocs(query(
    appointmentsRef,
    where("fecha", ">=", Timestamp.fromDate(start)),
    where("fecha", "<", Timestamp.fromDate(end)),
  ));

  const conflict = snap.docs
    .map(mapAppointment)
    .find((a) => a.estado !== ESTADOS.CANCELADA &&
      Math.abs(a.fechaHora - fechaHora) < MIN_GAP_MINUTES * 60_000);

  if (conflict) {
    throw new Error(`Ese horario choca con la cita de ${conflict.pacienteNombre} a las ${formatTime12(conflict.hora)}`);
  }
}

export async function createAppointment(raw, patient) {
  assertPermission("appointments:create");
  if (!patient) throw new Error("Selecciona un paciente válido.");

  const local = {
    fecha: raw.fecha,
    hora: raw.hora,
    motivo: String(raw.motivo ?? "").trim() || "Consulta general",
    notas: String(raw.notas ?? "").trim(),
  };

  if (!local.fecha || !local.hora) throw new Error("La fecha y la hora son obligatorias.");
  if (local.hora < HORARIO.apertura || local.hora > HORARIO.cierre) {
    throw new Error(`El horario de atención es de ${formatTime12(HORARIO.apertura)} a ${formatTime12(HORARIO.cierre)}.`);
  }

  const fechaHora = toDateTime(local);
  if (fechaHora < new Date()) throw new Error("No se puede agendar una cita en el pasado.");

  const telefono = normalizePhone(patient.telefono);
  if (!/^\d{10,15}$/.test(telefono)) {
    throw new Error(`El teléfono de ${patient.nombre} no es válido. Debe tener 8 dígitos (o incluir el código de país).`);
  }

  await assertSlotAvailable(fechaHora);

  const user = getCurrentUser();
  const payload = {
    nombre: patient.nombre,
    telefono,                              // "50370000000"
    fecha: Timestamp.fromDate(fechaHora),  // Timestamp nativo (fecha + hora)
    hora: local.hora,                      // solo informativo / legible en la consola
    motivo: local.motivo,
    notas: local.notas,
    pacienteId: patient.id,
    estado: ESTADOS.PROGRAMADA,
    recordatorioEnviado: false,
    creadoPor: user.uid,
  };
  const ref = await addDoc(appointmentsRef, { ...payload, creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp() });

  return {
    ...payload,
    id: ref.id,
    pacienteNombre: patient.nombre,
    fecha: local.fecha,
    fechaHora,
    creadoEn: new Date(),
    recordatorioFecha: null,
  };
}

export async function updateAppointmentStatus(id, estado) {
  assertPermission("appointments:update");
  if (!Object.values(ESTADOS).includes(estado)) throw new Error("Estado de cita no válido.");
  await updateDoc(doc(db, "appointments", id), { estado, actualizadoEn: serverTimestamp() });
}

export async function deleteAppointment(id) {
  assertPermission("appointments:delete");
  await deleteDoc(doc(db, "appointments", id));
}

export function buildReminderMessage(appt) {
  const info = getReminderInfo(appt);
  const firstName = (appt.pacienteNombre || "").split(" ")[0];
  const when = info.dayDiff === 0 ? "para *hoy*" : info.dayDiff === 1 ? "para *mañana*" : "programada";

  return [
    `Hola ${firstName} 👋`,
    "",
    `Le saludamos de *${CLINIC_CONFIG.nombre}*. Le recordamos su cita ${when}:`,
    "",
    `📅 ${formatDateLong(appt.fecha)}`,
    `🕐 ${formatTime12(appt.hora)}`,
    `🦷 ${appt.motivo}`,
    `📍 ${CLINIC_CONFIG.direccion}`,
    "",
    "Por favor confirme su asistencia respondiendo a este mensaje. Si necesita reprogramar, avísenos con anticipación.",
    "",
    "¡Le esperamos! 😊",
  ].join("\n");
}

export function buildWhatsAppUrl(appt) {
  const phone = normalizePhone(appt.telefono);
  if (phone.length < 10) throw new Error(`El teléfono de ${appt.pacienteNombre} no es válido para WhatsApp.`);
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(buildReminderMessage(appt))}`;
}

/**
 * Abre WhatsApp con el mensaje y marca la cita como "recordatorio enviado".
 * window.open se ejecuta ANTES de cualquier await para conservar el gesto del usuario
 * y que el navegador no bloquee la ventana emergente.
 */
export async function sendWhatsAppReminder(appt) {
  assertPermission("reminders:send");
  if (!isActive(appt)) throw new Error("Solo se envían recordatorios de citas programadas o confirmadas.");

  const url = buildWhatsAppUrl(appt);
  const win = window.open(url, "_blank");
  if (win) win.opener = null;

  try {
    await updateDoc(doc(db, "appointments", appt.id), {
      recordatorioEnviado: true,
      recordatorioFecha: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
    return { url, opened: Boolean(win), saved: true };
  } catch (err) {
    console.error("No se pudo registrar el recordatorio:", err);
    return { url, opened: Boolean(win), saved: false };
  }
}
