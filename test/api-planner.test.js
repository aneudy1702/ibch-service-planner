import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { onRequestGet, onRequestPost } from "../functions/api/planner.js";

class D1StatementAdapter {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.params) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes) } };
  }
}

class D1Adapter {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(readFileSync(new URL("../migrations/0001_people.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0002_shared_planner.sql", import.meta.url), "utf8"));
  }

  prepare(sql) {
    return new D1StatementAdapter(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function assignment(id, personId = "person-carlos-pacheco", overrides = {}) {
  return {
    id,
    personId,
    roleId: "opening-reading",
    serviceDate: "2026-10-04",
    status: "selected",
    reasonCode: null,
    reasonText: null,
    createdAt: "2026-09-22T12:00:00.000Z",
    updatedAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

async function post(db, body) {
  const response = await onRequestPost({
    env: { DB: db },
    request: new Request("http://local/api/planner", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  return { response, body: await response.json() };
}

test("planner enforces one active assignment and optimistic versions", async () => {
  const db = new D1Adapter();
  const created = await post(db, { operation: "create", assignment: assignment("assignment-first") });
  assert.equal(created.response.status, 200);
  assert.equal(created.body.assignment.version, 1);

  const duplicate = await post(db, {
    operation: "create",
    assignment: assignment("assignment-second", "person-michel-pacheco"),
  });
  assert.equal(duplicate.response.status, 409);

  const confirmed = await post(db, {
    operation: "transition",
    id: "assignment-first",
    expectedVersion: 1,
    status: "confirmed",
  });
  assert.equal(confirmed.body.assignment.version, 2);
  assert.equal(confirmed.body.assignment.status, "confirmed");

  const stale = await post(db, {
    operation: "transition",
    id: "assignment-first",
    expectedVersion: 1,
    status: "declined",
    reasonCode: "other",
  });
  assert.equal(stale.response.status, 409);

  const completed = await post(db, {
    operation: "transition",
    id: "assignment-first",
    expectedVersion: 2,
    status: "completed",
  });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.body.assignment.status, "completed");
  assert.equal(completed.body.assignment.version, 3);
});

test("replacement is atomic, linked, and safely idempotent", async () => {
  const db = new D1Adapter();
  await post(db, { operation: "create", assignment: assignment("assignment-current") });
  const request = {
    operation: "replace",
    currentId: "assignment-current",
    expectedVersion: 1,
    reasonCode: "unavailable_service",
    replacement: assignment("assignment-replacement", "person-michel-pacheco"),
  };

  const replaced = await post(db, request);
  assert.equal(replaced.response.status, 200);
  assert.equal(replaced.body.declined.status, "declined");
  assert.equal(replaced.body.declined.version, 2);
  assert.equal(replaced.body.replacement.status, "selected");
  assert.equal(replaced.body.replacement.replacementForId, "assignment-current");

  const retried = await post(db, request);
  assert.equal(retried.response.status, 200);
  assert.equal(retried.body.updated, false);

  const stateResponse = await onRequestGet({ env: { DB: db } });
  const state = await stateResponse.json();
  assert.equal(state.assignments.length, 2);
  assert.equal(state.assignments.filter((item) => ["selected", "confirmed"].includes(item.status)).length, 1);
});

test("legacy bootstrap initializes an empty planner only once", async () => {
  const db = new D1Adapter();
  const legacy = assignment("assignment-legacy", "person-eduard-lopez", {
    status: "completed",
    serviceDate: "2026-09-20",
  });

  const first = await post(db, {
    operation: "bootstrap",
    assignments: [legacy],
    nextServiceDate: "2026-09-27",
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.initialized, true);
  assert.equal(first.body.assignments.length, 1);
  assert.equal(first.body.settings.nextServiceDate, "2026-09-27");

  const second = await post(db, {
    operation: "bootstrap",
    assignments: [assignment("assignment-ignored")],
    nextServiceDate: "2026-10-11",
  });
  assert.equal(second.body.initialized, false);
  assert.equal(second.body.assignments.length, 1);
  assert.equal(second.body.assignments[0].id, "assignment-legacy");
  assert.equal(second.body.settings.nextServiceDate, "2026-09-27");
});

test("an empty client cannot claim the legacy bootstrap before a populated client", async () => {
  const db = new D1Adapter();
  const empty = await post(db, {
    operation: "bootstrap",
    assignments: [],
    nextServiceDate: "2026-09-27",
  });
  assert.equal(empty.body.initialized, false);

  await post(db, {
    operation: "setting",
    nextServiceDate: "2026-09-27",
    expectedVersion: null,
  });
  const populated = await post(db, {
    operation: "bootstrap",
    assignments: [assignment("assignment-late-legacy")],
    nextServiceDate: "2026-10-04",
  });
  assert.equal(populated.body.initialized, true);
  assert.equal(populated.body.assignments[0].id, "assignment-late-legacy");
  assert.equal(populated.body.settings.nextServiceDate, "2026-09-27");
});

test("illegal lifecycle transitions fail without changing stored state", async () => {
  const db = new D1Adapter();
  await post(db, { operation: "create", assignment: assignment("assignment-invalid-transition") });
  const result = await post(db, {
    operation: "transition",
    id: "assignment-invalid-transition",
    expectedVersion: 1,
    status: "completed",
  });
  assert.equal(result.response.status, 400);

  const stateResponse = await onRequestGet({ env: { DB: db } });
  const state = await stateResponse.json();
  assert.equal(state.assignments[0].status, "selected");
  assert.equal(state.assignments[0].version, 1);
});

test("shared service date uses optimistic versions", async () => {
  const db = new D1Adapter();
  const first = await post(db, {
    operation: "setting",
    nextServiceDate: "2026-10-04",
    expectedVersion: null,
  });
  assert.equal(first.body.settings.version, 1);

  const updated = await post(db, {
    operation: "setting",
    nextServiceDate: "2026-10-11",
    expectedVersion: 1,
  });
  assert.equal(updated.body.settings.nextServiceDate, "2026-10-11");
  assert.equal(updated.body.settings.version, 2);

  const stale = await post(db, {
    operation: "setting",
    nextServiceDate: "2026-10-18",
    expectedVersion: 1,
  });
  assert.equal(stale.response.status, 409);
});
