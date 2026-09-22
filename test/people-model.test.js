import test from "node:test";
import assert from "node:assert/strict";

import {
  MEMBERSHIP_STATE,
  displayPersonName,
  getMembershipState,
  membershipStateToFields,
  normalizePeople,
  normalizeTitle,
} from "../js/people-model.js";

test("normalizePeople removes duplicate pastor records and keeps canonical Carlos with title", () => {
  const people = normalizePeople([
    { id: "person-el-pastor", name: "El Pastor", active: true, paused: false, createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "person-carlos-pacheco", name: "Carlos Pacheco", active: true, paused: false, createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "person-maria", name: "Maria", active: true, paused: false, createdAt: "2026-01-03T00:00:00.000Z" },
  ]);

  const pastorEntries = people.filter((person) => person.id === "person-carlos-pacheco");
  assert.equal(pastorEntries.length, 1);
  assert.equal(pastorEntries[0].name, "Carlos Pacheco");
  assert.equal(pastorEntries[0].title, "Pastor");
  assert.equal(people.some((person) => person.id === "person-el-pastor"), false);
});

test("normalizeTitle trims valid titles and clears blank titles", () => {
  assert.equal(normalizeTitle(" Pastor "), "Pastor");
  assert.equal(normalizeTitle("   "), null);
  assert.equal(normalizeTitle(null), null);
});

test("displayPersonName includes title when present", () => {
  assert.equal(displayPersonName({ name: "Carlos Pacheco", title: "Pastor" }), "Carlos Pacheco · Pastor");
  assert.equal(displayPersonName({ name: "Maria", title: null }), "Maria");
});

test("maps active and paused fields to one membership state", () => {
  assert.equal(getMembershipState({ active: true, paused: false }), MEMBERSHIP_STATE.ROTATION);
  assert.equal(getMembershipState({ active: true, paused: true }), MEMBERSHIP_STATE.PAUSED);
  assert.equal(getMembershipState({ active: false, paused: false }), MEMBERSHIP_STATE.OUT);
});

test("maps membership states to the approved active and paused fields", () => {
  assert.deepEqual(membershipStateToFields(MEMBERSHIP_STATE.ROTATION), { active: true, paused: false });
  assert.deepEqual(membershipStateToFields(MEMBERSHIP_STATE.PAUSED), { active: true, paused: true });
  assert.deepEqual(membershipStateToFields(MEMBERSHIP_STATE.OUT), { active: false, paused: false });
});

test("treats legacy inactive and paused data as out of rotation and normalizes on edit", () => {
  assert.equal(getMembershipState({ active: false, paused: true }), MEMBERSHIP_STATE.OUT);
  assert.deepEqual(membershipStateToFields(getMembershipState({ active: false, paused: true })), {
    active: false,
    paused: false,
  });
});
