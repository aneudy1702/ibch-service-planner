import { normalizePeople, normalizeTitle, slugify } from "./people-model.js";

const STORAGE_KEY = "ibch-service-planner.v1";
export const SCHEMA_VERSION = 1;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_ASSIGNMENT_STATUSES = new Set(["selected", "confirmed", "declined", "completed", "cancelled"]);
const VALID_REASON_CODES = new Set(["unavailable_service", "shy", "pause", "remove_rotation", "other"]);

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

function localDateString(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateString(value) {
  if (!ISO_DATE_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function isValidIsoDate(value) {
  return typeof value === "string" && parseLocalDateString(value) instanceof Date;
}

function normalizePersonId(personId) {
  return personId === "person-el-pastor" ? "person-carlos-pacheco" : personId;
}

function nextSundayIsoDate() {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = date.getDay();
  const diff = (7 - day) % 7 || 7;
  date.setDate(date.getDate() + diff);
  return localDateString(date);
}

function defaultState(seedPeople = []) {
  const timestamp = nowIso();
  return {
    version: SCHEMA_VERSION,
    people: normalizePeople(seedPeople),
    roles: ROLES,
    services: [],
    assignments: [],
    settings: {
      nextServiceDate: nextSundayIsoDate(),
    },
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  };
}

function normalizeState(candidate) {
  const timestamp = nowIso();
  return {
    version: SCHEMA_VERSION,
    people: normalizePeople(candidate.people),
    roles: ROLES,
    services: Array.isArray(candidate.services) ? [...candidate.services] : [],
    assignments: candidate.assignments.map((assignment) => ({
      ...assignment,
      personId: normalizePersonId(assignment.personId),
    })),
    settings: {
      nextServiceDate: candidate.settings.nextServiceDate,
    },
    meta: {
      createdAt: typeof candidate.meta?.createdAt === "string" ? candidate.meta.createdAt : timestamp,
      updatedAt: typeof candidate.meta?.updatedAt === "string" ? candidate.meta.updatedAt : timestamp,
    },
  };
}

function parseState(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidImportedState(parsed)) return null;
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

export function getState() {
  return parseState(localStorage.getItem(STORAGE_KEY));
}

export function saveState(state) {
  const normalized = normalizeState(state);
  const nextState = {
    ...normalized,
    meta: {
      ...normalized.meta,
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

export function getCachedPeople() {
  return getState()?.people || [];
}

export function getPeople() {
  return getCachedPeople();
}

export function saveCachedPeople(people) {
  const state = getState();
  if (!state) return null;
  return saveState({ ...state, people: normalizePeople(people) });
}

export function savePeople(people) {
  return saveCachedPeople(people);
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

export function addPerson(name, title = null) {
  const state = getState();
  if (!state) return null;
  const person = {
    id: `person-${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    title: normalizeTitle(title),
    active: true,
    paused: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
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
          title: updates.title === undefined ? person.title : normalizeTitle(updates.title),
          updatedAt: nowIso(),
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
  return saveState(normalizeState(candidateState));
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
  if (!isValidIsoDate(candidate.settings.nextServiceDate)) return false;

  const personIds = new Set();
  for (const rawPerson of normalizePeople(candidate.people)) {
    if (!rawPerson || typeof rawPerson !== "object") return false;
    if (typeof rawPerson.id !== "string" || !rawPerson.id.trim()) return false;
    if (personIds.has(rawPerson.id)) return false;
    if (typeof rawPerson.name !== "string" || !rawPerson.name.trim()) return false;
    if (typeof rawPerson.active !== "boolean" || typeof rawPerson.paused !== "boolean") return false;
    if (typeof rawPerson.createdAt !== "string" || !rawPerson.createdAt) return false;
    if (rawPerson.title != null && typeof rawPerson.title !== "string") return false;
    personIds.add(rawPerson.id);
  }

  for (const assignment of candidate.assignments) {
    if (!assignment || typeof assignment !== "object") return false;
    if (typeof assignment.id !== "string" || !assignment.id.trim()) return false;
    if (!personIds.has(normalizePersonId(assignment.personId))) return false;
    if (assignment.roleId !== "opening-reading") return false;
    if (!VALID_ASSIGNMENT_STATUSES.has(assignment.status)) return false;
    if (!isValidIsoDate(assignment.serviceDate)) return false;
    if (typeof assignment.createdAt !== "string" || typeof assignment.updatedAt !== "string") return false;

    if (assignment.reasonCode != null && !VALID_REASON_CODES.has(assignment.reasonCode)) return false;
    if (assignment.reasonText != null && typeof assignment.reasonText !== "string") return false;
  }

  return true;
}
