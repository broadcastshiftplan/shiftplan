const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'nobet.db');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS weeks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT    NOT NULL,
    start_date  TEXT    NOT NULL,
    end_date    TEXT    NOT NULL,
    year        INTEGER NOT NULL,
    locked      INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS schedule (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id     INTEGER NOT NULL,
    row_id      TEXT    NOT NULL,
    day_index   INTEGER NOT NULL,
    person      TEXT    DEFAULT '',
    UNIQUE(week_id, row_id, day_index),
    FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id     INTEGER NOT NULL,
    note_index  INTEGER NOT NULL,
    day_index   INTEGER NOT NULL,
    content     TEXT    DEFAULT '',
    UNIQUE(week_id, note_index, day_index),
    FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS wa_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    from_number  TEXT,
    raw_message  TEXT,
    person_name  TEXT,
    day_text     TEXT,
    shift_text   TEXT,
    status       TEXT    DEFAULT 'pending',
    week_id      INTEGER,
    row_id       TEXT,
    day_index    INTEGER,
    created_at   TEXT    DEFAULT (datetime('now','localtime')),
    resolved_at  TEXT,
    FOREIGN KEY(week_id) REFERENCES weeks(id)
  );
`);

// ── Helpers ──────────────────────────────────────────────────
const getSetting  = (key) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value;
const setSetting  = (key, val) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(key, val);

const getWeeks    = () => db.prepare('SELECT * FROM weeks ORDER BY start_date DESC').all();
const getWeek     = (id) => db.prepare('SELECT * FROM weeks WHERE id=?').get(id);
const createWeek  = (label, start_date, end_date, year) =>
  db.prepare('INSERT INTO weeks(label,start_date,end_date,year) VALUES(?,?,?,?)').run(label, start_date, end_date, year);
const lockWeek    = (id) => db.prepare('UPDATE weeks SET locked=1 WHERE id=?').run(id);
const deleteWeek  = (id) => db.prepare('DELETE FROM weeks WHERE id=?').run(id);

const getSchedule = (week_id) => db.prepare('SELECT row_id,day_index,person FROM schedule WHERE week_id=? AND person!=\'\'').all(week_id);
const upsertCell  = (week_id, row_id, day_index, person) =>
  db.prepare('INSERT OR REPLACE INTO schedule(week_id,row_id,day_index,person) VALUES(?,?,?,?)').run(week_id, row_id, day_index, person);

const getNotes    = (week_id) => db.prepare('SELECT note_index,day_index,content FROM notes WHERE week_id=?').all(week_id);
const upsertNote  = (week_id, note_index, day_index, content) =>
  db.prepare('INSERT OR REPLACE INTO notes(week_id,note_index,day_index,content) VALUES(?,?,?,?)').run(week_id, note_index, day_index, content);

const getWaRequests   = (status) => status
  ? db.prepare('SELECT * FROM wa_requests WHERE status=? ORDER BY created_at DESC').all(status)
  : db.prepare('SELECT * FROM wa_requests ORDER BY created_at DESC LIMIT 100').all();
const createWaRequest = (data) =>
  db.prepare('INSERT INTO wa_requests(from_number,raw_message,person_name,day_text,shift_text,week_id) VALUES(?,?,?,?,?,?)').run(
    data.from_number, data.raw_message, data.person_name, data.day_text, data.shift_text, data.week_id);
const resolveWaRequest = (id, status, row_id, day_index) =>
  db.prepare('UPDATE wa_requests SET status=?,row_id=?,day_index=?,resolved_at=datetime(\'now\',\'localtime\') WHERE id=?').run(status, row_id, day_index, id);

// ── Kümülatif istatistik ─────────────────────────────────────
const getCumulativeStats = (year) => {
  const yearWeeks = year
    ? db.prepare('SELECT id FROM weeks WHERE year=?').all(year).map(w => w.id)
    : db.prepare('SELECT id FROM weeks').all().map(w => w.id);
  if (!yearWeeks.length) return [];

  const ph = yearWeeks.map(() => '?').join(',');
  const rows = db.prepare(`SELECT person, row_id, COUNT(*) as cnt FROM schedule WHERE week_id IN (${ph}) AND person!='' GROUP BY person, row_id`).all(...yearWeeks);
  const izin = db.prepare(`SELECT person, day_index FROM schedule WHERE week_id IN (${ph}) AND row_id LIKE 'r1%' AND person!=''`).all(...yearWeeks);

  const stats = {};
  rows.forEach(r => {
    if (!stats[r.person]) stats[r.person] = { sabah:0, araci:0, aksam:0, gece:0, dis:0, izin:0, yillik:0, total:0 };
    const cat = ROW_CATS[r.row_id] || 'diger';
    stats[r.person][cat] = (stats[r.person][cat] || 0) + r.cnt;
    stats[r.person].total += r.cnt;
  });
  return stats;
};

// row_id → kategori mapping
const ROW_CATS = {
  r01:'sabah', r02:'aksam', r03:'sabah', r04:'aksam',
  r05:'araci', r06:'araci', r07:'araci', r08:'aksam', r09:'aksam', r10:'gece',
  r11:'sabah', r12:'dis', 'r12b':'dis',
  r13:'izin', r14:'izin', r15:'izin',
  r16:'yillik', r17:'yillik', r18:'yillik',
};

module.exports = {
  db, getSetting, setSetting,
  getWeeks, getWeek, createWeek, lockWeek, deleteWeek,
  getSchedule, upsertCell,
  getNotes, upsertNote,
  getWaRequests, createWaRequest, resolveWaRequest,
  getCumulativeStats, ROW_CATS
};
