import {
  ROLES,
  addAssignment,
  addPerson,
  exportState,
  getAssignments,
  getPeople,
  getSettings,
  initializeState,
  replaceStateFromImport,
  saveSettings,
  updatePerson,
  upsertAssignment,
} from "./storage.js";
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

const OPENING_READING_ROLE_ID = "opening-reading";

const REASON_TEXT = {
  unavailable_service: "No está disponible para este servicio",
  shy: "Prefiere no leer / le da pena",
  pause: "No desea participar por ahora",
  remove_rotation: "Quitar de la rotación",
  other: "Otro",
};

const STATUS_TEXT = {
  selected: "Seleccionada",
  confirmed: "Confirmada",
  declined: "Rechazada",
  completed: "Completada",
  cancelled: "Cancelada",
  none: "Sin asignación",
};

const stateRefs = {
  currentDate: "",
};

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
  return getCurrentAssignmentForService(
    getAssignments(),
    OPENING_READING_ROLE_ID,
    stateRefs.currentDate,
  );
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

  document.getElementById("next-service-label").textContent = formatDate(stateRefs.currentDate);
  document.getElementById("assignment-person").textContent = currentPerson?.name || "Sin asignación";
  document.getElementById("assignment-status").textContent = `Estado: ${STATUS_TEXT[currentAssignment?.status || "none"]}`;

  const actionState = getHomeActionState(currentAssignment);
  setButtonState("btn-select-person", actionState.canSelect);
  setButtonState("btn-confirm", actionState.canConfirm);
  setButtonState("btn-complete", actionState.canComplete);
  setButtonState("btn-decline", actionState.canDecline);

  const stats = getHomeStats(people, assignments, OPENING_READING_ROLE_ID);
  const statsRoot = document.getElementById("home-stats");
  statsRoot.innerHTML = "";

  [
    { value: stats.rotationTotal, label: "Personas elegibles" },
    { value: stats.participated, label: "Ya participaron" },
    { value: stats.waiting, label: "Esperando oportunidad" },
  ].forEach((stat) => {
    const card = document.createElement("div");
    const value = document.createElement("strong");
    value.textContent = `${stat.value}`;
    const label = document.createElement("span");
    label.textContent = stat.label;
    card.append(value, document.createElement("br"), label);
    statsRoot.appendChild(card);
  });
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
}

function declineAndReplace(reasonCode, reasonText) {
  const current = getCurrentAssignment();
  try {
    upsertAssignment(declineAssignment(current, { reasonCode, reasonText }));
  } catch (error) {
    alert(error.message);
    return;
  }

  if (reasonCode === "pause") {
    updatePerson(current.personId, { paused: true });
  } else if (reasonCode === "remove_rotation") {
    updatePerson(current.personId, { active: false, paused: false });
  }

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
}

function renderPeople() {
  const list = document.getElementById("people-list");
  const people = getPeople().sort((a, b) => a.name.localeCompare(b.name));

  list.innerHTML = "";
  people.forEach((person) => {
    const li = document.createElement("li");
    li.className = "people-item";
    const name = document.createElement("strong");
    name.textContent = person.name;

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
  assignments.forEach((assignment) => {
    const person = people.find((item) => item.id === assignment.personId);
    const role = ROLES.find((item) => item.id === assignment.roleId);
    const li = document.createElement("li");
    li.className = "history-item";
    const dateEl = document.createElement("strong");
    dateEl.textContent = formatDate(assignment.serviceDate);

    const personEl = document.createElement("div");
    personEl.textContent = person?.name || "Persona desconocida";

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
  buildParticipationSummary(people, assignments, OPENING_READING_ROLE_ID).forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    const nameEl = document.createElement("strong");
    nameEl.textContent = item.name;
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
      document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      views.forEach((view) => view.classList.remove("active"));
      document.getElementById(`view-${tab}`).classList.add("active");
    });
  });
}

function setupPeopleHandlers() {
  document.getElementById("add-person-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("new-person-name");
    const name = input.value.trim();
    if (!name) return;
    addPerson(name);
    input.value = "";
    renderAll();
  });

  document.getElementById("people-list").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action !== "rename") return;
    const personId = target.dataset.id;
    const people = getPeople();
    const person = people.find((item) => item.id === personId);
    if (!person) return;
    const updatedName = prompt("Nuevo nombre:", person.name);
    if (!updatedName || !updatedName.trim()) return;
    updatePerson(personId, { name: updatedName.trim() });
    renderAll();
  });

  document.getElementById("people-list").addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const personId = target.dataset.id;
    if (!personId) return;
    if (target.dataset.action === "active") {
      updatePerson(personId, { active: target.checked });
    }
    if (target.dataset.action === "paused") {
      updatePerson(personId, { paused: target.checked });
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
  setupPeopleHandlers();
  setupAssignmentActions();
  setupSettings();
  renderAll();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => undefined);
  }
}

bootstrap().catch((error) => {
  console.error(error);
  alert("No se pudieron cargar los datos de la aplicación.");
});
