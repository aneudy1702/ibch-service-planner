const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const CANONICAL_PASTOR_ID = "person-carlos-pacheco";
const CANONICAL_PASTOR_NAME = "Carlos Pacheco";
const CANONICAL_PASTOR_TITLE = "Pastor";
const PERSON_ID_RE = /^person-[a-z0-9-]+$/;

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function assertDb(env) {
  if (!env?.DB) {
    throw new ApiError("La base de datos D1 no está configurada.", 500);
  }
  return env.DB;
}

function toPerson(record) {
  if (!record) {
    throw new ApiError("No se encontró la persona solicitada.", 404);
  }
  return {
    id: record.id,
    name: record.name,
    title: record.title,
    active: Boolean(record.active),
    paused: Boolean(record.paused),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function cleanTitle(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizedName(value = "") {
  return value
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isCanonicalPastorName(name) {
  const normalized = normalizedName(name);
  return normalized === "el pastor" || normalized === "carlos pacheco";
}

function validateName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("El nombre es obligatorio.", 400);
  }
  return value.trim();
}

function validatePersonId(value) {
  if (typeof value !== "string" || !PERSON_ID_RE.test(value.trim())) {
    throw new ApiError("El id de la persona no es válido.", 400);
  }
  return value.trim();
}

async function listPeople(db) {
  const result = await db
    .prepare(
      `SELECT id, name, title, active, paused, created_at AS createdAt, updated_at AS updatedAt
       FROM people
       ORDER BY name COLLATE NOCASE ASC`,
    )
    .all();
  return (result.results || []).map(toPerson);
}

async function getPersonById(db, personId) {
  return db
    .prepare(
      `SELECT id, name, title, active, paused, created_at AS createdAt, updated_at AS updatedAt
       FROM people WHERE id = ?`,
    )
    .bind(personId)
    .first();
}

async function buildUniquePersonId(db, baseId) {
  let suffix = 0;

  while (suffix < 10000) {
    const candidateId = suffix === 0 ? `person-${baseId}` : `person-${baseId}-${suffix}`;
    const existing = await db.prepare("SELECT id FROM people WHERE id = ?").bind(candidateId).first();
    if (!existing) return candidateId;
    suffix += 1;
  }

  throw new ApiError("No se pudo generar un identificador único para la persona.", 500);
}

export async function onRequestGet(context) {
  try {
    const db = assertDb(context.env);
    const people = await listPeople(db);
    return json({ people });
  } catch (error) {
    return json({ error: error.message || "No se pudo cargar la lista de personas." }, { status: error.status || 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const db = assertDb(context.env);
    const body = await context.request.json();
    const name = validateName(body.name);
    const title = cleanTitle(body.title);
    const timestamp = nowIso();
    const requestedId = body.id == null ? null : validatePersonId(body.id);

    if (isCanonicalPastorName(name)) {
      await db
        .prepare(
          `INSERT INTO people (id, name, title, active, paused, created_at, updated_at)
           VALUES (?, ?, ?, 1, 0, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             title = excluded.title,
             active = people.active,
             paused = people.paused,
             updated_at = excluded.updated_at`,
        )
        .bind(
          CANONICAL_PASTOR_ID,
          CANONICAL_PASTOR_NAME,
          CANONICAL_PASTOR_TITLE,
          timestamp,
          timestamp,
        )
        .run();

      const canonicalRow = await getPersonById(db, CANONICAL_PASTOR_ID);

      return json({ person: toPerson(canonicalRow) }, { status: 201 });
    }

    let personId = requestedId;
    if (personId) {
      const existing = await getPersonById(db, personId);
      if (existing) {
        return json({ person: toPerson(existing) }, { status: 200 });
      }
    } else {
      const baseId = slugify(name) || "persona";
      personId = await buildUniquePersonId(db, baseId);
    }

    await db
      .prepare(
        `INSERT INTO people (id, name, title, active, paused, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`,
      )
      .bind(personId, name, title, timestamp, timestamp)
      .run();

    const row = await getPersonById(db, personId);

    return json({ person: toPerson(row) }, { status: 201 });
  } catch (error) {
    return json({ error: error.message || "No se pudo agregar la persona." }, { status: error.status || 500 });
  }
}

export async function onRequestPatch(context) {
  try {
    const db = assertDb(context.env);
    const body = await context.request.json();

    if (typeof body.id !== "string" || !body.id.trim()) {
      throw new ApiError("Se requiere el id de la persona.", 400);
    }
    const personId = body.id.trim();

    if (personId !== CANONICAL_PASTOR_ID && Object.hasOwn(body, "name") && isCanonicalPastorName(body.name)) {
      throw new ApiError("El registro de Pastor ya existe y debe mantenerse como Carlos Pacheco.", 400);
    }

    if (personId === CANONICAL_PASTOR_ID) {
      body.name = CANONICAL_PASTOR_NAME;
      body.title = CANONICAL_PASTOR_TITLE;
    }

    const updates = [];
    const values = [];

    if (Object.hasOwn(body, "name")) {
      updates.push("name = ?");
      values.push(validateName(body.name));
    }

    if (Object.hasOwn(body, "title")) {
      updates.push("title = ?");
      values.push(cleanTitle(body.title));
    }

    if (Object.hasOwn(body, "active")) {
      if (typeof body.active !== "boolean") throw new ApiError("El estado activo debe ser booleano.", 400);
      updates.push("active = ?");
      values.push(body.active ? 1 : 0);
    }

    if (Object.hasOwn(body, "paused")) {
      if (typeof body.paused !== "boolean") throw new ApiError("El estado de pausa debe ser booleano.", 400);
      updates.push("paused = ?");
      values.push(body.paused ? 1 : 0);
    }

    if (updates.length === 0) {
      throw new ApiError("No se recibieron cambios para actualizar.", 400);
    }

    updates.push("updated_at = ?");
    values.push(nowIso());
    values.push(personId);

    const updateResult = await db
      .prepare(`UPDATE people SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    if ((updateResult.meta?.changes || 0) === 0) {
      throw new ApiError("No se encontró la persona a actualizar.", 404);
    }

    const row = await db
      .prepare(
        `SELECT id, name, title, active, paused, created_at AS createdAt, updated_at AS updatedAt
         FROM people WHERE id = ?`,
      )
      .bind(personId)
      .first();

    return json({ person: toPerson(row) });
  } catch (error) {
    return json({ error: error.message || "No se pudo actualizar la persona." }, { status: error.status || 500 });
  }
}
