import {
  ROLES,
  addAssignment,
  exportState,
  getAssignments,
  getPeople,
  getSettings,
  initializeState,
  replaceStateFromImport,
  saveSettings,
  upsertAssignment,
} from "./storage.js";
import { addSharedPerson, loadPeople, updateSharedPerson } from "./data.js";
import {
  STATUS,
  assertCanSelectPerson,
  completeAssignment,
  confirmAssignment,
  createSelectionAssignment as buildSelectionAssignment,
  declineAssignment,
  getCurrentAssignmentForService,
  getHomeActionState,
} from "./assignment-workflow.js";
import { selectNextPerson } from "./rotation.js";
import { buildParticipationSummary, getHomeStats } from "./people.js";
import { displayPersonName } from "./people-model.js";

const OPENING_READING_ROLE_ID = "opening-reading";

const REASON_TEXT = {
  unavailable_service: "No está disponible para este servicio",
  shy: "Prefiere no leer / le da pena",
  pause: "No desea participar por ahora",
  remove_rotation: "Quitar de la rotación",
  other: "Otro",
};

const STATUS_TEXT = {
  selected: "Propuesta",
  confirmed: "Confirmada",
  declined: "Reemplazada",
  completed: "Completada",
  cancelled: "Cancelada",
  none: "Sin asignación",
};

const stateRefs = {
  currentDate: "",
  sheetType: null,
  sheetTrigger: null,
};

const STATUS_ICON = { selected: "○", confirmed: "●", completed: "✓" };

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateString) {
  if (!dateString) return "Sin fecha seleccionada";
  const date = parseLocalDate(dateString);
  return new Intl.DateTimeFormat("es", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getCurrentAssignment() {
  const active = getCurrentAssignmentForService(
    getAssignments(),
    OPENING_READING_ROLE_ID,
    stateRefs.currentDate,
  );
  if (active) return active;
  return getAssignments()
    .filter((item) => item.roleId === OPENING_READING_ROLE_ID && item.serviceDate === stateRefs.currentDate && item.status === STATUS.COMPLETED)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

function announce(message) {
  const region = document.getElementById("home-live-region");
  region.textContent = "";
  requestAnimationFrame(() => { region.textContent = message; });
}

function setButtonState(buttonId, enabled) {
  const button = document.getElementById(buttonId);
  button.hidden = !enabled;
  button.disabled = !enabled;
}

function renderHome() {
  const people = getPeople();
  const assignments = getAssignments();
  const currentAssignment = getCurrentAssignment();
  const currentPerson = currentAssignment
    ? people.find((person) => person.id === currentAssignment.personId)
    : null;

  const formattedDate = formatDate(stateRefs.currentDate);
  document.getElementById("next-service-label").textContent = formattedDate;
  document.getElementById("home-service-date").value = stateRefs.currentDate;
  document.getElementById("btn-edit-service-date").setAttribute("aria-label", `Cambiar fecha del próximo servicio, actual ${formattedDate}`);
  document.getElementById("assignment-person").textContent = displayPersonName(currentPerson) || "Sin asignar aún";
  document.getElementById("assignment-person").classList.toggle("muted", !currentPerson);

  const status = currentAssignment?.status;
  const statusBadge = document.getElementById("assignment-status");
  statusBadge.hidden = !status;
  statusBadge.className = `status-badge status-${status || "none"}`;
  statusBadge.textContent = status ? `${STATUS_ICON[status] || ""} ${STATUS_TEXT[status]}`.trim() : "";

  const actionState = getHomeActionState(currentAssignment);
  setButtonState("btn-select-person", actionState.canSelect);
  setButtonState("btn-confirm", actionState.canConfirm);
  setButtonState("btn-complete", actionState.canComplete);
  setButtonState("btn-decline", actionState.canDecline);

  const stats = getHomeStats(people, assignments, OPENING_READING_ROLE_ID);
  const hasEligiblePeople = stats.rotationTotal > 0;
  setButtonState("btn-go-people", !hasEligiblePeople);
  if (!hasEligiblePeople) setButtonState("btn-select-person", false);

  const helper = document.getElementById("assignment-helper");
  if (!hasEligiblePeople) {
    helper.textContent = "No hay personas en la rotación. Agrega personas para comenzar.";
  } else if (!currentAssignment) {
    helper.textContent = "Toca «Seleccionar persona» para proponer a alguien.";
  } else if (status === STATUS.COMPLETED) {
    helper.textContent = "Servicio completado. Cambia la fecha para planificar el próximo. Para corregir, cambia la fecha o edita en Historial.";
  } else {
    helper.textContent = "";
  }
  document.getElementById("rotation-empty").hidden = hasEligiblePeople;
  const statsRoot = document.getElementById("home-stats");
  statsRoot.innerHTML = "";

  [
    { value: stats.rotationTotal, label: "Personas elegibles" },
    { value: stats.participated, label: "Ya participaron" },
    { value: stats.waiting, label: "Esperando oportunidad" },
  ].forEach((stat, index) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.role = "button";
    card.tabIndex = 0;
    card.dataset.sheet = ["eligible", "participated", "waiting"][index];
    card.setAttribute("aria-label", `${stat.label}, ${stat.value}. Ver lista.`);
    const value = document.createElement("strong");
    value.textContent = `${stat.value}`;
    const chevron = document.createElement("span");
    chevron.className = "stat-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
    const label = document.createElement("span");
    label.textContent = stat.label;
    card.append(value, chevron, label);
    statsRoot.appendChild(card);
  });

  if (document.getElementById("people-sheet").open && stateRefs.sheetType) renderPeopleSheet(stateRefs.sheetType);
}

function getSheetPeople(type) {
  const people = getPeople();
  const eligible = people.filter((person) => person.active && !person.paused);
  const summaries = new Map(buildParticipationSummary(people, getAssignments(), OPENING_READING_ROLE_ID).map((item) => [item.personId, item]));
  let filtered = eligible;
  if (type === "participated") filtered = eligible.filter((person) => summaries.get(person.id)?.completedCount > 0);
  if (type === "waiting") filtered = eligible.filter((person) => summaries.get(person.id)?.completedCount === 0);
  filtered.sort(type === "participated"
    ? (a, b) => (summaries.get(b.id)?.lastServiceDate || "").localeCompare(summaries.get(a.id)?.lastServiceDate || "") || a.name.localeCompare(b.name)
    : (a, b) => a.name.localeCompare(b.name));
  return filtered.map((person) => ({ person, summary: summaries.get(person.id) }));
}

function renderPeopleSheet(type) {
  const config = {
    eligible: ["Personas elegibles", "No hay personas elegibles. Revisa quién está activo o en pausa."],
    participated: ["Ya participaron", "Nadie ha participado todavía."],
    waiting: ["Esperando oportunidad", "Todos han participado al menos una vez. 🎉"],
  }[type];
  const rows = getSheetPeople(type);
  document.getElementById("sheet-title").textContent = `${config[0]} (${rows.length})`;
  const list = document.getElementById("sheet-people-list");
  list.innerHTML = "";
  rows.forEach(({ person, summary }) => {
    const li = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = displayPersonName(person);
    const detail = document.createElement("span");
    detail.className = "muted";
    if (type === "eligible") detail.textContent = summary.completedCount ? `Ha participado ${summary.completedCount} · Última vez: ${formatDate(summary.lastServiceDate)}` : "Nunca ha participado";
    else if (type === "participated") detail.textContent = `Última vez: ${formatDate(summary.lastServiceDate)} · ${summary.completedCount} ${summary.completedCount === 1 ? "vez" : "veces"}`;
    else detail.textContent = "Nunca ha participado";
    li.append(name, detail);
    list.appendChild(li);
  });
  const empty = document.getElementById("sheet-empty");
  empty.hidden = rows.length > 0;
  empty.textContent = config[1];
}

function createSelectionAssignment(personId) {
  const record = buildSelectionAssignment({
    id: uid("assignment"),
    personId,
    roleId: OPENING_READING_ROLE_ID,
    serviceDate: stateRefs.currentDate,
  });
  addAssignment(record);
  return record;
}

function selectPerson() {
  const current = getCurrentAssignment();
  try {
    assertCanSelectPerson(current);
  } catch (error) {
    alert(error.message);
    return;
  }

  const people = getPeople();
  const assignments = getAssignments();
  const picked = selectNextPerson({
    people,
    assignments,
    roleId: OPENING_READING_ROLE_ID,
    serviceDate: stateRefs.currentDate,
  });

  if (!picked) {
    alert("No se encontró una persona elegible. Revise quiénes están activos o en pausa.");
    return;
  }

  createSelectionAssignment(picked.id);
  renderAll();
  announce(`Propuesta: ${displayPersonName(picked)}`);
}

function confirmCurrentAssignment() {
  const current = getCurrentAssignment();
  try {
    upsertAssignment(confirmAssignment(current));
  } catch (error) {
    alert(error.message);
    return;
  }
  renderAll();
  announce(`Confirmada: ${displayPersonName(getPeople().find((person) => person.id === current.personId))}`);
}

function completeCurrentAssignment() {
  const current = getCurrentAssignment();
  try {
    upsertAssignment(completeAssignment(current));
  } catch (error) {
    alert(error.message);
    return;
  }
  renderAll();
  announce(`Completada: ${displayPersonName(getPeople().find((person) => person.id === current.personId))}`);
}

async function declineAndReplace(reasonCode, reasonText) {
  const current = getCurrentAssignment();
  let declinedAssignment;

  try {
    declinedAssignment = declineAssignment(current, { reasonCode, reasonText });
  } catch (error) {
    alert(error.message);
    return;
  }

  try {
    if (reasonCode === "pause") {
      await updateSharedPerson(current.personId, { paused: true });
    } else if (reasonCode === "remove_rotation") {
      await updateSharedPerson(current.personId, { active: false, paused: false });
    }
  } catch (error) {
    alert(error.message);
    if (!error.localSaved) {
      return;
    }
  }

  upsertAssignment(declinedAssignment);

  const nextPerson = selectNextPerson({
    people: getPeople(),
    assignments: getAssignments(),
    roleId: OPENING_READING_ROLE_ID,
    serviceDate: stateRefs.currentDate,
  });

  if (nextPerson) {
    createSelectionAssignment(nextPerson.id);
  } else {
    alert("No hay otra persona elegible para este servicio.");
  }
  renderAll();
  const replacement = getCurrentAssignment();
  if (replacement) announce(`Nueva propuesta: ${displayPersonName(getPeople().find((person) => person.id === replacement.personId))}`);
}

function renderPeople() {
  const list = document.getElementById("people-list");
  const people = getPeople().sort((a, b) => a.name.localeCompare(b.name));

  list.innerHTML = "";
  people.forEach((person) => {
    const li = document.createElement("li");
    li.className = "people-item";
    const name = document.createElement("strong");
    name.textContent = displayPersonName(person);

    const status = document.createElement("div");
    status.className = "muted";
    status.textContent = `${person.active ? "Activa" : "Inactiva"} · ${person.paused ? "En pausa" : "Disponible"}`;

    const actions = document.createElement("div");
    actions.className = "person-actions";

    const renameBtn = document.createElement("button");
    renameBtn.className = "btn";
    renameBtn.dataset.action = "rename";
    renameBtn.dataset.id = person.id;
    renameBtn.textContent = "Editar";

    const activeLabel = document.createElement("label");
    const activeInput = document.createElement("input");
    activeInput.type = "checkbox";
    activeInput.dataset.action = "active";
    activeInput.dataset.id = person.id;
    activeInput.checked = person.active;
    activeLabel.append(activeInput, " Activa");

    const pausedLabel = document.createElement("label");
    const pausedInput = document.createElement("input");
    pausedInput.type = "checkbox";
    pausedInput.dataset.action = "paused";
    pausedInput.dataset.id = person.id;
    pausedInput.checked = person.paused;
    pausedLabel.append(pausedInput, " En pausa");

    actions.append(renameBtn, activeLabel, pausedLabel);
    li.append(name, status, actions);
    list.appendChild(li);
  });
}

function renderHistory() {
  const historyList = document.getElementById("history-list");
  const participationList = document.getElementById("participation-list");
  const assignments = getAssignments().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const people = getPeople();

  historyList.innerHTML = "";
  if (!assignments.length) {
    const empty = document.createElement("li");
    empty.className = "muted empty-list";
    empty.textContent = "Todavía no hay asignaciones registradas.";
    historyList.appendChild(empty);
  }
  assignments.forEach((assignment) => {
    const person = people.find((item) => item.id === assignment.personId);
    const role = ROLES.find((item) => item.id === assignment.roleId);
    const li = document.createElement("li");
    li.className = "history-item";
    const dateEl = document.createElement("strong");
    dateEl.textContent = formatDate(assignment.serviceDate);

    const personEl = document.createElement("div");
    personEl.textContent = displayPersonName(person) || "Persona desconocida";

    const roleStatus = document.createElement("div");
    roleStatus.className = "muted";
    roleStatus.textContent = `${role?.displayNameEs || assignment.roleId} · ${STATUS_TEXT[assignment.status] || assignment.status}`;

    li.append(dateEl, personEl, roleStatus);

    if (assignment.reasonCode) {
      const reasonEl = document.createElement("div");
      reasonEl.className = "muted";
      const reasonLabel = REASON_TEXT[assignment.reasonCode] || assignment.reasonCode;
      reasonEl.textContent = `Motivo: ${reasonLabel}${assignment.reasonText ? ` (${assignment.reasonText})` : ""}`;
      li.append(reasonEl);
    }
    historyList.appendChild(li);
  });

  participationList.innerHTML = "";
  const completedParticipation = buildParticipationSummary(people, assignments, OPENING_READING_ROLE_ID).filter((item) => item.completedCount > 0);
  if (!completedParticipation.length) {
    const empty = document.createElement("li");
    empty.className = "muted empty-list";
    empty.textContent = "Aún no hay participaciones completadas.";
    participationList.appendChild(empty);
  }
  completedParticipation.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    const person = people.find((entry) => entry.id === item.personId);
    const nameEl = document.createElement("strong");
    nameEl.textContent = displayPersonName(person) || item.name;
    const completedEl = document.createElement("div");
    completedEl.className = "muted";
    completedEl.textContent = `Veces completadas: ${item.completedCount}`;
    const lastServedEl = document.createElement("div");
    lastServedEl.className = "muted";
    lastServedEl.textContent = `Última vez: ${item.lastServiceDate ? formatDate(item.lastServiceDate) : "Nunca"}`;
    li.append(nameEl, completedEl, lastServedEl);
    participationList.appendChild(li);
  });
}

function renderSettings() {
  document.getElementById("next-service-date").value = stateRefs.currentDate;
}

function renderAll() {
  renderHome();
  renderPeople();
  renderHistory();
  renderSettings();
}

function setupTabs() {
  const views = document.querySelectorAll(".view");
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.classList.remove("active");
        btn.removeAttribute("aria-current");
      });
      button.classList.add("active");
      button.setAttribute("aria-current", "page");
      views.forEach((view) => view.classList.remove("active"));
      document.getElementById(`view-${tab}`).classList.add("active");
    });
  });
}

function switchToTab(tab) {
  document.querySelector(`.nav-btn[data-tab="${tab}"]`).click();
}

function setupHomeInteractions() {
  const dateInput = document.getElementById("home-service-date");
  document.getElementById("btn-edit-service-date").addEventListener("click", () => {
    if (typeof dateInput.showPicker === "function") dateInput.showPicker();
    else { dateInput.tabIndex = 0; dateInput.focus(); dateInput.click(); }
  });
  dateInput.addEventListener("change", () => {
    if (!dateInput.value) return;
    saveSettings({ nextServiceDate: dateInput.value });
    stateRefs.currentDate = dateInput.value;
    renderAll();
    announce(`Fecha actualizada: ${formatDate(dateInput.value)}`);
  });
  document.getElementById("btn-go-people").addEventListener("click", () => switchToTab("people"));

  const stats = document.getElementById("home-stats");
  const openFromCard = (card) => {
    stateRefs.sheetType = card.dataset.sheet;
    stateRefs.sheetTrigger = card;
    renderPeopleSheet(stateRefs.sheetType);
    document.getElementById("people-sheet").showModal();
    document.getElementById("btn-close-sheet").focus();
  };
  stats.addEventListener("click", (event) => { const card = event.target.closest(".stat-card"); if (card) openFromCard(card); });
  stats.addEventListener("keydown", (event) => {
    const card = event.target.closest(".stat-card");
    if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openFromCard(card); }
  });
  const sheet = document.getElementById("people-sheet");
  document.getElementById("btn-close-sheet").addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (event) => { if (event.target === sheet) sheet.close(); });
  sheet.addEventListener("close", () => { stateRefs.sheetTrigger?.focus(); stateRefs.sheetTrigger = null; stateRefs.sheetType = null; });
}

async function refreshPeople({ showFallbackMessage = false } = {}) {
  const { fromCache, error } = await loadPeople();
  if (fromCache && showFallbackMessage) {
    alert(
      `No se pudo conectar con la base de datos compartida de personas. Se están mostrando datos locales en caché. ${error?.message || ""}`.trim(),
    );
  }
  renderAll();
}

function setupPeopleHandlers() {
  document.getElementById("add-person-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const nameInput = document.getElementById("new-person-name");
    const titleInput = document.getElementById("new-person-title");
    const name = nameInput.value.trim();
    const title = titleInput.value.trim();
    if (!name) return;

    try {
      await addSharedPerson({ name, title: title || null });
    } catch (error) {
      alert(error.message);
    }

    nameInput.value = "";
    titleInput.value = "";
    renderAll();
    announce(`Fecha actualizada: ${formatDate(value)}`);
  });

  document.getElementById("people-list").addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action !== "rename") return;
    const personId = target.dataset.id;
    const people = getPeople();
    const person = people.find((item) => item.id === personId);
    if (!person) return;

    const updatedName = prompt("Nuevo nombre:", person.name);
    if (updatedName === null || !updatedName.trim()) return;
    const updatedTitle = prompt("Título (opcional, deje vacío para quitarlo):", person.title || "");
    if (updatedTitle === null) return;

    try {
      await updateSharedPerson(personId, { name: updatedName.trim(), title: updatedTitle.trim() || null });
    } catch (error) {
      alert(error.message);
    }

    renderAll();
  });

  document.getElementById("people-list").addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const personId = target.dataset.id;
    if (!personId) return;

    try {
      if (target.dataset.action === "active") {
        await updateSharedPerson(personId, { active: target.checked });
      }
      if (target.dataset.action === "paused") {
        await updateSharedPerson(personId, { paused: target.checked });
      }
    } catch (error) {
      alert(error.message);
    }

    renderAll();
  });
}

function exportBackup() {
  const data = exportState();
  const today = localDateString(new Date());
  const fileName = `ibch-service-planner-backup-${today}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importBackup(file) {
  if (!file) {
    alert("Primero seleccione un archivo de respaldo.");
    return;
  }

  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert("El archivo JSON no es válido.");
    return;
  }

  try {
    replaceStateFromImport(parsed);
  } catch (error) {
    alert(error.message);
    return;
  }

  const settings = getSettings();
  stateRefs.currentDate = settings.nextServiceDate;
  renderAll();
  alert("Respaldo importado correctamente.");
}

function setupAssignmentActions() {
  document.getElementById("btn-select-person").addEventListener("click", selectPerson);
  document.getElementById("btn-confirm").addEventListener("click", confirmCurrentAssignment);
  document.getElementById("btn-complete").addEventListener("click", completeCurrentAssignment);
  document.getElementById("btn-decline").addEventListener("click", () => {
    if (!getHomeActionState(getCurrentAssignment()).canDecline) {
      alert("No hay una asignación activa para reemplazar.");
      return;
    }
    document.getElementById("decline-dialog").showModal();
  });

  document.getElementById("decline-dialog").addEventListener("close", () => {
    const dialog = document.getElementById("decline-dialog");
    if (dialog.returnValue !== "submit") return;
    const reasonCode = document.getElementById("decline-reason").value;
    const notes = document.getElementById("decline-notes").value.trim();
    declineAndReplace(reasonCode, notes);
    document.getElementById("decline-notes").value = "";
  });
}

function setupSettings() {
  document.getElementById("btn-save-date").addEventListener("click", () => {
    const value = document.getElementById("next-service-date").value;
    if (!value) return;
    saveSettings({ nextServiceDate: value });
    stateRefs.currentDate = value;
    renderAll();
  });

  document.getElementById("btn-export").addEventListener("click", exportBackup);
  document.getElementById("btn-import").addEventListener("click", () => {
    const file = document.getElementById("backup-file").files[0];
    importBackup(file);
  });
}

async function bootstrap() {
  const response = await fetch("./data/people.json", { cache: "no-cache" });
  const seed = await response.json();
  initializeState(seed.people || []);

  const settings = getSettings();
  stateRefs.currentDate = settings.nextServiceDate;

  setupTabs();
  setupHomeInteractions();
  setupPeopleHandlers();
  setupAssignmentActions();
  setupSettings();
  renderAll();

  await refreshPeople({ showFallbackMessage: true });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => undefined);
  }
}

bootstrap().catch((error) => {
  console.error(error);
  alert("No se pudieron cargar los datos de la aplicación.");
});
