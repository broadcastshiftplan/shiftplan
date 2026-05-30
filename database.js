const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const DB_DIR  = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'nobet.db');
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    full_name     TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS weeks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    label      TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date   TEXT NOT NULL,
    year       INTEGER NOT NULL,
    locked     INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS schedule (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id   INTEGER NOT NULL,
    row_id    TEXT NOT NULL,
    day_index INTEGER NOT NULL,
    person    TEXT DEFAULT '',
    UNIQUE(week_id,row_id,day_index),
    FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id    INTEGER NOT NULL,
    note_index INTEGER NOT NULL,
    day_index  INTEGER NOT NULL,
    content    TEXT DEFAULT '',
    UNIQUE(week_id,note_index,day_index),
    FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS birthdays (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    note       TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS shift_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    person      TEXT NOT NULL,
    user_id     INTEGER,
    day_text    TEXT NOT NULL,
    day_index   INTEGER DEFAULT -1,
    shift_text  TEXT NOT NULL,
    row_id      TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    status      TEXT DEFAULT 'pending',
    reject_reason TEXT DEFAULT '',
    week_id     INTEGER,
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    resolved_at TEXT,
    resolved_by TEXT
  );
`);

// ── İlk Admin ────────────────────────────────────────────────────────────────
function seedAdmin() {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'nobet2026';
  const exists = db.prepare('SELECT id FROM users WHERE role=?').get('admin');
  if (!exists) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT OR IGNORE INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)').run(adminUser, hash, 'Yönetici', 'admin');
    console.log(`[DB] Admin kullanıcı oluşturuldu: ${adminUser}`);
  }
}
seedAdmin();

// ── Ayarlar ──────────────────────────────────────────────────────────────────
const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting = (k,v) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,v);

// ── Kullanıcılar ─────────────────────────────────────────────────────────────
const getUsers     = ()      => db.prepare('SELECT id,username,full_name,role,created_at FROM users ORDER BY role DESC,full_name').all();
const getUser      = id      => db.prepare('SELECT * FROM users WHERE id=?').get(id);
const getUserByUsername = u  => db.prepare('SELECT * FROM users WHERE username=?').get(u);
const createUser   = (u,h,n,r) => db.prepare('INSERT INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)').run(u,h,n,r||'user');
const updateUserPass = (id,h) => db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(h,id);
const deleteUser   = id      => db.prepare('DELETE FROM users WHERE id=?').run(id);
const getUserCount = ()      => db.prepare('SELECT COUNT(*) as c FROM users').get().c;

// ── Haftalar ─────────────────────────────────────────────────────────────────
const getWeeks   = ()             => db.prepare('SELECT * FROM weeks ORDER BY start_date DESC').all();
const getWeek    = id             => db.prepare('SELECT * FROM weeks WHERE id=?').get(id);
const createWeek = (l,s,e,y)     => db.prepare('INSERT INTO weeks(label,start_date,end_date,year) VALUES(?,?,?,?)').run(l,s,e,y);
const lockWeek   = id             => db.prepare('UPDATE weeks SET locked=1 WHERE id=?').run(id);
const deleteWeek = id             => db.prepare('DELETE FROM weeks WHERE id=?').run(id);

// ── Çizelge ──────────────────────────────────────────────────────────────────
const getSchedule = wid => db.prepare("SELECT row_id,day_index,person FROM schedule WHERE week_id=? AND person!=''").all(wid);
const upsertCell  = (wid,rid,gi,p) => db.prepare('INSERT OR REPLACE INTO schedule(week_id,row_id,day_index,person) VALUES(?,?,?,?)').run(wid,rid,gi,p);
const getNotes    = wid => db.prepare('SELECT note_index,day_index,content FROM notes WHERE week_id=?').all(wid);
const upsertNote  = (wid,ni,gi,c) => db.prepare('INSERT OR REPLACE INTO notes(week_id,note_index,day_index,content) VALUES(?,?,?,?)').run(wid,ni,gi,c);

// ── Doğum günleri ─────────────────────────────────────────────────────────────
const getBirthdays   = () => db.prepare('SELECT * FROM birthdays ORDER BY substr(birth_date,6)').all();
const addBirthday    = (n,d,nt) => db.prepare('INSERT INTO birthdays(name,birth_date,note) VALUES(?,?,?)').run(n,d,nt);
const deleteBirthday = id => db.prepare('DELETE FROM birthdays WHERE id=?').run(id);

// ── Talepler ──────────────────────────────────────────────────────────────────
const getRequests     = (status,userId,role) => {
  if (role==='user' && userId) return db.prepare('SELECT * FROM shift_requests WHERE user_id=? ORDER BY created_at DESC').all(userId);
  if (status) return db.prepare('SELECT * FROM shift_requests WHERE status=? ORDER BY created_at DESC').all(status);
  return db.prepare('SELECT * FROM shift_requests ORDER BY created_at DESC LIMIT 300').all();
};
const getRequestById  = id => db.prepare('SELECT * FROM shift_requests WHERE id=?').get(id);
const createRequest   = d  => db.prepare(
  'INSERT INTO shift_requests(person,user_id,day_text,day_index,shift_text,row_id,note,week_id) VALUES(?,?,?,?,?,?,?,?)'
).run(d.person,d.user_id||null,d.day_text,d.day_index??-1,d.shift_text,d.row_id||'',d.note||'',d.week_id||null);
const resolveRequest  = (id,status,reason,by) => db.prepare(
  "UPDATE shift_requests SET status=?,reject_reason=?,resolved_by=?,resolved_at=datetime('now','localtime') WHERE id=?"
).run(status,reason||'',by||'',id);
const checkConflict   = (wid,gi,rid) => db.prepare(
  "SELECT person FROM shift_requests WHERE week_id=? AND day_index=? AND row_id=? AND status='approved' LIMIT 1"
).get(wid,gi,rid);

// ── İstatistik ────────────────────────────────────────────────────────────────
const ROW_CATS = {};
// PCR 1-2, PCR 3, TEK.MON — aynı shift yapısı
const SHIFT_CATS = ['sabah','sabah','araci','araci','aksam','aksam','gece'];
['p1','p3','tm'].forEach(pfx => {
  ['a','b','c','d','e','f','g'].forEach((l,i) => { ROW_CATS[pfx+l] = SHIFT_CATS[i]; });
});
ROW_CATS['ob1']='sabah';
['iz1','iz2','iz3'].forEach(id=>{ ROW_CATS[id]='izin'; });
['dg1','dg2'].forEach(id=>{ ROW_CATS[id]='dis'; });
['yl1','yl2','yl3'].forEach(id=>{ ROW_CATS[id]='yillik'; });
ROW_CATS['dgi1']='dogum';
ROW_CATS['ki1']='ki';
const getStats = year => {
  const wids = year
    ? db.prepare('SELECT id FROM weeks WHERE year=?').all(year).map(w=>w.id)
    : db.prepare('SELECT id FROM weeks').all().map(w=>w.id);
  if (!wids.length) return {};
  const ph = wids.map(()=>'?').join(',');
  const rows = db.prepare(`SELECT person,row_id,COUNT(*) cnt FROM schedule WHERE week_id IN (${ph}) AND person!='' GROUP BY person,row_id`).all(...wids);
  const s = {};
  rows.forEach(r=>{
    if(!s[r.person])s[r.person]={sabah:0,araci:0,aksam:0,gece:0,dis:0,izin:0,yillik:0,dogum:0,total:0};
    const cat=ROW_CATS[r.row_id]||'diger';
    s[r.person][cat]=(s[r.person][cat]||0)+r.cnt;
    s[r.person].total+=r.cnt;
  });
  return s;
};
const getYears = () => db.prepare('SELECT DISTINCT year FROM weeks ORDER BY year DESC').all().map(r=>r.year);

module.exports = {
  db, getSetting, setSetting,
  getUsers, getUser, getUserByUsername, createUser, updateUserPass, deleteUser, getUserCount,
  getWeeks, getWeek, createWeek, lockWeek, deleteWeek,
  getSchedule, upsertCell, getNotes, upsertNote,
  getBirthdays, addBirthday, deleteBirthday,
  getRequests, getRequestById, createRequest, resolveRequest, checkConflict,
  getStats, getYears
};

// ── K.İ (Kullanılmayan İzin) ──────────────────────────────────────────────────
// Sonradan eklendi — tablo zaten varsa sorun olmaz
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ki_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      person     TEXT    NOT NULL,
      days       REAL    NOT NULL,
      reason     TEXT    DEFAULT '',
      week_id    INTEGER,
      created_at TEXT    DEFAULT (datetime('now','localtime'))
    );
  `);
} catch(e) {}

const getKiEntries   = person => person
  ? db.prepare('SELECT * FROM ki_entries WHERE person=? ORDER BY created_at DESC').all(person)
  : db.prepare('SELECT * FROM ki_entries ORDER BY created_at DESC').all();

const addKiEntry     = (person, days, reason, week_id) =>
  db.prepare('INSERT INTO ki_entries(person,days,reason,week_id) VALUES(?,?,?,?)').run(person, days, reason, week_id||null);

const deleteKiEntry  = id => db.prepare('DELETE FROM ki_entries WHERE id=?').run(id);

// K.İ kullanım (schedule'da ki1 satırında kaç kez geçiyor)
const getKiUsed = person => {
  const rows = db.prepare("SELECT COUNT(*) cnt FROM schedule WHERE row_id='ki1' AND person=? AND person!=''").get(person);
  return rows?.cnt || 0;
};

// Tüm personel için K.İ özeti
const getKiSummary = () => {
  const entries = db.prepare('SELECT person, SUM(days) total FROM ki_entries GROUP BY person').all();
  const used    = db.prepare("SELECT person, COUNT(*) cnt FROM schedule WHERE row_id='ki1' AND person!='' GROUP BY person").all();
  const usedMap = {};
  used.forEach(u => { usedMap[u.person] = u.cnt; });
  return entries.map(e => ({
    person:    e.person,
    given:     e.total || 0,
    used:      usedMap[e.person] || 0,
    remaining: (e.total || 0) - (usedMap[e.person] || 0)
  }));
};

// Module exports güncelle
Object.assign(module.exports, { getKiEntries, addKiEntry, deleteKiEntry, getKiUsed, getKiSummary });
