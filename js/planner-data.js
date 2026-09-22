import {
  addAssignment,
  getAssignments,
  getPlannerSyncState,
  getSettings,
  markLegacyBootstrapCompleted,
  preservePlannerConflict,
  queuePlannerOperation,
  removePlannerOperation,
  saveSettings,
  saveSharedPlannerCache,
  upsertAssignment,
} from "./storage.js";

const PLANNER_API_URL = "./api/planner";
const CONFLICT_MESSAGE = "El plan cambió en otro dispositivo. Actualizamos la información más reciente.";

export class PlannerDataError extends Error {
  constructor(message, { status = null, kind = "unknown", conflict = false, localSaved = false } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.conflict = conflict;
    this.localSaved = localSaved;
  }
}

function operationId() {
  return `planner-op-${crypto.randomUUID()}`;
}

async function requestPlanner(options) {
  let response;
  try {
    response = await fetch(PLANNER_API_URL, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch (cause) {
    throw new PlannerDataError("No se pudo conectar con el plan compartido.", {
      kind: "network",
      localSaved: false,
    });
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    throw new PlannerDataError("El servicio del plan compartido devolvió una respuesta no válida.", {
      kind: "http",
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new PlannerDataError(body.error || "No se pudo actualizar el plan compartido.", {
      kind: "http",
      status: response.status,
      conflict: response.status === 409,
    });
  }
  return body;
}

function isRetryable(error) {
  return error.kind === "network" || (error.kind === "http" && error.status >= 500);
}

function localSetting() {
  const settings = getSettings();
  return {
    nextServiceDate: settings.nextServiceDate,
    version: settings.sharedVersion,
    updatedAt: settings.sharedUpdatedAt,
  };
}

function saveServerState(payload) {
  saveSharedPlannerCache({
    assignments: Array.isArray(payload.assignments) ? payload.assignments : [],
    settings: payload.settings || null,
  });
}

function saveOperationResponse(operation, payload) {
  if (operation.type === "create") {
    upsertAssignment(payload.assignment);
  } else if (operation.type === "transition") {
    upsertAssignment(payload.assignment);
  } else if (operation.type === "replace") {
    upsertAssignment(payload.declined);
    upsertAssignment(payload.replacement);
  } else if (operation.type === "setting") {
    saveSettings({
      nextServiceDate: payload.settings.nextServiceDate,
      sharedVersion: payload.settings.version,
      sharedUpdatedAt: payload.settings.updatedAt,
    });
  }
}

function applyOptimistic(operation) {
  if (operation.type === "create") {
    upsertAssignment({ ...operation.request.assignment, version: 1 });
  } else if (operation.type === "transition") {
    const current = getAssignments().find((item) => item.id === operation.request.id);
    if (current) {
      upsertAssignment({
        ...current,
        status: operation.request.status,
        reasonCode: operation.request.reasonCode || null,
        reasonText: operation.request.reasonText || null,
        updatedAt: operation.createdAt,
        version: operation.request.expectedVersion + 1,
      });
    }
  } else if (operation.type === "replace") {
    const current = getAssignments().find((item) => item.id === operation.request.currentId);
    if (current) {
      upsertAssignment({
        ...current,
        status: "declined",
        reasonCode: operation.request.reasonCode,
        reasonText: operation.request.reasonText || null,
        updatedAt: operation.createdAt,
        version: operation.request.expectedVersion + 1,
      });
    }
    upsertAssignment({
      ...operation.request.replacement,
      replacementForId: operation.request.currentId,
      version: 1,
    });
  } else if (operation.type === "setting") {
    saveSettings({
      nextServiceDate: operation.request.nextServiceDate,
      sharedVersion: (operation.request.expectedVersion || 0) + 1,
      sharedUpdatedAt: operation.createdAt,
    });
  }
}

async function submitOperation(operation) {
  try {
    const payload = await requestPlanner({ method: "POST", body: JSON.stringify(operation.request) });
    saveOperationResponse(operation, payload);
    return { synced: true, payload };
  } catch (error) {
    if (error.conflict) {
      preservePlannerConflict(operation, error.message);
      await refreshSharedPlannerState({ allowBootstrap: false, replayPending: false });
      throw new PlannerDataError(CONFLICT_MESSAGE, { status: 409, kind: "http", conflict: true });
    }
    if (isRetryable(error)) {
      applyOptimistic(operation);
      queuePlannerOperation(operation);
      throw new PlannerDataError(
        "Sin conexión. El cambio quedó guardado en este dispositivo y se reintentará.",
        { status: error.status, kind: error.kind, localSaved: true },
      );
    }
    throw error;
  }
}

export async function createSharedAssignment(assignment) {
  const operation = {
    id: operationId(),
    type: "create",
    createdAt: new Date().toISOString(),
    request: { operation: "create", assignment },
  };
  return submitOperation(operation);
}

export async function transitionSharedAssignment(current, next) {
  const operation = {
    id: operationId(),
    type: "transition",
    createdAt: new Date().toISOString(),
    request: {
      operation: "transition",
      id: current.id,
      expectedVersion: current.version ?? 1,
      status: next.status,
      reasonCode: next.reasonCode || null,
      reasonText: next.reasonText || null,
    },
  };
  return submitOperation(operation);
}

export async function replaceSharedAssignment(current, declined, replacement) {
  const operation = {
    id: operationId(),
    type: "replace",
    createdAt: new Date().toISOString(),
    request: {
      operation: "replace",
      currentId: current.id,
      expectedVersion: current.version ?? 1,
      reasonCode: declined.reasonCode,
      reasonText: declined.reasonText || null,
      replacement,
    },
  };
  return submitOperation(operation);
}

export async function updateSharedNextServiceDate(nextServiceDate) {
  const settings = getSettings();
  const operation = {
    id: operationId(),
    type: "setting",
    createdAt: new Date().toISOString(),
    request: {
      operation: "setting",
      nextServiceDate,
      expectedVersion: settings.sharedVersion,
    },
  };
  return submitOperation(operation);
}

async function bootstrapLegacyState(serverState) {
  const sync = getPlannerSyncState();
  if (sync.legacyBootstrapCompleted) return serverState;
  const localAssignments = getAssignments();
  if (localAssignments.length === 0) {
    if (serverState.assignments.length > 0) markLegacyBootstrapCompleted();
    return serverState;
  }
  const settings = getSettings();
  const payload = await requestPlanner({
    method: "POST",
    body: JSON.stringify({
      operation: "bootstrap",
      assignments: localAssignments.map(({ version, replacementForId, ...assignment }) => assignment),
      nextServiceDate: settings.nextServiceDate,
    }),
  });
  markLegacyBootstrapCompleted({ clearPending: payload.initialized === true });
  return payload;
}

async function replayPendingOperations() {
  const pending = [...getPlannerSyncState().pendingOperations];
  let conflicts = 0;
  for (let index = 0; index < pending.length; index += 1) {
    const operation = pending[index];
    try {
      const payload = await requestPlanner({ method: "POST", body: JSON.stringify(operation.request) });
      saveOperationResponse(operation, payload);
      removePlannerOperation(operation.id);
    } catch (error) {
      if (error.conflict || (!isRetryable(error) && error.status)) {
        preservePlannerConflict(operation, error.message);
        conflicts += 1;
        for (const dependent of pending.slice(index + 1)) {
          preservePlannerConflict(dependent, "No se reintentó porque una operación anterior entró en conflicto.");
          conflicts += 1;
        }
      }
      break;
    }
  }
  return conflicts;
}

export async function refreshSharedPlannerState({ allowBootstrap = true, replayPending = true } = {}) {
  try {
    let serverState = await requestPlanner({ method: "GET" });
    if (allowBootstrap && !getPlannerSyncState().legacyBootstrapCompleted) {
      serverState = await bootstrapLegacyState(serverState);
    } else if (!getPlannerSyncState().legacyBootstrapCompleted && serverState.assignments.length > 0) {
      markLegacyBootstrapCompleted();
    }

    if (!serverState.settings) {
      const settingPayload = await requestPlanner({
        method: "POST",
        body: JSON.stringify({
          operation: "setting",
          nextServiceDate: getSettings().nextServiceDate,
          expectedVersion: null,
        }),
      });
      serverState.settings = settingPayload.settings;
    }
    saveServerState(serverState);

    const conflicts = replayPending ? await replayPendingOperations() : 0;
    if (replayPending && getPlannerSyncState().pendingOperations.length === 0) {
      serverState = await requestPlanner({ method: "GET" });
      saveServerState(serverState);
    }
    return { fromCache: false, conflicts, ...serverState };
  } catch (error) {
    console.error("Shared planner API unavailable; using cached planner state.", {
      kind: error.kind || "unknown",
      status: error.status || null,
      message: error.message,
    });
    return {
      fromCache: true,
      conflicts: 0,
      assignments: getAssignments(),
      settings: localSetting(),
      error,
    };
  }
}
