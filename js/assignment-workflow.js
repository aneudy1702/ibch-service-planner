export const STATUS = Object.freeze({
  SELECTED: "selected",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

const ACTIVE_ASSIGNMENT_STATUSES = new Set([STATUS.SELECTED, STATUS.CONFIRMED]);

function nowIso() {
  return new Date().toISOString();
}

export function getCurrentAssignmentForService(assignments, roleId, serviceDate) {
  const current = assignments
    .filter(
      (item) =>
        item.roleId === roleId &&
        item.serviceDate === serviceDate &&
        ACTIVE_ASSIGNMENT_STATUSES.has(item.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  return current || null;
}

export function getHomeActionState(currentAssignment) {
  const status = currentAssignment?.status;
  return {
    canSelect: !currentAssignment,
    canConfirm: status === STATUS.SELECTED,
    canComplete: status === STATUS.CONFIRMED,
    canDecline: ACTIVE_ASSIGNMENT_STATUSES.has(status),
  };
}

export function createSelectionAssignment({ id, personId, roleId, serviceDate, now = nowIso() }) {
  return {
    id,
    personId,
    roleId,
    serviceDate,
    status: STATUS.SELECTED,
    createdAt: now,
    updatedAt: now,
  };
}

export function assertCanSelectPerson(currentAssignment) {
  if (currentAssignment && ACTIVE_ASSIGNMENT_STATUSES.has(currentAssignment.status)) {
    throw new Error('Ya hay una asignación activa. Use "Elegir otra persona" para reemplazarla.');
  }
}

export function confirmAssignment(currentAssignment, now = nowIso()) {
  if (!currentAssignment) {
    throw new Error("Primero seleccione una persona.");
  }
  if (currentAssignment.status !== STATUS.SELECTED) {
    throw new Error("Solo se puede confirmar una asignación seleccionada.");
  }
  return {
    ...currentAssignment,
    status: STATUS.CONFIRMED,
    updatedAt: now,
  };
}

export function completeAssignment(currentAssignment, now = nowIso()) {
  if (!currentAssignment) {
    throw new Error("No hay una asignación activa para completar.");
  }
  if (currentAssignment.status !== STATUS.CONFIRMED) {
    throw new Error("Solo se puede completar una asignación confirmada.");
  }
  return {
    ...currentAssignment,
    status: STATUS.COMPLETED,
    updatedAt: now,
  };
}

export function declineAssignment(currentAssignment, { reasonCode, reasonText = "", now = nowIso() }) {
  if (!currentAssignment || !ACTIVE_ASSIGNMENT_STATUSES.has(currentAssignment.status)) {
    throw new Error("No hay una asignación activa para reemplazar.");
  }
  return {
    ...currentAssignment,
    status: STATUS.DECLINED,
    reasonCode,
    reasonText,
    updatedAt: now,
  };
}
