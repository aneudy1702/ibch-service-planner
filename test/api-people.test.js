import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost } from "../functions/api/people.js";

function rowWithAliases(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    active: row.active,
    paused: row.paused,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM people WHERE id = ?")) {
      const row = this.db.people.get(this.params[0]);
      if (!row) return null;
      return this.sql.includes("created_at AS createdAt") ? rowWithAliases(row) : { id: row.id };
    }
    return null;
  }

  async all() {
    if (this.sql.includes("FROM people")) {
      return {
        results: Array.from(this.db.people.values()).map(rowWithAliases),
      };
    }
    return { results: [] };
  }

  async run() {
    if (this.sql.includes("ON CONFLICT(id) DO UPDATE")) {
      const [id, name, title, createdAt, updatedAt] = this.params;
      const existing = this.db.people.get(id);
      this.db.people.set(id, {
        id,
        name,
        title,
        active: existing?.active ?? 1,
        paused: existing?.paused ?? 0,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes("INSERT INTO people")) {
      const [id, name, title, createdAt, updatedAt] = this.params;
      this.db.people.set(id, {
        id,
        name,
        title,
        active: 1,
        paused: 0,
        created_at: createdAt,
        updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unsupported SQL in test DB: ${this.sql}`);
  }
}

class FakeDb {
  constructor() {
    this.people = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function createContext(body, db) {
  return {
    env: { DB: db },
    request: {
      async json() {
        return body;
      },
    },
  };
}

test("POST /api/people accepts a valid client-provided ID", async () => {
  const db = new FakeDb();

  const response = await onRequestPost(
    createContext({ id: "person-ana-x7k2p", name: "Ana", title: null }, db),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.person.id, "person-ana-x7k2p");
  assert.ok(db.people.has("person-ana-x7k2p"));
});

test("POST /api/people rejects an invalid client-provided ID", async () => {
  const db = new FakeDb();

  const response = await onRequestPost(
    createContext({ id: "../person-ana", name: "Ana", title: null }, db),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /id de la persona/i);
});

test("POST /api/people with existing provided ID returns existing person safely", async () => {
  const db = new FakeDb();
  db.people.set("person-ana-x7k2p", {
    id: "person-ana-x7k2p",
    name: "Ana",
    title: null,
    active: 1,
    paused: 0,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
  });

  const response = await onRequestPost(
    createContext({ id: "person-ana-x7k2p", name: "Ana", title: null }, db),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.person.id, "person-ana-x7k2p");
  assert.equal(db.people.size, 1);
});
