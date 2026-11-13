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
  formatDateLong, formatDateShort, formatTime12, todayISO, addDaysISO, ESTADOS, COMMON_REASONS, isActive,
} from "./appointments.js";

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

const $ = (sel, root = document) => root.querySelector(sel); const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
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
  $$("[data-permission]", root).forEach((el) => el.classList.toggle("d-none", !can(el.dataset.permission))); $$
("[data-permission-hide]", root).forEach((el) => el.classList.toggle("d-none", can(el.dataset.permissionHide)));
}

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
        ${f.options.map((o) => `<option value="${o}">${o \vert{}\vert{} "Seleccionar…"}</option>`).join("")}</select>`; } else if (f.type === "textarea") { control = `<textarea class="form-control" id="${id}" name="${f.name}" rows="2" ${attrs}></textarea>`; } else { control = `<input class="form-control" type="${f.type}" id="${id}" name="${f.name}" ${attrs}>`; }      return ` <div class="${f.col}"> <label class="form-label" for="${id}">${f.label}${f.required ? ' <span class="text-danger">*</span>' : ""}</label> ${control} <div class="invalid-feedback">${f.feedback \vert{}\vert{} "Campo obligatorio."}</div> </div>`; }).join(""); }  const readForm = (form) => Object.fromEntries(new FormData(form).entries());  function fillForm(form, data) { $$("[name]", form).forEach((el) => { el.value = data[el.name] ?? ""; });
}

function validateForm(form) {
  form.classList.add("was-validated");
  return form.checkValidity();
}

function resetForm(form) {
  form.reset();
  form.classList.remove("was-validated");
}

function statusBadge(estado) {
  const map = {
    [ESTADOS.PROGRAMADA]: ["primary", "calendar-event", "Programada"],
    [ESTADOS.CONFIRMADA]: ["info", "patch-check", "Confirmada"],
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
  if (!isActive(appt)) return `<span class="text-secondary small">—</span>`;
  const info = getReminderInfo(appt);
  if (info.isDueSoon) return `<span class="badge bg-warning-subtle text-warning-emphasis"><i class="bi bi-bell me-1"></i>Pendiente</span>`;
  return `<span class="text-secondary small">${info.isUpcoming ? "Aún no" : "—"}</span>`;
}

function whatsappButton(appt, size = "sm") {
  if (!isActive(appt) || !can("reminders:send") || !getReminderInfo(appt).isUpcoming) return "";
  const label = appt.recordatorioEnviado ? "Reenviar recordatorio" : "Enviar recordatorio WhatsApp";
  return `<button class="btn btn-${size} btn-whatsapp" data-action="send-reminder" data-id="${appt.id}" title="${label}" aria-label="${label}">
    <i class="bi bi-whatsapp"></i><span class="d-none d-xl-inline ms-1">${appt.recordatorioEnviado ? "Reenviar" : "Recordar"}</span></button>`;
}

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

  $$(".view").forEach((s) => s.classList.toggle("d-none", s.dataset.view !== view)); const navKey = view === "expediente" ? "pacientes" : view; $$
("[data-nav]").forEach((a) => {
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


function rerenderView() {
  const { view } = parseHash();
  if (view === "dashboard") renderDashboard();
  else if (view === "pacientes") renderPatientsTable();
  else if (view === "citas") renderAppointments();
  else if (view === "expediente" && state.currentPatient) renderRecord({ keepForms: true });
}


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
