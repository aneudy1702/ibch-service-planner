import { getCachedPeople, saveCachedPeople } from "./storage.js";
import { normalizePeople, normalizeTitle, slugify } from "./people-model.js";

const PEOPLE_API_URL = "./api/people";
const LEGACY_PASTOR_ID = "person-el-pastor";
const CANONICAL_PASTOR_ID = "person-carlos-pacheco";

function canonicalPersonId(personId) {
  return personId === LEGACY_PASTOR_ID ? CANONICAL_PASTOR_ID : personId;
}

function mergePeople(updatedPerson) {
  const canonicalUpdated = normalizePeople([updatedPerson])[0];
  const existing = getCachedPeople().filter(
    (person) => person.id !== updatedPerson.id && person.id !== canonicalUpdated.id,
  );
  const merged = normalizePeople([...existing, canonicalUpdated]);
  saveCachedPeople(merged);
  return merged.find((person) => person.id === canonicalUpdated.id) || canonicalUpdated;
}

function mergeServerWithPending(serverPeople) {
  const pendingLocal = getCachedPeople().filter((person) => person.syncPending);
  const byId = new Map(serverPeople.map((person) => [person.id, person]));

  for (const pendingPerson of pendingLocal) {
    const serverPerson = byId.get(pendingPerson.id);
    if (!serverPerson) {
      byId.set(pendingPerson.id, pendingPerson);
      continue;
    }

    const pendingUpdatedAt = Date.parse(pendingPerson.updatedAt || "");
    const serverUpdatedAt = Date.parse(serverPerson.updatedAt || "");
    if (!Number.isNaN(pendingUpdatedAt) && (Number.isNaN(serverUpdatedAt) || pendingUpdatedAt > serverUpdatedAt)) {
      byId.set(pendingPerson.id, pendingPerson);
    }
  }

  const merged = normalizePeople(Array.from(byId.values()));
  saveCachedPeople(merged);
  return merged;
}

function parseErrorMessage(error) {
  if (error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "No se pudo conectar con el servicio compartido.";
}

async function requestPeople(path = "", options) {
  const response = await fetch(`${PEOPLE_API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(body.error || "No se pudo completar la operación de personas.");
  }

  return body;
}

export async function loadPeople() {
  try {
    const payload = await requestPeople();
    const people = normalizePeople(Array.isArray(payload.people) ? payload.people : []);
    const merged = mergeServerWithPending(people);
    return { people: merged, fromCache: false };
  } catch (error) {
    return {
      people: getCachedPeople(),
      fromCache: true,
      error,
    };
  }
}

export async function addSharedPerson({ name, title }) {
  try {
    const payload = await requestPeople("", {
      method: "POST",
      body: JSON.stringify({ name, title }),
    });

    const person = normalizePeople([payload.person])[0];
    const mergedPerson = mergePeople(person);
    return { person: mergedPerson, synced: true };
  } catch (error) {
    const timestamp = new Date().toISOString();
    const fallbackPerson = normalizePeople([
      {
        id: `person-${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        title: normalizeTitle(title),
        active: true,
        paused: false,
        syncPending: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ])[0];

    mergePeople(fallbackPerson);
    const syncError = new Error(
      `${parseErrorMessage(error)} Se guardó localmente, pero no se sincronizó con D1. Intente nuevamente cuando vuelva la conexión.`,
    );
    syncError.localSaved = true;
    throw syncError;
  }
}

export async function updateSharedPerson(personId, updates) {
  try {
    const payload = await requestPeople("", {
      method: "PATCH",
      body: JSON.stringify({ id: personId, ...updates }),
    });

    const person = normalizePeople([payload.person])[0];
    const mergedPerson = mergePeople(person);
    return { person: mergedPerson, synced: true };
  } catch (error) {
    const requestedId = canonicalPersonId(personId);
    const current = getCachedPeople().find(
      (person) => person.id === personId || person.id === requestedId,
    );
    if (current) {
      mergePeople({
        ...current,
        ...updates,
        title: updates.title === undefined ? current.title : normalizeTitle(updates.title),
        syncPending: true,
        updatedAt: new Date().toISOString(),
      });
    }

    const syncError = new Error(
      `${parseErrorMessage(error)} Se guardó localmente, pero no se sincronizó con D1. Intente nuevamente cuando vuelva la conexión.`,
    );
    syncError.localSaved = true;
    throw syncError;
  }
}
