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
import { selectNextPerson } from "./rotation.js";
import { buildParticipationSummary, getHomeStats } from "./people.js";

const OPENING_READING_ROLE_ID = "opening-reading";

const STATUS = {
  SELECTED: "selected",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const REASON_TEXT = {
  unavailable_service: "Unavailable for this service",
  shy: "Prefers not to read / shy",
  pause: "Does not want to participate for now",
  remove_rotation: "Remove from rotation",
  other: "Other",
};

const stateRefs = {
  currentDate: "",
};

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function formatDate(dateString) {
  if (!dateString) return "No date selected";
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getCurrentAssignment() {
  const assignments = getAssignments();
  const current = assignments
    .filter(
      (item) =>
        item.roleId === OPENING_READING_ROLE_ID &&
        item.serviceDate === stateRefs.currentDate &&
        [STATUS.SELECTED, STATUS.CONFIRMED].includes(item.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return current || null;
}

function renderHome() {
  const people = getPeople();
  const assignments = getAssignments();
  const currentAssignment = getCurrentAssignment();
  const currentPerson = currentAssignment
    ? people.find((person) => person.id === currentAssignment.personId)
    : null;

  document.getElementById("next-service-label").textContent = formatDate(stateRefs.currentDate);
  document.getElementById("assignment-person").textContent = currentPerson?.name || "No assignment yet";
  document.getElementById("assignment-status").textContent = `status: ${currentAssignment?.status || "none"}`;

  const stats = getHomeStats(people, assignments, OPENING_READING_ROLE_ID);
  document.getElementById("home-stats").innerHTML = `
    <div><strong>${stats.totalPeople}</strong><br /><span>Total</span></div>
    <div><strong>${stats.participated}</strong><br /><span>Participated</span></div>
    <div><strong>${stats.waiting}</strong><br /><span>Waiting</span></div>
  `;
}

function createSelectionAssignment(personId) {
  const record = {
    id: uid("assignment"),
    personId,
    roleId: OPENING_READING_ROLE_ID,
    serviceDate: stateRefs.currentDate,
    status: STATUS.SELECTED,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  addAssignment(record);
  return record;
}

function selectPerson() {
  const people = getPeople();
  const assignments = getAssignments();
  const picked = selectNextPerson({
    people,
    assignments,
    roleId: OPENING_READING_ROLE_ID,
    serviceDate: stateRefs.currentDate,
  });

  if (!picked) {
    alert("No eligible person found. Check active/paused states.");
    return;
  }

  const current = getCurrentAssignment();
  if (current) {
    upsertAssignment({
      ...current,
      status: STATUS.CANCELLED,
      updatedAt: new Date().toISOString(),
    });
  }
  createSelectionAssignment(picked.id);
  renderAll();
}

function confirmCurrentAssignment() {
  const current = getCurrentAssignment();
  if (!current) {
    alert("Select a person first.");
    return;
  }
  upsertAssignment({
    ...current,
    status: STATUS.CONFIRMED,
    updatedAt: new Date().toISOString(),
  });
  renderAll();
}

function completeCurrentAssignment() {
  const current = getCurrentAssignment();
  if (!current) {
    alert("No active assignment to complete.");
    return;
  }
  upsertAssignment({
    ...current,
    status: STATUS.COMPLETED,
    updatedAt: new Date().toISOString(),
  });
  renderAll();
}

function declineAndReplace(reasonCode, reasonText) {
  const current = getCurrentAssignment();
  if (!current) {
    alert("No assignment to replace.");
    return;
  }

  upsertAssignment({
    ...current,
    status: STATUS.DECLINED,
    reasonCode,
    reasonText,
    updatedAt: new Date().toISOString(),
  });

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
    status.textContent = `${person.active ? "Active" : "Inactive"} · ${person.paused ? "Paused" : "Available"}`;

    const actions = document.createElement("div");
    actions.className = "person-actions";

    const renameBtn = document.createElement("button");
    renameBtn.className = "btn";
    renameBtn.dataset.action = "rename";
    renameBtn.dataset.id = person.id;
    renameBtn.textContent = "Edit";

    const activeLabel = document.createElement("label");
    const activeInput = document.createElement("input");
    activeInput.type = "checkbox";
    activeInput.dataset.action = "active";
    activeInput.dataset.id = person.id;
    activeInput.checked = person.active;
    activeLabel.append(activeInput, " Active");

    const pausedLabel = document.createElement("label");
    const pausedInput = document.createElement("input");
    pausedInput.type = "checkbox";
    pausedInput.dataset.action = "paused";
    pausedInput.dataset.id = person.id;
    pausedInput.checked = person.paused;
    pausedLabel.append(pausedInput, " Paused");

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
    dateEl.textContent = assignment.serviceDate;

    const personEl = document.createElement("div");
    personEl.textContent = person?.name || "Unknown person";

    const roleStatus = document.createElement("div");
    roleStatus.className = "muted";
    roleStatus.textContent = `${role?.displayNameEs || assignment.roleId} · ${assignment.status}`;

    li.append(dateEl, personEl, roleStatus);

    if (assignment.reasonCode) {
      const reasonEl = document.createElement("div");
      reasonEl.className = "muted";
      const reasonLabel = REASON_TEXT[assignment.reasonCode] || assignment.reasonCode;
      reasonEl.textContent = `Reason: ${reasonLabel}${assignment.reasonText ? ` (${assignment.reasonText})` : ""}`;
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
    completedEl.textContent = `Completed: ${item.completedCount}`;
    const lastServedEl = document.createElement("div");
    lastServedEl.className = "muted";
    lastServedEl.textContent = `Last served: ${item.lastServiceDate || "Never"}`;
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
    const updatedName = prompt("New name:", person.name);
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
  const today = new Date().toISOString().slice(0, 10);
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
    alert("Choose a backup file first.");
    return;
  }

  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert("Invalid JSON file.");
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
  alert("Backup imported successfully.");
}

function setupAssignmentActions() {
  document.getElementById("btn-select-person").addEventListener("click", selectPerson);
  document.getElementById("btn-confirm").addEventListener("click", confirmCurrentAssignment);
  document.getElementById("btn-complete").addEventListener("click", completeCurrentAssignment);
  document.getElementById("btn-decline").addEventListener("click", () => {
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
  const response = await fetch("data/people.json", { cache: "no-cache" });
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
  alert("Unable to load app data.");
});
