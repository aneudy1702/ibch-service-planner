function nowIso() {
  return new Date().toISOString();
}

export function slugify(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function normalizeTitle(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizedName(value) {
  return value
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isPastorDuplicate(person) {
  return (
    person.id === "person-el-pastor" ||
    person.id === "person-carlos-pacheco" ||
    normalizedName(person.name) === "el pastor" ||
    normalizedName(person.name) === "carlos pacheco"
  );
}

export function normalizePerson(person = {}, index = 0) {
  const timestamp = nowIso();
  const rawName = typeof person.name === "string" ? person.name.trim() : "";
  const name = rawName || `Person ${index + 1}`;
  const slug = slugify(name);
  const createdAt = typeof person.createdAt === "string" && person.createdAt ? person.createdAt : timestamp;
  return {
    id: typeof person.id === "string" && person.id.trim() ? person.id.trim() : `person-${slug || `seed-${index + 1}`}`,
    name,
    title: normalizeTitle(person.title),
    active: person.active ?? true,
    paused: person.paused ?? false,
    syncPending: person.syncPending === true,
    createdAt,
    updatedAt: typeof person.updatedAt === "string" && person.updatedAt ? person.updatedAt : createdAt,
  };
}

export function normalizePeople(people = []) {
  const normalized = people.map((person, index) => normalizePerson(person, index));
  const deduped = [];
  const seen = new Set();
  const pastorCandidates = [];

  for (const person of normalized) {
    if (isPastorDuplicate(person)) {
      pastorCandidates.push(person);
      continue;
    }

    if (seen.has(person.id)) continue;
    seen.add(person.id);
    deduped.push(person);
  }

  if (pastorCandidates.length > 0) {
    const carlos = pastorCandidates.find((person) => person.id === "person-carlos-pacheco") || pastorCandidates[0];
    deduped.push({
      ...carlos,
      id: "person-carlos-pacheco",
      name: "Carlos Pacheco",
      title: "Pastor",
    });
  }

  return deduped;
}

export function displayPersonName(person) {
  if (!person) return "";
  return person.title ? `${person.name} · ${person.title}` : person.name;
}
