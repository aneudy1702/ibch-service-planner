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

test("loadPeople merge keeps one canonical pastor record", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;

  globalThis.localStorage = createLocalStorageMock();

  const storage = await import("../js/storage.js");
  const data = await import("../js/data.js");

  storage.initializeState([]);
  storage.saveCachedPeople([
    {
      id: "person-el-pastor",
      name: "El Pastor",
      title: null,
      active: true,
      paused: false,
      syncPending: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        people: [
          {
            id: "person-carlos-pacheco",
            name: "Carlos Pacheco",
            title: "Pastor",
            active: true,
            paused: false,
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
      };
    },
  });

  try {
    const result = await data.loadPeople();
    const pastorEntries = result.people.filter((person) => person.id === "person-carlos-pacheco");

    assert.equal(result.fromCache, false);
    assert.equal(pastorEntries.length, 1);
    assert.equal(result.people.some((person) => person.id === "person-el-pastor"), false);
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
  }
});
