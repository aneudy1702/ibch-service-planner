const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const ROLE_ID = "opening-reading";
const ACTIVE_STATUSES = new Set(["selected", "confirmed"]);
const VALID_STATUSES = new Set(["selected", "confirmed", "declined", "completed", "cancelled"]);
const VALID_REASONS = new Set(["unavailable_service", "shy", "pause", "remove_rotation", "other"]);
const ID_RE = /^assignment-[a-zA-Z0-9-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers || {}) },
  });
}

function assertDb(env) {
  if (!env?.DB) throw new ApiError("La base de datos D1 no está configurada.", 500);
  return env.DB;
}

function nowIso() {
  return new Date().toISOString();
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value && !Number.isNaN(Date.parse(value));
}

function validateDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) {
    throw new ApiError("La fecha del servicio no es válida.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ApiError("La fecha del servicio no es válida.");
  }
  return value;
}

function validateAssignment(raw, { bootstrap = false } = {}) {
  if (!raw || typeof raw !== "object") throw new ApiError("La asignación no es válida.");
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) throw new ApiError("El id de asignación no es válido.");
  if (typeof raw.personId !== "string" || !raw.personId.trim()) throw new ApiError("La persona es obligatoria.");
  if (raw.roleId !== ROLE_ID) throw new ApiError("El rol de asignación no es válido.");
  validateDate(raw.serviceDate);
  if (!VALID_STATUSES.has(raw.status)) throw new ApiError("El estado de asignación no es válido.");
  if (!bootstrap && raw.status !== "selected") throw new ApiError("Una asignación nueva debe comenzar como propuesta.");
  if (raw.reasonCode != null && !VALID_REASONS.has(raw.reasonCode)) throw new ApiError("El motivo no es válido.");
  if (raw.reasonText != null && typeof raw.reasonText !== "string") throw new ApiError("Las notas no son válidas.");
  if (!isIsoTimestamp(raw.createdAt) || !isIsoTimestamp(raw.updatedAt)) {
    throw new ApiError("Las marcas de tiempo de la asignación no son válidas.");
  }
  return {
    id: raw.id,
    personId: raw.personId.trim(),
    roleId: raw.roleId,
    serviceDate: raw.serviceDate,
    status: raw.status,
    reasonCode: raw.reasonCode || null,
    reasonText: raw.reasonText || null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function isLegalTransition(from, to) {
  return (
    (from === "selected" && (to === "confirmed" || to === "declined" || to === "cancelled")) ||
    (from === "confirmed" && (to === "completed" || to === "declined" || to === "cancelled"))
  );
}

function toAssignment(row) {
  return {
    id: row.id,
    personId: row.personId,
    roleId: row.roleId,
    serviceDate: row.serviceDate,
    status: row.status,
    reasonCode: row.reasonCode || null,
    reasonText: row.reasonText || null,
    replacementForId: row.replacementForId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: Number(row.version),
  };
}

function toSetting(row) {
  if (!row) return null;
  return { nextServiceDate: row.value, updatedAt: row.updatedAt, version: Number(row.version) };
}

const ASSIGNMENT_SELECT = `SELECT id, person_id AS personId, role_id AS roleId,
  service_date AS serviceDate, status, reason_code AS reasonCode, reason_text AS reasonText,
  replaces_assignment_id AS replacementForId, created_at AS createdAt,
  updated_at AS updatedAt, version FROM assignments`;

async function getAssignment(db, id) {
  const row = await db.prepare(`${ASSIGNMENT_SELECT} WHERE id = ?`).bind(id).first();
  return row ? toAssignment(row) : null;
}

async function listAssignments(db) {
  const result = await db.prepare(`${ASSIGNMENT_SELECT} ORDER BY created_at ASC, id ASC`).all();
  return (result.results || []).map(toAssignment);
}

async function getSetting(db) {
  const row = await db
    .prepare("SELECT value, updated_at AS updatedAt, version FROM planner_settings WHERE key = 'next_service_date'")
    .first();
  return toSetting(row);
}

async function getPlannerState(db) {
  const [assignments, setting] = await Promise.all([listAssignments(db), getSetting(db)]);
  return { assignments, settings: setting };
}

async function assertPersonExists(db, personId) {
  const person = await db.prepare("SELECT id FROM people WHERE id = ?").bind(personId).first();
  if (!person) throw new ApiError("La persona seleccionada no existe.", 400);
}

function assignmentInsert(db, item, { replacementForId = null, status = item.status } = {}) {
  return db.prepare(
    `INSERT INTO assignments
      (id, person_id, role_id, service_date, status, reason_code, reason_text,
       replaces_assignment_id, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).bind(
    item.id, item.personId, item.roleId, item.serviceDate, status,
    item.reasonCode, item.reasonText, replacementForId, item.createdAt, item.updatedAt,
  );
}

function conflict(message = "El plan cambió en otro dispositivo.") {
  return new ApiError(message, 409);
}

async function createAssignment(db, body) {
  const item = validateAssignment(body.assignment);
  await assertPersonExists(db, item.personId);
  const existing = await getAssignment(db, item.id);
  if (existing) {
    if (
      existing.personId === item.personId && existing.roleId === item.roleId &&
      existing.serviceDate === item.serviceDate && existing.status === item.status
    ) return { assignment: existing, created: false };
    throw conflict("Ya existe otra asignación con ese identificador.");
  }
  try {
    await assignmentInsert(db, item).run();
  } catch (error) {
    if (/UNIQUE|constraint/i.test(error.message || "")) throw conflict("Ya existe una asignación activa para ese servicio.");
    throw error;
  }
  return { assignment: await getAssignment(db, item.id), created: true };
}

async function transitionAssignment(db, body) {
  const id = body.id;
  const expectedVersion = Number(body.expectedVersion);
  const targetStatus = body.status;
  if (typeof id !== "string" || !ID_RE.test(id)) throw new ApiError("El id de asignación no es válido.");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new ApiError("La versión esperada no es válida.");
  if (!VALID_STATUSES.has(targetStatus)) throw new ApiError("El estado de asignación no es válido.");
  const current = await getAssignment(db, id);
  if (!current) throw new ApiError("No se encontró la asignación.", 404);
  if (current.version === expectedVersion + 1 && current.status === targetStatus) {
    return { assignment: current, updated: false };
  }
  if (current.version !== expectedVersion) throw conflict();
  if (!isLegalTransition(current.status, targetStatus)) throw new ApiError("La transición de estado no es válida.");
  const reasonCode = body.reasonCode || null;
  const reasonText = body.reasonText || null;
  if (reasonCode != null && !VALID_REASONS.has(reasonCode)) throw new ApiError("El motivo no es válido.");
  if (reasonText != null && typeof reasonText !== "string") throw new ApiError("Las notas no son válidas.");
  const timestamp = nowIso();
  const result = await db.prepare(
    `UPDATE assignments SET status = ?, reason_code = ?, reason_text = ?,
      updated_at = ?, version = version + 1
     WHERE id = ? AND version = ? AND status = ?`,
  ).bind(targetStatus, reasonCode, reasonText, timestamp, id, expectedVersion, current.status).run();
  if ((result.meta?.changes || 0) !== 1) throw conflict();
  return { assignment: await getAssignment(db, id), updated: true };
}

async function replaceAssignment(db, body) {
  const currentId = body.currentId;
  const expectedVersion = Number(body.expectedVersion);
  const replacement = validateAssignment(body.replacement);
  if (typeof currentId !== "string" || !ID_RE.test(currentId)) throw new ApiError("La asignación actual no es válida.");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new ApiError("La versión esperada no es válida.");
  if (replacement.id === currentId) throw new ApiError("La asignación de reemplazo debe tener otro id.");
  const reasonCode = body.reasonCode;
  const reasonText = body.reasonText || null;
  if (!VALID_REASONS.has(reasonCode)) throw new ApiError("El motivo no es válido.");
  if (reasonText != null && typeof reasonText !== "string") throw new ApiError("Las notas no son válidas.");

  const current = await getAssignment(db, currentId);
  const existingReplacement = await getAssignment(db, replacement.id);
  if (
    current?.status === "declined" && current.version === expectedVersion + 1 &&
    existingReplacement?.replacementForId === currentId
  ) return { declined: current, replacement: existingReplacement, updated: false };
  if (!current) throw new ApiError("No se encontró la asignación actual.", 404);
  if (current.version !== expectedVersion || !ACTIVE_STATUSES.has(current.status)) throw conflict();
  if (replacement.roleId !== current.roleId || replacement.serviceDate !== current.serviceDate) {
    throw new ApiError("El reemplazo debe corresponder al mismo servicio y rol.");
  }
  await assertPersonExists(db, replacement.personId);
  const timestamp = nowIso();

  try {
    const results = await db.batch([
      db.prepare(
        `INSERT INTO assignments
          (id, person_id, role_id, service_date, status, reason_code, reason_text,
           replaces_assignment_id, created_at, updated_at, version)
         SELECT ?, ?, ?, ?, 'cancelled', NULL, NULL, ?, ?, ?, 1
         FROM assignments WHERE id = ? AND version = ? AND status IN ('selected', 'confirmed')`,
      ).bind(
        replacement.id, replacement.personId, replacement.roleId, replacement.serviceDate,
        currentId, replacement.createdAt, replacement.updatedAt, currentId, expectedVersion,
      ),
      db.prepare(
        `UPDATE assignments SET status = 'declined', reason_code = ?, reason_text = ?,
          updated_at = ?, version = version + 1
         WHERE id = ? AND version = ? AND status IN ('selected', 'confirmed')`,
      ).bind(reasonCode, reasonText, timestamp, currentId, expectedVersion),
      db.prepare(
        `UPDATE assignments SET status = 'selected', updated_at = ?
         WHERE id = ? AND status = 'cancelled'
           AND EXISTS (SELECT 1 FROM assignments WHERE id = ? AND status = 'declined' AND version = ?)`,
      ).bind(timestamp, replacement.id, currentId, expectedVersion + 1),
    ]);
    if (results.some((result) => (result.meta?.changes || 0) !== 1)) throw conflict();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (/UNIQUE|constraint/i.test(error.message || "")) throw conflict("No se pudo guardar el reemplazo porque el plan cambió.");
    throw error;
  }

  return {
    declined: await getAssignment(db, currentId),
    replacement: await getAssignment(db, replacement.id),
    updated: true,
  };
}

async function updateSetting(db, body) {
  const value = validateDate(body.nextServiceDate);
  const expectedVersion = body.expectedVersion == null ? null : Number(body.expectedVersion);
  if (expectedVersion != null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    throw new ApiError("La versión esperada no es válida.");
  }
  const current = await getSetting(db);
  if (current?.version === expectedVersion + 1 && current.nextServiceDate === value) {
    return { settings: current, updated: false };
  }
  const timestamp = nowIso();
  if (!current) {
    if (expectedVersion != null) throw conflict();
    try {
      await db.prepare(
        "INSERT INTO planner_settings (key, value, updated_at, version) VALUES ('next_service_date', ?, ?, 1)",
      ).bind(value, timestamp).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(error.message || "")) throw conflict();
      throw error;
    }
  } else {
    if (current.version !== expectedVersion) throw conflict();
    const result = await db.prepare(
      `UPDATE planner_settings SET value = ?, updated_at = ?, version = version + 1
       WHERE key = 'next_service_date' AND version = ?`,
    ).bind(value, timestamp, expectedVersion).run();
    if ((result.meta?.changes || 0) !== 1) throw conflict();
  }
  return { settings: await getSetting(db), updated: true };
}

async function bootstrapPlanner(db, body) {
  if (!Array.isArray(body.assignments) || body.assignments.length > 1000) {
    throw new ApiError("El historial local no es válido para inicializar.");
  }
  const items = body.assignments.map((item) => validateAssignment(item, { bootstrap: true }));
  const date = validateDate(body.nextServiceDate);
  const ids = new Set();
  const activeKeys = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new ApiError("El historial local contiene ids duplicados.");
    ids.add(item.id);
    if (ACTIVE_STATUSES.has(item.status)) {
      const key = `${item.serviceDate}:${item.roleId}`;
      if (activeKeys.has(key)) throw new ApiError("El historial local contiene asignaciones activas duplicadas.");
      activeKeys.add(key);
    }
    await assertPersonExists(db, item.personId);
  }

  const existingState = await getPlannerState(db);
  const marker = await db.prepare("SELECT value FROM planner_meta WHERE key = 'legacy_bootstrap'").first();
  if (marker || existingState.assignments.length > 0) {
    return { initialized: false, ...existingState };
  }
  if (items.length === 0) return { initialized: false, ...existingState };
  const timestamp = nowIso();
  const statements = [
    db.prepare("INSERT INTO planner_meta (key, value, updated_at) VALUES ('legacy_bootstrap', 'complete', ?)").bind(timestamp),
    db.prepare(
      `INSERT INTO planner_settings (key, value, updated_at, version)
       VALUES ('next_service_date', ?, ?, 1) ON CONFLICT(key) DO NOTHING`,
    ).bind(date, timestamp),
    ...items.map((item) => assignmentInsert(db, item)),
  ];
  try {
    await db.batch(statements);
    return { initialized: true, ...(await getPlannerState(db)) };
  } catch (error) {
    if (/UNIQUE|constraint/i.test(error.message || "")) {
      return { initialized: false, ...(await getPlannerState(db)) };
    }
    throw error;
  }
}

export async function onRequestGet(context) {
  try {
    return json(await getPlannerState(assertDb(context.env)));
  } catch (error) {
    return json({ error: error.message || "No se pudo cargar el plan compartido." }, { status: error.status || 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const db = assertDb(context.env);
    const body = await context.request.json();
    let result;
    if (body.operation === "create") result = await createAssignment(db, body);
    else if (body.operation === "transition") result = await transitionAssignment(db, body);
    else if (body.operation === "replace") result = await replaceAssignment(db, body);
    else if (body.operation === "setting") result = await updateSetting(db, body);
    else if (body.operation === "bootstrap") result = await bootstrapPlanner(db, body);
    else throw new ApiError("La operación del plan no es válida.");
    return json(result);
  } catch (error) {
    return json({ error: error.message || "No se pudo actualizar el plan compartido." }, { status: error.status || 500 });
  }
}
