CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  role_id TEXT NOT NULL,
  service_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('selected', 'confirmed', 'declined', 'completed', 'cancelled')),
  reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('unavailable_service', 'shy', 'pause', 'remove_rotation', 'other')),
  reason_text TEXT,
  replaces_assignment_id TEXT REFERENCES assignments(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_one_active
ON assignments(service_date, role_id)
WHERE status IN ('selected', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_assignments_service_role
ON assignments(service_date, role_id);

CREATE TABLE IF NOT EXISTS planner_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS planner_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
