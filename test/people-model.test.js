import test from "node:test";
import assert from "node:assert/strict";

import { displayPersonName, normalizePeople, normalizeTitle } from "../js/people-model.js";

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
