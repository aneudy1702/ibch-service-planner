import test from "node:test";
import assert from "node:assert/strict";

import {
  STATUS,
  assertCanSelectPerson,
  completeAssignment,
  confirmAssignment,
  createSelectionAssignment,
  declineAssignment,
  getCurrentAssignmentForService,
  getHomeActionState,
} from "../js/assignment-workflow.js";
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

function createAssignment(status, personId, serviceDate = "2026-09-27", overrides = {}) {
  return {
    id: `${personId}-${status}-${serviceDate}`,
    personId,
    roleId: "opening-reading",
    serviceDate,
    status,
    createdAt: `${serviceDate}T00:00:00.000Z`,
    updatedAt: `${serviceDate}T00:00:00.000Z`,
    ...overrides,
  };
}

test("cannot select another person when an active selected assignment exists", () => {
  assert.throws(
    () => assertCanSelectPerson(createAssignment(STATUS.SELECTED, "first")),
    /Ya hay una asignación activa/,
  );
});

test("cannot select another person when an active confirmed assignment exists", () => {
  assert.throws(
    () => assertCanSelectPerson(createAssignment(STATUS.CONFIRMED, "first")),
    /Ya hay una asignación activa/,
  );
});

test("selected assignment can transition to confirmed", () => {
  const assignment = createAssignment(STATUS.SELECTED, "first");
  const confirmed = confirmAssignment(assignment, "2026-09-21T12:00:00.000Z");

  assert.equal(confirmed.status, STATUS.CONFIRMED);
  assert.equal(confirmed.personId, assignment.personId);
  assert.equal(confirmed.updatedAt, "2026-09-21T12:00:00.000Z");
});

test("confirmed assignment can transition to completed", () => {
  const assignment = createAssignment(STATUS.CONFIRMED, "first");
  const completed = completeAssignment(assignment, "2026-09-21T12:00:00.000Z");

  assert.equal(completed.status, STATUS.COMPLETED);
  assert.equal(completed.personId, assignment.personId);
  assert.equal(completed.updatedAt, "2026-09-21T12:00:00.000Z");
});

test("invalid transitions are rejected", () => {
  assert.throws(
    () => confirmAssignment(createAssignment(STATUS.CONFIRMED, "first")),
    /Solo se puede confirmar una asignación seleccionada/,
  );
  assert.throws(
    () => completeAssignment(createAssignment(STATUS.SELECTED, "first")),
    /Solo se puede completar una asignación confirmada/,
  );
});

test("replacement through decline preserves history and selects a different eligible person", () => {
  const current = createAssignment(STATUS.SELECTED, "first");
  const declined = declineAssignment(current, {
    reasonCode: "other",
    reasonText: "No puede esta vez",
    now: "2026-09-21T12:00:00.000Z",
  });
  const assignments = [declined];
  const people = [createPerson("first"), createPerson("replacement"), createPerson("served")];

  assignments.push(createAssignment(STATUS.COMPLETED, "served", "2026-09-20"));

  const picked = selectNextPerson({
    people,
    assignments,
    roleId: "opening-reading",
    serviceDate: "2026-09-27",
  });

  const replacement = createSelectionAssignment({
    id: "replacement-selected",
    personId: picked.id,
    roleId: "opening-reading",
    serviceDate: "2026-09-27",
    now: "2026-09-21T12:05:00.000Z",
  });

  assert.equal(declined.status, STATUS.DECLINED);
  assert.equal(declined.reasonCode, "other");
  assert.equal(declined.reasonText, "No puede esta vez");
  assert.equal(replacement.personId, "replacement");
  assert.notEqual(replacement.personId, current.personId);
});

test("home actions reflect whether there is an active assignment", () => {
  assert.deepEqual(getHomeActionState(null), {
    canSelect: true,
    canConfirm: false,
    canComplete: false,
    canDecline: false,
  });
  assert.deepEqual(getHomeActionState(createAssignment(STATUS.SELECTED, "first")), {
    canSelect: false,
    canConfirm: true,
    canComplete: false,
    canDecline: true,
  });
  assert.deepEqual(getHomeActionState(createAssignment(STATUS.CONFIRMED, "first")), {
    canSelect: false,
    canConfirm: false,
    canComplete: true,
    canDecline: true,
  });
});

test("current assignment lookup only returns active assignments for the current service", () => {
  const assignments = [
    createAssignment(STATUS.COMPLETED, "completed"),
    createAssignment(STATUS.SELECTED, "active", "2026-09-27", {
      createdAt: "2026-09-21T10:00:00.000Z",
    }),
    createAssignment(STATUS.CONFIRMED, "other-service", "2026-10-04"),
  ];

  const current = getCurrentAssignmentForService(assignments, "opening-reading", "2026-09-27");

  assert.equal(current?.personId, "active");
});
