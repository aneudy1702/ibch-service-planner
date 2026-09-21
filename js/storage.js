const STORAGE_KEY = "ibch-service-planner.v1";
export const SCHEMA_VERSION = 1;

export const ROLES = [
  {
    id: "opening-reading",
    name: "Opening Reading",
    displayNameEs: "Lectura Inicial",
    active: true,
  },
];

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function nextSundayIsoDate() {
  const date = new Date();
  const day = date.getDay();
  const diff = (7 - day) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function normalizeSeedPeople(seedPeople = []) {
  const createdAt = nowIso();
  return seedPeople.map((person, index) => ({
    id: person.id || `person-${slugify(person.name || `seed-${index + 1}`)}`,
    name: person.name || `Person ${index + 1}`,
    active: person.active ?? true,
    paused: person.paused ?? false,
    createdAt: person.createdAt || createdAt,
  }));
}

function defaultState(seedPeople = []) {
  const timestamp = nowIso();
  return {
    version: SCHEMA_VERSION,
    people: normalizeSeedPeople(seedPeople),
    roles: ROLES,
    services: [],
    assignments: [],
    assignmentHistory: [],
    settings: {
      nextServiceDate: nextSundayIsoDate(),
    },
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function parseState(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.assignments)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getState() {
  return parseState(localStorage.getItem(STORAGE_KEY));
}

export function saveState(state) {
  const nextState = {
    ...state,
    meta: {
      ...(state.meta || {}),
      updatedAt: nowIso(),
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  return nextState;
}

export function initializeState(seedPeople = []) {
  const current = getState();
  if (current) return current;
  const freshState = defaultState(seedPeople);
  return saveState(freshState);
}

export function getPeople() {
  return getState()?.people || [];
}

export function savePeople(people) {
  const state = getState();
  if (!state) return null;
  return saveState({ ...state, people });
}

export function getAssignments() {
  return getState()?.assignments || [];
}

export function saveAssignments(assignments) {
  const state = getState();
  if (!state) return null;
  return saveState({ ...state, assignments });
}

export function getSettings() {
  return getState()?.settings || {};
}

export function saveSettings(settings) {
  const state = getState();
  if (!state) return null;
  return saveState({ ...state, settings: { ...state.settings, ...settings } });
}

export function addPerson(name) {
  const state = getState();
  if (!state) return null;
  const person = {
    id: `person-${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    active: true,
    paused: false,
    createdAt: nowIso(),
  };
  state.people.push(person);
  saveState(state);
  return person;
}

export function updatePerson(personId, updates) {
  const state = getState();
  if (!state) return null;
  state.people = state.people.map((person) =>
    person.id === personId
      ? {
          ...person,
          ...updates,
        }
      : person,
  );
  return saveState(state);
}

export function upsertAssignment(assignment) {
  const state = getState();
  if (!state) return null;
  const existingIndex = state.assignments.findIndex((item) => item.id === assignment.id);
  if (existingIndex === -1) {
    state.assignments.push(assignment);
  } else {
    state.assignments[existingIndex] = assignment;
  }
  return saveState(state);
}

export function addAssignment(assignment) {
  const state = getState();
  if (!state) return null;
  state.assignments.push(assignment);
  return saveState(state);
}

export function replaceStateFromImport(candidateState) {
  if (!isValidImportedState(candidateState)) {
    throw new Error("Invalid backup structure.");
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(candidateState));
  return getState();
}

export function exportState() {
  const state = getState();
  if (!state) throw new Error("No stored state to export.");
  return state;
}

export function isValidImportedState(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (candidate.version !== SCHEMA_VERSION) return false;
  if (!Array.isArray(candidate.people)) return false;
  if (!Array.isArray(candidate.assignments)) return false;
  if (!candidate.settings || typeof candidate.settings !== "object") return false;
  return true;
}
