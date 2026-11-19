-- Chores: jobs that rotate between members (dishes, trash), off until a group
-- turns them on. A chore's turns repeat every `every_days` from `starts`,
-- going round `rotation` (member ids in turn order) and skipping anyone away.
-- A swap hands one turn (by its start date) to someone else.
ALTER TABLE groups ADD COLUMN chores INTEGER NOT NULL DEFAULT 0 CHECK (chores IN (0, 1));

CREATE TABLE chores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  instructions TEXT NOT NULL DEFAULT '',
  every_days INTEGER NOT NULL CHECK (every_days BETWEEN 1 AND 28),
  starts TEXT NOT NULL,
  ends TEXT,
  rotation TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends IS NULL OR ends >= starts)
);
CREATE INDEX chores_group ON chores(group_id);

CREATE TABLE chore_swaps (
  chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  turn_start TEXT NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id),
  PRIMARY KEY (chore_id, turn_start)
);

-- Time away from a group's chores: turns starting from `from_date` up to
-- (not including) `until_date`, the day they're back, skip the member.
CREATE TABLE chore_away (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id),
  from_date TEXT NOT NULL,
  until_date TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  CHECK (from_date < until_date)
);
CREATE INDEX chore_away_group ON chore_away(group_id);

-- Turns whose "your turn" push went out, so the daily cron sends each once.
CREATE TABLE chore_reminders (
  chore_id INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  turn_start TEXT NOT NULL,
  PRIMARY KEY (chore_id, turn_start)
);
ALTER TABLE users ADD COLUMN notify_chores INTEGER NOT NULL DEFAULT 1;
