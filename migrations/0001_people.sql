CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

UPDATE people
SET
  id = 'person-carlos-pacheco',
  name = 'Carlos Pacheco',
  title = 'Pastor',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'person-el-pastor'
  AND NOT EXISTS (SELECT 1 FROM people WHERE id = 'person-carlos-pacheco');

UPDATE people
SET
  active = CASE
    WHEN active = 0 OR (SELECT active FROM people WHERE id = 'person-el-pastor') = 0 THEN 0
    ELSE 1
  END,
  paused = CASE
    WHEN paused = 1 OR (SELECT paused FROM people WHERE id = 'person-el-pastor') = 1 THEN 1
    ELSE 0
  END,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 'person-carlos-pacheco'
  AND EXISTS (SELECT 1 FROM people WHERE id = 'person-el-pastor');

DELETE FROM people WHERE id = 'person-el-pastor';

INSERT INTO people (id, name, title, active, paused, created_at, updated_at)
VALUES (
  'person-carlos-pacheco',
  'Carlos Pacheco',
  'Pastor',
  1,
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  title = COALESCE(people.title, excluded.title),
  updated_at = excluded.updated_at;

INSERT OR IGNORE INTO people (id, name, title, active, paused, created_at, updated_at)
VALUES
  ('person-michel-pacheco', 'Michel Pacheco', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-eduard-lopez', 'Eduard Lopez', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-milca-abreu', 'Milca Abreu', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-soraya-al-bajuja', 'Soraya Al Bajuja', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-alexander-chinchai', 'Alexander Chinchai', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-junior-carmelo', 'Junior Carmelo', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-carmen', 'Carmen', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-cecilia-garcia', 'Cecilia Garcia', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-eliana', 'Eliana', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-ector', 'Ector', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-jennifer', 'Jennifer', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-jessica-cadena', 'Jessica Cadena', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-jose-chica', 'Jose Chica', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-luis-almonte', 'Luis Almonte', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-money', 'Money', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-margarita', 'Margarita', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-maria', 'Maria', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-mary', 'Mary', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-octavio-cadena', 'Octavio Cadena', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-raquel', 'Raquel', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-ruben', 'Ruben', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-vanjie', 'Vanjie', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-yasmari', 'Yasmari', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('person-diego', 'Diego', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
