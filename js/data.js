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

function parseErrorMessage(error) {
  if (error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return "No se pudo conectar con el servicio compartido.";
}

function hasSameOrNewerTimestamp(firstPerson, secondPerson) {
  const firstUpdatedAt = Date.parse(firstPerson.updatedAt || "");
  const secondUpdatedAt = Date.parse(secondPerson.updatedAt || "");
  if (Number.isNaN(firstUpdatedAt)) return false;
  if (Number.isNaN(secondUpdatedAt)) return true;
  return firstUpdatedAt >= secondUpdatedAt;
}

async function requestPeople(path = "", options) {
  let response;
  try {
    response = await fetch(`${PEOPLE_API_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
      ...options,
    });
  } catch (cause) {
    const error = new Error("No se pudo conectar con el servicio compartido.");
    error.cause = cause;
    error.kind = "network";
    throw error;
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    const error = new Error(body.error || "No se pudo completar la operación de personas.");
    error.kind = "http";
    error.status = response.status;
    error.apiError = typeof body.error === "string" ? body.error : null;
    throw error;
  }

  return body;
}

async function syncPendingPerson(pendingPerson, serverMap) {
  const personId = canonicalPersonId(pendingPerson.id);
  const existsInServer = serverMap.has(personId);

  if (existsInServer) {
    const payload = await requestPeople("", {
      method: "PATCH",
      body: JSON.stringify({
        id: personId,
        name: pendingPerson.name,
        title: pendingPerson.title,
        active: pendingPerson.active,
        paused: pendingPerson.paused,
      }),
    });

    return normalizePeople([{ ...payload.person, syncPending: false }])[0];
  }

  const createdPayload = await requestPeople("", {
    method: "POST",
    body: JSON.stringify({
      id: pendingPerson.id,
      name: pendingPerson.name,
      title: pendingPerson.title,
    }),
  });

  let synced = normalizePeople([{ ...createdPayload.person, syncPending: false }])[0];

  if (synced.active !== pendingPerson.active || synced.paused !== pendingPerson.paused) {
    const patchPayload = await requestPeople("", {
      method: "PATCH",
      body: JSON.stringify({
        id: synced.id,
        active: pendingPerson.active,
        paused: pendingPerson.paused,
      }),
    });

    synced = normalizePeople([{ ...patchPayload.person, syncPending: false }])[0];
  }

  return synced;
}

async function syncPendingPeople(serverPeople) {
  const pendingLocalPeople = getCachedPeople().filter((person) => person.syncPending);
  const serverMap = new Map(normalizePeople(serverPeople).map((person) => [person.id, person]));

  for (const pendingRaw of pendingLocalPeople) {
    const pendingPerson = normalizePeople([pendingRaw])[0];

    try {
      const synced = await syncPendingPerson(pendingPerson, serverMap);
      serverMap.delete(pendingPerson.id);
      serverMap.set(synced.id, synced);
    } catch {
      const personId = canonicalPersonId(pendingPerson.id);
      const currentServer = serverMap.get(personId);

      if (!currentServer || hasSameOrNewerTimestamp(pendingPerson, currentServer)) {
        serverMap.set(personId, pendingPerson);
      }
    }
  }

  const merged = normalizePeople(Array.from(serverMap.values()));
  saveCachedPeople(merged);
  return merged;
}

export async function loadPeople() {
  try {
    const payload = await requestPeople();
    const people = normalizePeople(Array.isArray(payload.people) ? payload.people : []);
    const merged = await syncPendingPeople(people);
    return { people: merged, fromCache: false };
  } catch (error) {
    console.error("People API unavailable; using cached roster.", {
      kind: error.kind || "unknown",
      status: error.status || null,
      apiError: error.apiError || error.message,
    });
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

    let savedLocally = false;
    if (current) {
      mergePeople({
        ...current,
        ...updates,
        title: updates.title === undefined ? current.title : normalizeTitle(updates.title),
        syncPending: true,
        updatedAt: new Date().toISOString(),
      });
      savedLocally = true;
    }

    const syncError = new Error(
      `${parseErrorMessage(error)} Se guardó localmente, pero no se sincronizó con D1. Intente nuevamente cuando vuelva la conexión.`,
    );
    syncError.localSaved = savedLocally;
    throw syncError;
  }
}
