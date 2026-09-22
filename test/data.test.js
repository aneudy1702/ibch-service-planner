import test from "node:test";
import assert from "node:assert/strict";

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

function createResponse(ok, body) {
  return {
    ok,
    async json() {
      return body;
    },
  };
}

async function loadModules() {
  const storage = await import(`../js/storage.js?cacheBust=${Date.now()}-${Math.random()}`);
  const data = await import(`../js/data.js?cacheBust=${Date.now()}-${Math.random()}`);
  return { storage, data };
}

test("loadPeople keeps cached people when the API is unavailable", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const diagnostics = [];

  globalThis.localStorage = createLocalStorageMock();
  const { storage, data } = await loadModules();
  storage.initializeState([]);
  storage.saveCachedPeople([
    {
      id: "person-cached",
      name: "Persona en caché",
      title: null,
      active: true,
      paused: false,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    },
  ]);
  globalThis.fetch = async () => {
    throw new TypeError("network unavailable");
  };
  console.error = (...args) => diagnostics.push(args);

  try {
    const loaded = await data.loadPeople();
    assert.equal(loaded.fromCache, true);
    assert.equal(loaded.people[0].name, "Persona en caché");
    assert.equal(loaded.error.kind, "network");
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0][1].kind, "network");
    assert.equal(diagnostics[0][1].status, null);
  } finally {
    console.error = originalConsoleError;
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});

test("failed add is stored locally with syncPending=true", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  globalThis.localStorage = createLocalStorageMock();
  const { storage, data } = await loadModules();
  storage.initializeState([]);

  globalThis.fetch = async () => createResponse(false, { error: "offline" });

  try {
    await assert.rejects(() => data.addSharedPerson({ name: "Ana", title: null }));

    const cached = storage.getCachedPeople();
    assert.equal(cached.length, 1);
    assert.equal(cached[0].name, "Ana");
    assert.equal(cached[0].syncPending, true);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});

test("next successful load retries pending add and clears syncPending", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  globalThis.localStorage = createLocalStorageMock();
  const { storage, data } = await loadModules();
  storage.initializeState([]);

  let step = 0;
  let pendingId = null;
  globalThis.fetch = async () => {
    step += 1;
    if (step === 1) {
      return createResponse(false, { error: "offline" });
    }
    if (step === 2) {
      return createResponse(true, { people: [] });
    }
    if (step === 3) {
      return createResponse(true, {
        person: {
          id: pendingId,
          name: "Ana",
          title: null,
          active: true,
          paused: false,
          createdAt: "2026-09-21T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      });
    }
    throw new Error("unexpected request");
  };

  try {
    await assert.rejects(() => data.addSharedPerson({ name: "Ana", title: null }));
    pendingId = storage.getCachedPeople()[0].id;

    const loaded = await data.loadPeople();
    const person = loaded.people.find((item) => item.id === pendingId);

    assert.equal(loaded.fromCache, false);
    assert.ok(person);
    assert.equal(person.syncPending, false);

    const cached = storage.getCachedPeople().find((item) => item.id === pendingId);
    assert.ok(cached);
    assert.equal(cached.syncPending, false);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});

test("offline add keeps ID stable through sync and preserves assignment references", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  globalThis.localStorage = createLocalStorageMock();
  const { storage, data } = await loadModules();
  storage.initializeState([]);

  let step = 0;
  let pendingId = null;
  globalThis.fetch = async (url, options) => {
    step += 1;
    if (step === 1) {
      return createResponse(false, { error: "offline" });
    }
    if (step === 2) {
      return createResponse(true, { people: [] });
    }
    if (step === 3) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.id, pendingId);
      return createResponse(true, {
        person: {
          id: pendingId,
          name: "Ana",
          title: null,
          active: true,
          paused: false,
          createdAt: "2026-09-21T00:00:00.000Z",
          updatedAt: "2026-09-21T00:00:00.000Z",
        },
      });
    }
    throw new Error("unexpected request");
  };

  try {
    await assert.rejects(() => data.addSharedPerson({ name: "Ana", title: null }));
    pendingId = storage.getCachedPeople()[0].id;
    assert.match(pendingId, /^person-ana-[a-z0-9]+$/);

    storage.addAssignment({
      id: "assignment-offline",
      personId: pendingId,
      roleId: "opening-reading",
      serviceDate: "2026-09-28",
      status: "selected",
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });

    const loaded = await data.loadPeople();
    const person = loaded.people.find((item) => item.id === pendingId);
    const assignment = storage.getAssignments().find((item) => item.id === "assignment-offline");
    const resolved = loaded.people.find((item) => item.id === assignment.personId);

    assert.equal(loaded.fromCache, false);
    assert.ok(person);
    assert.equal(person.syncPending, false);
    assert.equal(assignment.personId, pendingId);
    assert.ok(resolved);

    const cached = storage.getCachedPeople().find((item) => item.id === pendingId);
    assert.ok(cached);
    assert.equal(cached.syncPending, false);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});

test("failed update is retried on load and clears syncPending", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  globalThis.localStorage = createLocalStorageMock();
  const { storage, data } = await loadModules();
  storage.initializeState([]);
  storage.saveCachedPeople([
    {
      id: "person-maria",
      name: "Maria",
      title: null,
      active: true,
      paused: false,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
    },
  ]);

  let step = 0;
  globalThis.fetch = async () => {
    step += 1;
    if (step === 1) {
      return createResponse(false, { error: "offline" });
    }
    if (step === 2) {
      return createResponse(true, {
        people: [
          {
            id: "person-maria",
            name: "Maria",
            title: null,
            active: true,
            paused: false,
            createdAt: "2026-09-20T00:00:00.000Z",
            updatedAt: "2026-09-20T00:00:00.000Z",
          },
        ],
      });
    }
    if (step === 3) {
      return createResponse(true, {
        person: {
          id: "person-maria",
          name: "Maria Nuevo",
          title: null,
          active: true,
          paused: false,
          createdAt: "2026-09-20T00:00:00.000Z",
          updatedAt: "2026-09-22T00:00:00.000Z",
        },
      });
    }
    throw new Error("unexpected request");
  };

  try {
    await assert.rejects(() => data.updateSharedPerson("person-maria", { name: "Maria Nuevo" }));

    const pendingBefore = storage.getCachedPeople().find((item) => item.id === "person-maria");
    assert.equal(pendingBefore.syncPending, true);

    const loaded = await data.loadPeople();
    const person = loaded.people.find((item) => item.id === "person-maria");

    assert.ok(person);
    assert.equal(person.name, "Maria Nuevo");
    assert.equal(person.syncPending, false);

    const cached = storage.getCachedPeople().find((item) => item.id === "person-maria");
    assert.equal(cached.syncPending, false);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});

test("pending local changes are not overwritten by older server data", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  globalThis.localStorage = createLocalStorageMock();
  const { storage, data } = await loadModules();
  storage.initializeState([]);
  storage.saveCachedPeople([
    {
      id: "person-maria",
      name: "Maria Local",
      title: null,
      active: true,
      paused: false,
      syncPending: true,
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-22T00:00:00.000Z",
    },
  ]);

  let step = 0;
  globalThis.fetch = async () => {
    step += 1;
    if (step === 1) {
      return createResponse(true, {
        people: [
          {
            id: "person-maria",
            name: "Maria Servidor",
            title: null,
            active: true,
            paused: false,
            createdAt: "2026-09-20T00:00:00.000Z",
            updatedAt: "2026-09-21T00:00:00.000Z",
          },
        ],
      });
    }
    if (step === 2) {
      return createResponse(false, { error: "still offline" });
    }
    throw new Error("unexpected request");
  };

  try {
    const loaded = await data.loadPeople();
    const person = loaded.people.find((item) => item.id === "person-maria");

    assert.ok(person);
    assert.equal(person.name, "Maria Local");
    assert.equal(person.syncPending, true);

    const cached = storage.getCachedPeople().find((item) => item.id === "person-maria");
    assert.equal(cached.name, "Maria Local");
    assert.equal(cached.syncPending, true);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});
