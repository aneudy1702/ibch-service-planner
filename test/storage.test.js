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

test("legacy person-el-pastor assignments are remapped to canonical Carlos record", async () => {
  globalThis.localStorage = createLocalStorageMock();

  const { replaceStateFromImport, getState } = await import(`../js/storage.js?cacheBust=${Date.now()}`);

  replaceStateFromImport({
    version: 1,
    people: [
      {
        id: "person-el-pastor",
        name: "El Pastor",
        active: true,
        paused: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    roles: [],
    services: [],
    assignments: [
      {
        id: "legacy-assignment",
        personId: "person-el-pastor",
        roleId: "opening-reading",
        status: "completed",
        serviceDate: "2026-09-20",
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-20T00:00:00.000Z",
      },
    ],
    settings: {
      nextServiceDate: "2026-09-27",
    },
    meta: {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  });

  const state = getState();
  assert.equal(state.people.length, 1);
  assert.equal(state.people[0].id, "person-carlos-pacheco");
  assert.equal(state.people[0].title, "Pastor");
  assert.equal(state.assignments[0].personId, "person-carlos-pacheco");
});

test("backup import cannot overwrite cached shared assignments or settings", async () => {
  globalThis.localStorage = createLocalStorageMock();
  const storage = await import(`../js/storage.js?cacheBust=backup-${Date.now()}`);
  storage.initializeState([{
    id: "person-carlos-pacheco",
    name: "Carlos Pacheco",
    title: "Pastor",
    active: true,
    paused: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }]);
  storage.saveSharedPlannerCache({
    assignments: [{
      id: "assignment-shared",
      personId: "person-carlos-pacheco",
      roleId: "opening-reading",
      status: "completed",
      serviceDate: "2026-09-20",
      createdAt: "2026-09-20T00:00:00.000Z",
      updatedAt: "2026-09-20T00:00:00.000Z",
      version: 2,
    }],
    settings: {
      nextServiceDate: "2026-10-04",
      version: 3,
      updatedAt: "2026-09-22T00:00:00.000Z",
    },
  });

  storage.replaceStateFromImport({
    version: 1,
    people: [{
      id: "person-imported",
      name: "Imported",
      active: true,
      paused: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
    assignments: [],
    settings: { nextServiceDate: "2027-01-03" },
  });

  assert.equal(storage.getAssignments()[0].id, "assignment-shared");
  assert.equal(storage.getSettings().nextServiceDate, "2026-10-04");
  assert.equal(storage.getSettings().sharedVersion, 3);
});
