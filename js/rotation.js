const STATUS_COMPLETED = "completed";
const STATUS_DECLINED = "declined";
const REASON_UNAVAILABLE = "unavailable_service";

function shuffle(array) {
  const items = [...array];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function getLastCompletedByPerson(assignments, roleId) {
  const map = new Map();
  assignments
    .filter((item) => item.roleId === roleId && item.status === STATUS_COMPLETED)
    .forEach((item) => {
      const current = map.get(item.personId);
      if (!current || item.serviceDate > current.serviceDate) {
        map.set(item.personId, item);
      }
    });
  return map;
}

function declinedForService(assignments, serviceDate, roleId) {
  const set = new Set();
  assignments
    .filter(
      (item) =>
        item.serviceDate === serviceDate &&
        item.roleId === roleId &&
        item.status === STATUS_DECLINED &&
        item.reasonCode === REASON_UNAVAILABLE,
    )
    .forEach((item) => set.add(item.personId));
  return set;
}

function servedInCurrentCycle(assignments, roleId, eligibleIds) {
  const completed = assignments
    .filter((item) => item.roleId === roleId && item.status === STATUS_COMPLETED)
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));

  const eligibleSet = new Set(eligibleIds);
  if (!eligibleSet.size) return new Set();

  let cycleSet = new Set();
  for (const item of completed) {
    if (!eligibleSet.has(item.personId)) continue;
    cycleSet.add(item.personId);
    if (cycleSet.size === eligibleSet.size) {
      cycleSet = new Set();
    }
  }
  return cycleSet;
}

export function selectNextPerson({ people, assignments, roleId, serviceDate, excludedPersonIds = [] }) {
  const excluded = new Set(excludedPersonIds);
  const unavailableSet = declinedForService(assignments, serviceDate, roleId);
  const eligiblePeople = people.filter(
    (person) => person.active && !person.paused && !excluded.has(person.id) && !unavailableSet.has(person.id),
  );

  if (!eligiblePeople.length) return null;

  const lastCompleted = getLastCompletedByPerson(assignments, roleId);
  const cycleSet = servedInCurrentCycle(
    assignments,
    roleId,
    eligiblePeople.map((person) => person.id),
  );

  const ranked = eligiblePeople.map((person) => {
    const completedRecord = lastCompleted.get(person.id);
    return {
      person,
      hasServed: Boolean(completedRecord),
      inCurrentCycle: cycleSet.has(person.id),
      lastServedAt: completedRecord?.serviceDate || "0000-00-00",
    };
  });

  ranked.sort((a, b) => {
    if (a.hasServed !== b.hasServed) return a.hasServed ? 1 : -1;
    if (a.inCurrentCycle !== b.inCurrentCycle) return a.inCurrentCycle ? 1 : -1;
    if (a.lastServedAt !== b.lastServedAt) return a.lastServedAt.localeCompare(b.lastServedAt);
    return 0;
  });

  const top = ranked[0];
  const tied = ranked.filter(
    (item) =>
      item.hasServed === top.hasServed &&
      item.inCurrentCycle === top.inCurrentCycle &&
      item.lastServedAt === top.lastServedAt,
  );

  return shuffle(tied)[0].person;
}
