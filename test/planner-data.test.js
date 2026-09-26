import test from "node:test";
import assert from "node:assert/strict";

import {
  getAssignments,
  getPlannerSyncState,
  initializeState,
  markLegacyBootstrapCompleted,
} from "../js/storage.js";
import {
  createSharedAssignment,
  refreshSharedPlannerState,
} from "../js/planner-data.js";

function localStorageMock() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    clear: () => values.clear(),
  };
}

function person() {
  return {
    id: "person-test",
    name: "Prueba",
    title: null,
    active: true,
    paused: false,
    createdAt: "2026-09-22T12:00:00.000Z",
    updatedAt: "2026-09-22T12:00:00.000Z",
  };
}

function assignment() {
  return {
    id: "assignment-test",
    personId: "person-test",
    roleId: "opening-reading",
    serviceDate: "2026-10-04",
    status: "selected",
    reasonCode: null,
    reasonText: null,
    createdAt: "2026-09-22T12:00:00.000Z",
    updatedAt: "2026-09-22T12:00:00.000Z",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup() {
  globalThis.localStorage = localStorageMock();
  initializeState([person()]);
  markLegacyBootstrapCompleted();
}

test("offline planner writes stay visible and replay on refresh", async () => {
  setup();
  globalThis.fetch = async () => { throw new TypeError("offline"); };

  await assert.rejects(createSharedAssignment(assignment()), (error) => error.localSaved === true);
  assert.equal(getAssignments()[0].version, 1);
  assert.equal(getPlannerSyncState().pendingOperations.length, 1);

  let call = 0;
  globalThis.fetch = async (_url, options = {}) => {
    call += 1;
    if (call === 1) return json({ assignments: [], settings: { nextServiceDate: "2026-10-04", version: 1, updatedAt: "2026-09-22T12:00:00.000Z" } });
    if (options.method === "POST") return json({ assignment: { ...assignment(), version: 1 } });
    return json({ assignments: [{ ...assignment(), version: 1 }], settings: { nextServiceDate: "2026-10-04", version: 1, updatedAt: "2026-09-22T12:00:00.000Z" } });
  };

  const refreshed = await refreshSharedPlannerState();
  assert.equal(refreshed.fromCache, false);
  assert.equal(getPlannerSyncState().pendingOperations.length, 0);
  assert.equal(getAssignments()[0].id, "assignment-test");
});

test("a 409 preserves the rejected operation and refreshes authoritative state", async () => {
  setup();
  const serverAssignment = { ...assignment(), id: "assignment-other", version: 1 };
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) return json({ error: "El plan cambió en otro dispositivo." }, 409);
    return json({
      assignments: [serverAssignment],
      settings: { nextServiceDate: "2026-10-04", version: 1, updatedAt: "2026-09-22T12:00:00.000Z" },
    });
  };

  await assert.rejects(createSharedAssignment(assignment()), (error) => error.conflict === true);
  assert.equal(getPlannerSyncState().conflictOperations.length, 1);
  assert.equal(getAssignments()[0].id, "assignment-other");
});

test("refresh falls back to cached shared planner data on network failure", async () => {
  setup();
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  const result = await refreshSharedPlannerState();
  assert.equal(result.fromCache, true);
  assert.equal(result.assignments.length, 0);
  assert.match(result.error.message, /plan compartido/i);
});
