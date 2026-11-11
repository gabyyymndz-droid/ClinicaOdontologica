/**
 * app.js
 * Controlador de la interfaz: router por hash con guardias de rol, eventos del DOM
 * (delegación), renderizado dinámico, toasts, spinners y modales.
 */
import {
  protectPage, logout, can, canAccessView, watchSession, ROLE_LABELS,
} from "./auth.js";
import {
  getPatients, getPatientById, createPatient, updatePatient, deletePatient,
  filterPatients, getConsultations, addConsultation, deleteConsultation, sortConsultations,
  calcAge, formatDUI, QUADRANTS, TEETH, COMMON_TREATMENTS, GENERAL_TOOTH,
} from "./patients.js";
import {
  getAppointments, createAppointment, updateAppointmentStatus, deleteAppointment,
  sendWhatsAppReminder, getReminderInfo, filterAppointments, sortAppointments, normalizePhone,
  formatDateLong, formatDateShort, formatTime12, todayISO, addDaysISO, ESTADOS, COMMON_REASONS,
} from "./appointments.js";

/* ================================================================== */
/* Estado                                                              */
/* ================================================================== */
const state = {
  user: null,
  patients: [],
  appointments: [],
  currentPatient: null,
  consultations: [],
  patientSearch: "",
  apptFilter: "proximas",
  apptSearch: "",
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD" });

const VIEW_TITLES = {
  dashboard: "Panel principal",
  pacientes: "Pacientes",
  citas: "Citas agendadas",
  expediente: "Expediente clínico",
};

const PATIENT_FIELDS = [
  { name: "nombre", label: "Nombre completo", type: "text", required: true, col: "col-md-8", placeholder: "Ej. María José López", feedback: "Escribe el nombre completo (mín. 3 caracteres).", minlength: 3 },
  { name: "dui", label: "DUI", type: "text", required: true, col: "col-md-4", placeholder: "00000000-0", pattern: "\\d{8}-\\d", maxlength: 10, inputmode: "numeric", feedback: "Formato: 00000000-0" },
  { name: "fechaNacimiento", label: "Fecha de nacimiento", type: "date", col: "col-md-4" },
  { name: "genero", label: "Género", type: "select", col: "col-md-4", options: ["", "Femenino", "Masculino", "Otro"] },
  { name: "telefono", label: "Teléfono / WhatsApp", type: "tel", required: true, col: "col-md-4", placeholder: "7777-7777", minlength: 8, feedback: "Ingresa un teléfono válido." },
  { name: "email", label: "Correo electrónico", type: "email", col: "col-md-6", placeholder: "correo@ejemplo.com", feedback: "Correo no válido." },
  { name: "direccion", label: "Dirección", type: "text", col: "col-md-6" },
  { name: "alergias", label: "Alergias", type: "textarea", col: "col-md-6", placeholder: "Ej. Penicilina, látex. Dejar vacío si no tiene." },
  { name: "antecedentes", label: "Antecedentes médicos", type: "textarea", col: "col-md-6", placeholder: "Diabetes, hipertensión, medicamentos actuales…" },
];

/* ================================================================== */
/* Utilidades de interfaz                                              */
/* ================================================================== */
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function friendlyError(err, fallback) {
  const byCode = {
    "permission-denied": "No tienes permisos para realizar esta acción.",
    unavailable: "Sin conexión con el servidor. Revisa tu internet.",
    "deadline-exceeded": "El servidor tardó demasiado en responder. Inténtalo de nuevo.",
    "not-found": "El registro ya no existe.",
  };
  return byCode[err?.code] || err?.message || fallback || "Ocurrió un error inesperado.";
}

function showToast(message, type = "success") {
  const icons = { success: "check-circle-fill", danger: "x-octagon-fill", warning: "exclamation-triangle-fill", info: "info-circle-fill" };
  const el = document.createElement("div");
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.setAttribute("role", type === "danger" ? "alert" : "status");
  el.setAttribute("aria-live", type === "danger" ? "assertive" : "polite");
  el.setAttribute("aria-atomic", "true");
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body"><i class="bi bi-${icons[type] ?? icons.info} me-2"></i>${escapeHTML(message)}</div>
      <button type="button" class="btn-close ${type === "warning" ? "" : "btn-close-white"} me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
    </div>`;
  $("#toastContainer").appendChild(el);
  el.addEventListener("hidden.bs.toast", () => el.remove());
  new bootstrap.Toast(el, { delay: type === "danger" ? 6000 : 3500 }).show();
}

function notifyError(err, fallback) {
  console.error(err);
  showToast(friendlyError(err, fallback), "danger");
}

const loadingHTML = (text = "Cargando…") => `
  <div class="text-center py-5 text-secondary">
    <div class="spinner-border text-primary mb-2" role="status"></div>
    <div class="small">${escapeHTML(text)}</div>
  </div>`;

const emptyHTML = (icon, title, subtitle = "") => `
  <div class="empty-state">
    <i class="bi bi-${icon}"></i>
    <p class="fw-semibold mb-1">${escapeHTML(title)}</p>
    ${subtitle ? `<p class="small text-secondary mb-0">${escapeHTML(subtitle)}</p>` : ""}
  </div>`;

const tableMessageRow = (cols, html) => `<tr class="no-hover"><td colspan="${cols}">${html}</td></tr>`;

/** Ejecuta una tarea async mostrando un spinner en el botón y deshabilitándolo. */
async function withLoading(button, task, text = "Guardando…") {
  if (!button) return task();
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner-border spinner-border-sm ${text ? "me-2" : ""}" aria-hidden="true"></span>${escapeHTML(text)}`;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

function confirmDialog({ title = "Confirmar", message, confirmText = "Confirmar", variant = "danger" }) {
  return new Promise((resolve) => {
    const modalEl = $("#confirmModal");
    const acceptBtn = $("#confirmAccept");
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    acceptBtn.className = `btn btn-${variant}`;
    acceptBtn.textContent = confirmText;

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    let accepted = false;
    const onAccept = () => { accepted = true; modal.hide(); };
    acceptBtn.addEventListener("click", onAccept, { once: true });
    modalEl.addEventListener("hidden.bs.modal", () => {
      acceptBtn.removeEventListener("click", onAccept);
      resolve(accepted);
    }, { once: true });
    modal.show();
  });
}

/** Muestra/oculta elementos según permisos del rol activo. */
function applyPermissions(root = document) {
  $$("[data-permission]", root).forEach((el) => el.classList.toggle("d-none", !can(el.dataset.permission)));
  $$("[data-permission-hide]", root).forEach((el) => el.classList.toggle("d-none", can(el.dataset.permissionHide)));
}

/* --------------------------- Formularios --------------------------- */
function renderPatientFields(container, prefix) {
  container.innerHTML = PATIENT_FIELDS.map((f) => {
    const id = `${prefix}-${f.name}`;
    const attrs = [
      f.required ? "required" : "",
      f.pattern ? `pattern="${f.pattern}"` : "",
      f.maxlength ? `maxlength="${f.maxlength}"` : "",
      f.minlength ? `minlength="${f.minlength}"` : "",
      f.inputmode ? `inputmode="${f.inputmode}"` : "",
      f.placeholder ? `placeholder="${escapeHTML(f.placeholder)}"` : "",
      f.type === "date" ? `max="${todayISO()}"` : "",
    ].join(" ");

    let control;
    if (f.type === "select") {
      control = `<select class="form-select" id="${id}" name="${f.name}" ${attrs}>
        ${f.options.map((o) => `<option value="${o}">${o || "Seleccionar…"}</option>`).join("")}</select>`;
    } else if (f.type === "textarea") {
      control = `<textarea class="form-control" id="${id}" name="${f.name}" rows="2" ${attrs}></textarea>`;
    } else {
      control = `<input class="form-control" type="${f.type}" id="${id}" name="${f.name}" ${attrs}>`;
    }

    return `
      <div class="${f.col}">
        <label class="form-label" for="${id}">${f.label}${f.required ? ' <span class="text-danger">*</span>' : ""}</label>
        ${control}
        <div class="invalid-feedback">${f.feedback || "Campo obligatorio."}</div>
      </div>`;
  }).join("");
}

const readForm = (form) => Object.fromEntries(new FormData(form).entries());

function fillForm(form, data) {
  $$("[name]", form).forEach((el) => { el.value = data[el.name] ?? ""; });
}

function validateForm(form) {
  form.classList.add("was-validated");
  return form.checkValidity();
}

function resetForm(form) {
  form.reset();
  form.classList.remove("was-validated");
}

/* --------------------------- Badges --------------------------- */
function statusBadge(estado) {
  const map = {
    [ESTADOS.PROGRAMADA]: ["primary", "calendar-event", "Programada"],
    [ESTADOS.COMPLETADA]: ["success", "check2-circle", "Completada"],
    [ESTADOS.CANCELADA]: ["secondary", "x-circle", "Cancelada"],
  };
  const [color, icon, label] = map[estado] || ["light", "question", estado];
  return `<span class="badge bg-${color}-subtle text-${color}-emphasis border border-${color}-subtle"><i class="bi bi-${icon} me-1"></i>${label}</span>`;
}

function reminderBadge(appt) {
  if (appt.recordatorioEnviado) {
    return `<span class="badge bg-success-subtle text-success-emphasis"><i class="bi bi-whatsapp me-1"></i>Enviado</span>`;
  }
  if (appt.estado !== ESTADOS.PROGRAMADA) return `<span class="text-secondary small">—</span>`;
  const info = getReminderInfo(appt);
  if (info.isDueSoon) return `<span class="badge bg-warning-subtle text-warning-emphasis"><i class="bi bi-bell me-1"></i>Pendiente</span>`;
  return `<span class="text-secondary small">${info.isUpcoming ? "Aún no" : "—"}</span>`;
}

function whatsappButton(appt, size = "sm") {
  if (appt.estado !== ESTADOS.PROGRAMADA || !can("reminders:send") || !getReminderInfo(appt).isUpcoming) return "";
  const label = appt.recordatorioEnviado ? "Reenviar recordatorio" : "Enviar recordatorio WhatsApp";
  return `<button class="btn btn-${size} btn-whatsapp" data-action="send-reminder" data-id="${appt.id}" title="${label}" aria-label="${label}">
    <i class="bi bi-whatsapp"></i><span class="d-none d-xl-inline ms-1">${appt.recordatorioEnviado ? "Reenviar" : "Recordar"}</span></button>`;
}

/* ================================================================== */
/* Router (hash) con guardia de rol                                    */
/* ================================================================== */
function parseHash() {
  const [, view, param] = location.hash.split("/");
  return { view: view || "dashboard", param: param ? decodeURIComponent(param) : null };
}

async function router() {
  const { view, param } = parseHash();

  if (!VIEW_TITLES[view]) { location.hash = "#/dashboard"; return; }
  if (!canAccessView(view)) {
    showToast("No tienes acceso a esa sección.", "warning");
    location.hash = "#/dashboard";
    return;
  }

  $$(".view").forEach((s) => s.classList.toggle("d-none", s.dataset.view !== view));
  const navKey = view === "expediente" ? "pacientes" : view;
  $$("[data-nav]").forEach((a) => {
    const active = a.dataset.nav === navKey;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  $("#pageTitle").textContent = VIEW_TITLES[view];
  document.title = `SmileCare Manager · ${VIEW_TITLES[view]}`;
  bootstrap.Offcanvas.getInstance($("#sidebar"))?.hide();

  switch (view) {
    case "dashboard": renderDashboard(); break;
    case "pacientes": renderPatientsTable(); break;
    case "citas": renderAppointments(); break;
    case "expediente":
      if (!param) { location.hash = "#/pacientes"; return; }
      await openPatientRecord(param);
      break;
  }
}

/** Vuelve a pintar la vista activa con el estado en memoria (sin volver a consultar Firestore). */
function rerenderView() {
  const { view } = parseHash();
  if (view === "dashboard") renderDashboard();
  else if (view === "pacientes") renderPatientsTable();
  else if (view === "citas") renderAppointments();
  else if (view === "expediente" && state.currentPatient) renderRecord({ keepForms: true });
}

/* ================================================================== */
/* Carga de datos                                                      */
/* ================================================================== */
async function loadPatients() {
  try {
    state.patients = await getPatients();
  } catch (err) {
    notifyError(err, "No se pudieron cargar los pacientes.");
  }
}

async function loadAppointments() {
  try {
    state.appointments = await getAppointments();
  } catch (err) {
    notifyError(err, "No se pudieron cargar las citas.");
  }
}

async function refreshPatients(btn) {
  $("#patientsTableBody").innerHTML = tableMessageRow(6, loadingHTML("Cargando pacientes…"));
  await withLoading(btn, loadPatients, "");
  renderPatientsTable();
}

async function refreshAppointments(btn) {
  $("#appointmentsTableBody").innerHTML = tableMessageRow(7, loadingHTML("Cargando citas…"));
  await withLoading(btn, loadAppointments, "");
  renderAppointments();
}

/* ================================================================== */
/* Dashboard                                                           */
/* ================================================================== */
function renderDashboard() {
  const hour = new Date().getHours();
  const salute = hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches";
  $("#greeting").textContent = `${salute}, ${state.user.nombre.split(" ").slice(0, 2).join(" ")}`;

  const today = todayISO();
  const inAWeek = addDaysISO(7);
  const scheduled = state.appointments.filter((a) => a.estado === ESTADOS.PROGRAMADA);
  const todayList = state.appointments.filter((a) => a.fecha === today && a.estado !== ESTADOS.CANCELADA);
  const weekCount = scheduled.filter((a) => a.fecha >= today && a.fecha <= inAWeek).length;
  const pendingReminders = scheduled.filter((a) => !a.recordatorioEnviado && getReminderInfo(a).isDueSoon).length;

  const kpis = [
    { icon: "people", color: "teal", label: "Pacientes registrados", value: state.patients.length, href: "#/pacientes" },
    { icon: "calendar-day", color: "blue", label: "Citas de hoy", value: todayList.length, href: "#/citas" },
    { icon: "calendar-week", color: "violet", label: "Próximos 7 días", value: weekCount, href: "#/citas" },
    { icon: "bell", color: "amber", label: "Recordatorios pendientes (48 h)", value: pendingReminders, href: "#/citas" },
  ];

  $("#kpiCards").innerHTML = kpis.map((k) => `
    <div class="col-6 col-xl-3">
      <a class="card kpi-card h-100 text-decoration-none" href="${k.href}">
        <div class="card-body d-flex align-items-center gap-3">
          <span class="kpi-icon kpi-${k.color}"><i class="bi bi-${k.icon}"></i></span>
          <div>
            <div class="kpi-value">${k.value}</div>
            <div class="kpi-label">${k.label}</div>
          </div>
        </div>
      </a>
    </div>`).join("");

  $("#todayAppointments").innerHTML = todayList.length
    ? todayList.map((a) => `
      <div class="list-group-item d-flex align-items-center gap-3 py-3">
        <div class="time-chip">${formatTime12(a.hora)}</div>
        <div class="flex-grow-1 overflow-hidden">
          <a class="fw-semibold link-body-emphasis text-decoration-none" href="#/expediente/${encodeURIComponent(a.pacienteId)}">${escapeHTML(a.pacienteNombre)}</a>
          <div class="small text-secondary text-truncate">${escapeHTML(a.motivo)}</div>
        </div>
        ${statusBadge(a.estado)}
        ${whatsappButton(a)}
      </div>`).join("")
    : emptyHTML("calendar-check", "No hay citas para hoy", "Las citas agendadas para hoy aparecerán aquí.");

  const recent = [...state.patients]
    .sort((a, b) => (b.creadoEn?.getTime?.() ?? 0) - (a.creadoEn?.getTime?.() ?? 0))
    .slice(0, 5);

  $("#recentPatients").innerHTML = recent.length
    ? recent.map((p) => `
      <a class="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3" href="#/expediente/${encodeURIComponent(p.id)}">
        <span class="avatar">${escapeHTML(initials(p.nombre))}</span>
        <div class="flex-grow-1 overflow-hidden">
          <div class="fw-semibold text-truncate">${escapeHTML(p.nombre)}</div>
          <div class="small text-secondary font-monospace">${escapeHTML(p.dui)}</div>
        </div>
        ${p.alergias ? '<i class="bi bi-exclamation-triangle-fill text-danger" title="Tiene alergias"></i>' : ""}
        <i class="bi bi-chevron-right text-secondary"></i>
      </a>`).join("")
    : emptyHTML("person-plus", "Aún no hay pacientes", "Registra el primer paciente de la clínica.");

  applyPermissions($("[data-view=dashboard]"));
}

/* ================================================================== */
/* Pacientes                                                           */
/* ================================================================== */
function renderPatientsTable() {
  const tbody = $("#patientsTableBody");
  const list = filterPatients(state.patients, state.patientSearch);

  $("#patientCount").textContent = state.patientSearch
    ? `${list.length} de ${state.patients.length}`
    : `${state.patients.length} paciente${state.patients.length === 1 ? "" : "s"}`;

  if (!state.patients.length) {
    tbody.innerHTML = tableMessageRow(6, emptyHTML("people", "Aún no hay pacientes registrados", "Usa «Nuevo paciente» para comenzar."));
    return;
  }
  if (!list.length) {
    tbody.innerHTML = tableMessageRow(6, emptyHTML("search", `Sin resultados para «${state.patientSearch}»`, "Prueba con otro nombre o número de DUI."));
    return;
  }

  tbody.innerHTML = list.map((p) => {
    const age = calcAge(p.fechaNacimiento);
    return `
      <tr data-patient-row="${escapeHTML(p.id)}" tabindex="0" class="clickable-row" aria-label="Abrir expediente de ${escapeHTML(p.nombre)}">
        <td>
          <div class="d-flex align-items-center gap-2">
            <span class="avatar">${escapeHTML(initials(p.nombre))}</span>
            <div>
              <div class="fw-semibold">${escapeHTML(p.nombre)}</div>
              <div class="small text-secondary d-md-none">${escapeHTML(p.telefono)}</div>
            </div>
          </div>
        </td>
        <td class="font-monospace">${escapeHTML(p.dui)}</td>
        <td class="d-none d-md-table-cell">${escapeHTML(p.telefono)}</td>
        <td class="d-none d-lg-table-cell">${age ?? "—"}${age !== null ? " años" : ""}</td>
        <td class="d-none d-lg-table-cell">
          ${p.alergias
            ? `<span class="badge bg-danger-subtle text-danger-emphasis text-truncate d-inline-block" style="max-width:180px" title="${escapeHTML(p.alergias)}"><i class="bi bi-exclamation-triangle me-1"></i>${escapeHTML(p.alergias)}</span>`
            : '<span class="text-secondary small">Ninguna</span>'}
        </td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm btn-light" data-action="view-patient" data-id="${escapeHTML(p.id)}" title="Ver expediente" aria-label="Ver expediente"><i class="bi bi-folder2-open"></i></button>
          ${can("appointments:create") ? `<button class="btn btn-sm btn-light" data-action="schedule-for" data-id="${escapeHTML(p.id)}" title="Agendar cita" aria-label="Agendar cita"><i class="bi bi-calendar-plus"></i></button>` : ""}
          ${can("patients:delete") ? `<button class="btn btn-sm btn-light text-danger" data-action="delete-patient" data-id="${escapeHTML(p.id)}" title="Eliminar" aria-label="Eliminar paciente"><i class="bi bi-trash"></i></button>` : ""}
        </td>
      </tr>`;
  }).join("");
}

function openPatientModal() {
  resetForm($("#patientForm"));
  bootstrap.Modal.getOrCreateInstance($("#patientModal")).show();
}

async function handlePatientSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (!validateForm(form)) { showToast("Revisa los campos marcados en rojo.", "warning"); return; }

  await withLoading(e.submitter, async () => {
    try {
      const patient = await createPatient(readForm(form));
      state.patients.push(patient);
      state.patients.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      bootstrap.Modal.getInstance($("#patientModal"))?.hide();
      showToast(`Paciente ${patient.nombre} registrado correctamente.`);
      rerenderView();
    } catch (err) {
      notifyError(err, "No se pudo registrar el paciente.");
    }
  });
}

async function handleDeletePatient(id, btn) {
  const patient = state.patients.find((p) => p.id === id) || state.currentPatient;
  if (!patient) return;
  const ok = await confirmDialog({
    title: "Eliminar paciente",
    message: `Se eliminará a ${patient.nombre} junto con todo su historial clínico y sus citas. Esta acción no se puede deshacer.`,
    confirmText: "Eliminar definitivamente",
  });
  if (!ok) return;

  await withLoading(btn, async () => {
    try {
      await deletePatient(id);
      state.patients = state.patients.filter((p) => p.id !== id);
      state.appointments = state.appointments.filter((a) => a.pacienteId !== id);
      showToast(`Paciente ${patient.nombre} eliminado.`);
      if (state.currentPatient?.id === id) {
        state.currentPatient = null;
        location.hash = "#/pacientes";
      } else {
        rerenderView();
      }
    } catch (err) {
      notifyError(err, "No se pudo eliminar el paciente.");
    }
  }, "");
}

/* ================================================================== */
/* Expediente                                                          */
/* ================================================================== */
let recordRequestId = 0;

async function openPatientRecord(id) {
  const requestId = ++recordRequestId;
  $("#recordContent").classList.add("d-none");
  $("#recordLoading").classList.remove("d-none");

  try {
    const patient = state.patients.find((p) => p.id === id) || await getPatientById(id);
    if (requestId !== recordRequestId) return;
    if (!patient) {
      showToast("El paciente no existe o fue eliminado.", "warning");
      location.hash = "#/pacientes";
      return;
    }

    const consultations = await getConsultations(id);
    if (requestId !== recordRequestId) return; // el usuario ya navegó a otro expediente

    state.currentPatient = patient;
    state.consultations = consultations;
    renderRecord();
    bootstrap.Tab.getOrCreateInstance($("#tab-ficha-btn")).show();
    $("#recordContent").classList.remove("d-none");
  } catch (err) {
    notifyError(err, "No se pudo cargar el expediente.");
  } finally {
    if (requestId === recordRequestId) $("#recordLoading").classList.add("d-none");
  }
}

function renderRecord({ keepForms = false } = {}) {
  renderRecordHeader();

  const ficha = $("#fichaForm");
  if (!keepForms) {
    ficha.classList.remove("was-validated");
    fillForm(ficha, state.currentPatient);
    resetForm($("#consultationForm"));
    $("#cFecha").value = todayISO();
  }
  $("#fichaFieldset").disabled = !can("patients:update");

  renderOdontogram();
  renderTimeline();
  renderPatientAppointments();
  applyPermissions($("[data-view=expediente]"));
}

function renderRecordHeader() {
  const p = state.currentPatient;
  const age = calcAge(p.fechaNacimiento);
  const phone = normalizePhone(p.telefono);

  $("#recordHeader").innerHTML = `
    <div class="card-body d-flex flex-wrap gap-3 align-items-center">
      <span class="avatar avatar-lg">${escapeHTML(initials(p.nombre))}</span>
      <div class="flex-grow-1">
        <h2 class="h5 mb-1">${escapeHTML(p.nombre)}</h2>
        <div class="text-secondary small d-flex flex-wrap gap-3">
          <span><i class="bi bi-person-vcard me-1"></i>${escapeHTML(p.dui)}</span>
          ${age !== null ? `<span><i class="bi bi-cake2 me-1"></i>${age} años</span>` : ""}
          <span><i class="bi bi-telephone me-1"></i>${escapeHTML(p.telefono)}</span>
          ${p.email ? `<span><i class="bi bi-envelope me-1"></i>${escapeHTML(p.email)}</span>` : ""}
        </div>
      </div>
      <div class="d-flex gap-2">
        ${phone.length >= 10 ? `<a class="btn btn-outline-success" href="https://api.whatsapp.com/send?phone=${phone}" target="_blank" rel="noopener" title="Abrir chat de WhatsApp"><i class="bi bi-whatsapp"></i><span class="d-none d-sm-inline ms-1">Chat</span></a>` : ""}
        ${can("appointments:create") ? `<button class="btn btn-primary" data-action="schedule-current"><i class="bi bi-calendar-plus me-1"></i>Agendar cita</button>` : ""}
      </div>
    </div>
    ${p.alergias
      ? `<div class="alert alert-danger rounded-0 mb-0 py-2 d-flex gap-2"><i class="bi bi-exclamation-triangle-fill"></i><div><strong>Alergias:</strong> ${escapeHTML(p.alergias)}</div></div>`
      : `<div class="alert alert-success rounded-0 mb-0 py-2 small"><i class="bi bi-shield-check me-1"></i>Sin alergias conocidas registradas.</div>`}`;
}

async function handleFichaSubmit(e) {
  e.preventDefault();
  if (!can("patients:update")) { showToast("Tu rol no permite editar fichas clínicas.", "warning"); return; }
  const form = e.currentTarget;
  if (!validateForm(form)) { showToast("Revisa los campos marcados en rojo.", "warning"); return; }

  const patient = state.currentPatient;
  await withLoading(e.submitter, async () => {
    try {
      const updated = await updatePatient(patient.id, readForm(form));
      Object.assign(patient, updated);
      const idx = state.patients.findIndex((p) => p.id === patient.id);
      if (idx >= 0) state.patients[idx] = patient;
      state.appointments
        .filter((a) => a.pacienteId === patient.id)
        .forEach((a) => { a.pacienteNombre = patient.nombre; a.telefono = patient.telefono; });
      state.patients.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

      form.classList.remove("was-validated");
      fillForm(form, patient);
      renderRecordHeader();
      applyPermissions($("#recordHeader"));
      showToast("Ficha del paciente actualizada.");
    } catch (err) {
      notifyError(err, "No se pudo actualizar la ficha.");
    }
  });
}

/* --------------------------- Odontograma --------------------------- */
function renderOdontogram() {
  const counts = state.consultations.reduce((acc, c) => {
    acc[c.piezaDental] = (acc[c.piezaDental] || 0) + 1;
    return acc;
  }, {});
  const selected = $("#toothSelect").value;
  const interactive = can("consultations:create");

  const tooth = (n) => {
    const count = counts[n] || 0;
    const classes = ["tooth", count ? "tooth-treated" : "", String(n) === selected ? "tooth-selected" : ""].join(" ");
    const title = `Pieza ${n}${count ? ` · ${count} tratamiento${count > 1 ? "s" : ""}` : ""}`;
    return `<button type="button" class="${classes}" data-action="select-tooth" data-tooth="${n}" title="${title}" aria-label="${title}" ${interactive ? "" : "disabled"}>
      <span>${n}</span>${count ? `<small>${count}</small>` : ""}</button>`;
  };
  const row = (left, right) => `
    <div class="tooth-row">
      <div class="tooth-quadrant">${left.map(tooth).join("")}</div>
      <div class="tooth-quadrant">${right.map(tooth).join("")}</div>
    </div>`;

  $("#odontogram").innerHTML = `
    <div class="tooth-label">Superior</div>
    ${row(TEETH.upperRight, TEETH.upperLeft)}
    <div class="tooth-divider"></div>
    ${row(TEETH.lowerRight, TEETH.lowerLeft)}
    <div class="tooth-label">Inferior</div>`;
}

function selectTooth(n) {
  if (!can("consultations:create")) return;
  $("#toothSelect").value = n;
  renderOdontogram();
  bootstrap.Tab.getOrCreateInstance($("#tab-historial-btn")).show();
  $("#cTratamiento").focus();
}

/* --------------------------- Historial --------------------------- */
function renderTimeline(highlightId = null) {
  const list = state.consultations;
  const total = list.reduce((sum, c) => sum + (Number(c.costo) || 0), 0);
  const last = list[0]?.fecha;

  $("#consultCount").textContent = list.length;
  $("#consultSummary").innerHTML = [
    { label: "Consultas", value: list.length, icon: "clipboard2-pulse" },
    { label: "Total facturado", value: money.format(total), icon: "cash-coin" },
    { label: "Última visita", value: last ? formatDateShort(last) : "—", icon: "clock-history" },
  ].map((s) => `
    <div class="col-4">
      <div class="stat-mini">
        <i class="bi bi-${s.icon}"></i>
        <div class="stat-mini-value">${s.value}</div>
        <div class="stat-mini-label">${s.label}</div>
      </div>
    </div>`).join("");

  const timeline = $("#consultTimeline");
  if (!list.length) {
    timeline.innerHTML = emptyHTML("journal-medical", "Sin consultas registradas", "El historial clínico del paciente aparecerá aquí en orden cronológico.");
    return;
  }

  timeline.innerHTML = list.map((c) => `
    <article class="timeline-item ${c.id === highlightId ? "timeline-new" : ""}" data-consultation-id="${escapeHTML(c.id)}">
      <span class="timeline-dot"></span>
      <div class="timeline-card">
        <div class="d-flex justify-content-between flex-wrap gap-2">
          <div>
            <div class="small text-secondary"><i class="bi bi-calendar3 me-1"></i>${formatDateLong(c.fecha)}</div>
            <h3 class="h6 mb-1 mt-1">${escapeHTML(c.tratamiento)}</h3>
          </div>
          <div class="text-end">
            <span class="badge tooth-badge">${c.piezaDental === GENERAL_TOOTH ? "General" : `Pieza ${escapeHTML(c.piezaDental)}`}</span>
            <div class="fw-semibold mt-1">${money.format(c.costo)}</div>
          </div>
        </div>
        ${c.notas ? `<p class="small mb-2 mt-1 notes">${escapeHTML(c.notas)}</p>` : ""}
        <div class="d-flex justify-content-between align-items-center small text-secondary">
          <span><i class="bi bi-person-badge me-1"></i>${escapeHTML(c.doctorNombre || "—")}</span>
          ${can("consultations:delete") ? `<button class="btn btn-sm btn-link text-danger p-0" data-action="delete-consultation" data-id="${escapeHTML(c.id)}"><i class="bi bi-trash me-1"></i>Eliminar</button>` : ""}
        </div>
      </div>
    </article>`).join("");

  if (highlightId) {
    timeline.querySelector(".timeline-new")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function handleConsultationSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (!validateForm(form)) { showToast("Completa los campos obligatorios de la consulta.", "warning"); return; }

  const patientId = state.currentPatient?.id;
  if (!patientId) return;

  await withLoading(e.submitter, async () => {
    try {
      const consultation = await addConsultation(patientId, readForm(form));
      if (state.currentPatient?.id !== patientId) return;

      // Actualización inmediata del DOM sin recargar
      state.consultations.unshift(consultation);
      sortConsultations(state.consultations);
      resetForm(form);
      $("#cFecha").value = todayISO();
      renderOdontogram();
      renderTimeline(consultation.id);
      showToast("Consulta registrada en el expediente.");
    } catch (err) {
      notifyError(err, "No se pudo registrar la consulta.");
    }
  });
}

async function handleDeleteConsultation(id, btn) {
  const c = state.consultations.find((x) => x.id === id);
  if (!c) return;
  const ok = await confirmDialog({
    title: "Eliminar consulta",
    message: `¿Eliminar el registro «${c.tratamiento}» del ${formatDateShort(c.fecha)}? Esta acción no se puede deshacer.`,
    confirmText: "Eliminar",
  });
  if (!ok) return;

  const patientId = state.currentPatient.id;
  await withLoading(btn, async () => {
    try {
      await deleteConsultation(patientId, id);
      state.consultations = state.consultations.filter((x) => x.id !== id);
      renderOdontogram();
      renderTimeline();
      showToast("Consulta eliminada.");
    } catch (err) {
      notifyError(err, "No se pudo eliminar la consulta.");
    }
  }, "");
}

/* --------------------------- Citas del paciente --------------------------- */
function renderPatientAppointments() {
  const list = state.appointments
    .filter((a) => a.pacienteId === state.currentPatient.id)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.hora.localeCompare(a.hora));

  $("#patientAppointments").innerHTML = list.length
    ? list.map((a) => `
      <div class="list-group-item d-flex flex-wrap align-items-center gap-3">
        <div class="flex-grow-1">
          <div class="fw-semibold">${formatDateLong(a.fecha)} · ${formatTime12(a.hora)}</div>
          <div class="small text-secondary">${escapeHTML(a.motivo)}</div>
        </div>
        ${statusBadge(a.estado)}
        ${whatsappButton(a)}
      </div>`).join("")
    : emptyHTML("calendar2", "Sin citas", "Este paciente no tiene citas registradas.");
}

/* ================================================================== */
/* Citas                                                               */
/* ================================================================== */
function renderAppointments() {
  $$("#apptFilters [data-filter]").forEach((b) => {
    const active = b.dataset.filter === state.apptFilter;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });

  const tbody = $("#appointmentsTableBody");
  const list = filterAppointments(state.appointments, state.apptFilter, state.apptSearch);

  if (!list.length) {
    tbody.innerHTML = tableMessageRow(7, emptyHTML("calendar-x", "No hay citas en esta vista", "Cambia el filtro o agenda una nueva cita."));
    return;
  }

  tbody.innerHTML = list.map((a) => {
    const info = getReminderInfo(a);
    const overdue = a.estado === ESTADOS.PROGRAMADA && !info.isUpcoming;
    const isScheduled = a.estado === ESTADOS.PROGRAMADA;
    return `
      <tr class="${overdue ? "row-overdue" : ""}">
        <td>
          <a class="fw-semibold link-body-emphasis text-decoration-none" href="#/expediente/${encodeURIComponent(a.pacienteId)}">${escapeHTML(a.pacienteNombre)}</a>
          <div class="small text-secondary">${escapeHTML(a.telefono)}</div>
        </td>
        <td class="text-nowrap">${formatDateShort(a.fecha)}<div class="small ${overdue ? "text-danger" : "text-secondary"}">${info.label}</div></td>
        <td class="text-nowrap">${formatTime12(a.hora)}</td>
        <td class="d-none d-md-table-cell">${escapeHTML(a.motivo)}</td>
        <td>${statusBadge(a.estado)}</td>
        <td class="d-none d-lg-table-cell">${reminderBadge(a)}</td>
        <td class="text-end text-nowrap">
          ${whatsappButton(a)}
          ${isScheduled && can("appointments:update") ? `
            <button class="btn btn-sm btn-light text-success" data-action="complete-appt" data-id="${a.id}" title="Marcar como completada" aria-label="Marcar como completada"><i class="bi bi-check2-circle"></i></button>
            <button class="btn btn-sm btn-light text-warning" data-action="cancel-appt" data-id="${a.id}" title="Cancelar cita" aria-label="Cancelar cita"><i class="bi bi-x-circle"></i></button>` : ""}
          ${can("appointments:delete") ? `<button class="btn btn-sm btn-light text-danger" data-action="delete-appt" data-id="${a.id}" title="Eliminar" aria-label="Eliminar cita"><i class="bi bi-trash"></i></button>` : ""}
        </td>
      </tr>`;
  }).join("");
}

function openAppointmentModal(patientId = null) {
  if (!state.patients.length) { showToast("Primero registra al menos un paciente.", "warning"); return; }

  const form = $("#appointmentForm");
  resetForm(form);
  const sorted = [...state.patients].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  $("#apptPatient").innerHTML = `<option value="">Seleccionar paciente…</option>` +
    sorted.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.nombre)} — ${escapeHTML(p.dui)}</option>`).join("");
  if (patientId) $("#apptPatient").value = patientId;
  $("#apptFecha").min = todayISO();
  $("#apptFecha").value = todayISO();

  bootstrap.Modal.getOrCreateInstance($("#appointmentModal")).show();
}

async function handleAppointmentSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  if (!validateForm(form)) { showToast("Revisa los campos de la cita.", "warning"); return; }

  const data = readForm(form);
  const patient = state.patients.find((p) => p.id === data.pacienteId);

  await withLoading(e.submitter, async () => {
    try {
      const appt = await createAppointment(data, patient);
      state.appointments.push(appt);
      sortAppointments(state.appointments);
      bootstrap.Modal.getInstance($("#appointmentModal"))?.hide();
      showToast(`Cita agendada para ${appt.pacienteNombre}: ${formatDateShort(appt.fecha)}, ${formatTime12(appt.hora)}.`);
      rerenderView();
    } catch (err) {
      notifyError(err, "No se pudo agendar la cita.");
    }
  }, "Agendando…");
}

async function handleAppointmentStatus(id, estado, btn) {
  const appt = state.appointments.find((a) => a.id === id);
  if (!appt) return;

  if (estado === ESTADOS.CANCELADA) {
    const ok = await confirmDialog({
      title: "Cancelar cita",
      message: `¿Cancelar la cita de ${appt.pacienteNombre} del ${formatDateShort(appt.fecha)} a las ${formatTime12(appt.hora)}?`,
      confirmText: "Cancelar cita",
      variant: "warning",
    });
    if (!ok) return;
  }

  await withLoading(btn, async () => {
    try {
      await updateAppointmentStatus(id, estado);
      appt.estado = estado;
      showToast(estado === ESTADOS.COMPLETADA ? "Cita marcada como completada." : "Cita cancelada.", estado === ESTADOS.COMPLETADA ? "success" : "info");
      rerenderView();
    } catch (err) {
      notifyError(err, "No se pudo actualizar la cita.");
    }
  }, "");
}

async function handleDeleteAppointment(id, btn) {
  const appt = state.appointments.find((a) => a.id === id);
  if (!appt) return;
  const ok = await confirmDialog({
    title: "Eliminar cita",
    message: `¿Eliminar definitivamente la cita de ${appt.pacienteNombre}?`,
    confirmText: "Eliminar",
  });
  if (!ok) return;

  await withLoading(btn, async () => {
    try {
      await deleteAppointment(id);
      state.appointments = state.appointments.filter((a) => a.id !== id);
      showToast("Cita eliminada.");
      rerenderView();
    } catch (err) {
      notifyError(err, "No se pudo eliminar la cita.");
    }
  }, "");
}

/** Sin awaits antes de sendWhatsAppReminder: window.open debe ocurrir dentro del clic. */
async function handleSendReminder(id) {
  const appt = state.appointments.find((a) => a.id === id);
  if (!appt) return;
  try {
    const result = await sendWhatsAppReminder(appt);
    if (!result.opened) {
      showToast("El navegador bloqueó la ventana de WhatsApp. Permite las ventanas emergentes para este sitio.", "warning");
      return;
    }
    if (result.saved) {
      appt.recordatorioEnviado = true;
      appt.recordatorioFecha = new Date();
      showToast(`Mensaje preparado para ${appt.pacienteNombre}. Revisa la pestaña de WhatsApp para enviarlo.`);
    } else {
      showToast("Se abrió WhatsApp, pero no se pudo registrar el envío en el sistema.", "warning");
    }
    rerenderView();
  } catch (err) {
    notifyError(err, "No se pudo preparar el recordatorio.");
  }
}

/* ================================================================== */
/* Eventos                                                             */
/* ================================================================== */
function onDocumentClick(e) {
  const actionEl = e.target.closest("[data-action]");
  if (!actionEl) {
    const row = e.target.closest("[data-patient-row]");
    if (row) location.hash = `#/expediente/${encodeURIComponent(row.dataset.patientRow)}`;
    return;
  }

  const { action, id } = actionEl.dataset;
  switch (action) {
    case "new-patient": openPatientModal(); break;
    case "new-appointment": openAppointmentModal(); break;
    case "schedule-for": openAppointmentModal(id); break;
    case "schedule-current": openAppointmentModal(state.currentPatient?.id); break;
    case "view-patient": location.hash = `#/expediente/${encodeURIComponent(id)}`; break;
    case "delete-patient": handleDeletePatient(id, actionEl); break;
    case "delete-current-patient": if (state.currentPatient) handleDeletePatient(state.currentPatient.id, actionEl); break;
    case "send-reminder": handleSendReminder(id); break;
    case "complete-appt": handleAppointmentStatus(id, ESTADOS.COMPLETADA, actionEl); break;
    case "cancel-appt": handleAppointmentStatus(id, ESTADOS.CANCELADA, actionEl); break;
    case "delete-appt": handleDeleteAppointment(id, actionEl); break;
    case "delete-consultation": handleDeleteConsultation(id, actionEl); break;
    case "select-tooth": selectTooth(actionEl.dataset.tooth); break;
    case "appt-filter": state.apptFilter = actionEl.dataset.filter; renderAppointments(); break;
    case "refresh-patients": refreshPatients(actionEl); break;
    case "refresh-appts": refreshAppointments(actionEl); break;
    case "logout": handleLogout(actionEl); break;
  }
}

async function handleLogout(btn) {
  await withLoading(btn, async () => {
    try {
      await logout();
    } catch (err) {
      notifyError(err, "No se pudo cerrar la sesión.");
    }
  }, "");
}

function bindEvents() {
  document.addEventListener("click", onDocumentClick);

  $("#patientsTableBody").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-patient-row]")) {
      location.hash = `#/expediente/${encodeURIComponent(e.target.dataset.patientRow)}`;
    }
  });

  $("#patientSearch").addEventListener("input", (e) => {
    state.patientSearch = e.target.value;
    renderPatientsTable();
  });
  $("#apptSearch").addEventListener("input", (e) => {
    state.apptSearch = e.target.value;
    renderAppointments();
  });

  // Formato automático del DUI en cualquier formulario
  document.addEventListener("input", (e) => {
    if (e.target.name === "dui") e.target.value = formatDUI(e.target.value);
  });

  $("#patientForm").addEventListener("submit", handlePatientSubmit);
  $("#fichaForm").addEventListener("submit", handleFichaSubmit);
  $("#consultationForm").addEventListener("submit", handleConsultationSubmit);
  $("#appointmentForm").addEventListener("submit", handleAppointmentSubmit);
  $("#toothSelect").addEventListener("change", renderOdontogram);

  window.addEventListener("hashchange", router);
}

/* ================================================================== */
/* Arranque                                                            */
/* ================================================================== */
function setupStaticUI() {
  const u = state.user;
  $("#userName").textContent = u.nombre;
  $("#userRole").textContent = ROLE_LABELS[u.rol];
  $("#userAvatar").textContent = initials(u.nombre);
  $("#roleBadge").textContent = ROLE_LABELS[u.rol];
  $("#roleBadge").classList.add(`role-${u.rol}`);
  $("#todayLabel").textContent = formatDateLong(todayISO());

  renderPatientFields($("#patientFormFields"), "pm");
  renderPatientFields($("#fichaFields"), "fi");

  $("#toothSelect").innerHTML =
    `<option value="">Seleccionar…</option><option value="${GENERAL_TOOTH}">General / boca completa</option>` +
    QUADRANTS.map((q) => `<optgroup label="${q.label}">${q.teeth.map((t) => `<option value="${t}">Pieza ${t}</option>`).join("")}</optgroup>`).join("");
  $("#cFecha").max = todayISO();

  $("#treatmentList").innerHTML = COMMON_TREATMENTS.map((t) => `<option value="${t}"></option>`).join("");
  $("#reasonList").innerHTML = COMMON_REASONS.map((r) => `<option value="${r}"></option>`).join("");

  applyPermissions();
}

async function init() {
  try {
    const user = await protectPage("login.html");
    if (!user) return; // la guardia ya redirigió al login

    state.user = user;
    setupStaticUI();
    bindEvents();

    await Promise.all([loadPatients(), loadAppointments()]);
    document.body.classList.remove("app-loading");
    await router();

    watchSession(() => window.location.replace("login.html"));
  } catch (err) {
    document.body.classList.remove("app-loading");
    notifyError(err, "No se pudo iniciar la aplicación.");
  }
}

init();
