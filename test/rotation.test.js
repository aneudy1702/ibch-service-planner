import test from "node:test";
import assert from "node:assert/strict";

import { selectNextPerson } from "../js/rotation.js";

function createPerson(id, overrides = {}) {
  return {
    id,
    name: id,
    active: true,
    paused: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function completed(personId, serviceDate) {
  return {
    id: `${personId}-${serviceDate}`,
    personId,
    roleId: "opening-reading",
    serviceDate,
    status: "completed",
    createdAt: `${serviceDate}T00:00:00.000Z`,
    updatedAt: `${serviceDate}T00:00:00.000Z`,
  };
}

function declined(personId, serviceDate, reasonCode = "other") {
  return {
    id: `${personId}-${serviceDate}-${reasonCode}`,
    personId,
    roleId: "opening-reading",
    serviceDate,
    status: "declined",
    reasonCode,
    createdAt: `${serviceDate}T00:00:00.000Z`,
    updatedAt: `${serviceDate}T00:00:00.000Z`,
  };
}

test("excludes inactive and paused people", () => {
  const picked = selectNextPerson({
    people: [
      createPerson("inactive", { active: false }),
      createPerson("paused", { paused: true }),
      createPerson("eligible"),
    ],
    assignments: [],
    roleId: "opening-reading",
    serviceDate: "2026-09-27",
  });

  assert.equal(picked?.id, "eligible");
});

test("excludes declined people for the same service regardless of decline reason", () => {
  const picked = selectNextPerson({
    people: [createPerson("first"), createPerson("replacement")],
    assignments: [declined("first", "2026-09-27", "shy")],
    roleId: "opening-reading",
    serviceDate: "2026-09-27",
  });

  assert.equal(picked?.id, "replacement");
});

test("same-service decline does not exclude a person from a different service", () => {
  const picked = selectNextPerson({
    people: [createPerson("first"), createPerson("served")],
    assignments: [
      declined("first", "2026-09-27", "other"),
      completed("served", "2026-09-20"),
    ],
    roleId: "opening-reading",
    serviceDate: "2026-10-04",
  });

  assert.equal(picked?.id, "first");
});

test("prefers people who have never completed the role", () => {
  const picked = selectNextPerson({
    people: [createPerson("never-served"), createPerson("served")],
    assignments: [completed("served", "2026-09-20")],
    roleId: "opening-reading",
    serviceDate: "2026-09-27",
  });

  assert.equal(picked?.id, "never-served");
});

test("prefers the person who served least recently", () => {
  const picked = selectNextPerson({
    people: [createPerson("older"), createPerson("recent")],
    assignments: [completed("older", "2026-08-31"), completed("recent", "2026-09-14")],
    roleId: "opening-reading",
    serviceDate: "2026-09-27",
  });

  assert.equal(picked?.id, "older");
});

test("randomizes only among equally ranked top candidates", () => {
  const people = [createPerson("a"), createPerson("b"), createPerson("c")];
  const assignments = [completed("a", "2026-08-31"), completed("b", "2026-08-31"), completed("c", "2026-09-14")];
  const originalRandom = Math.random;

  try {
    Math.random = () => 0;
    const firstPick = selectNextPerson({
      people,
      assignments,
      roleId: "opening-reading",
      serviceDate: "2026-09-27",
    });

    Math.random = () => 0.999999;
    const secondPick = selectNextPerson({
      people,
      assignments,
      roleId: "opening-reading",
      serviceDate: "2026-09-27",
    });

    assert.deepEqual(new Set([firstPick?.id, secondPick?.id]), new Set(["a", "b"]));
  } finally {
    Math.random = originalRandom;
  }
});
