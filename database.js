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
  CREATE TABLE IF NOT EXISTS row_meta (
    week_id    INTEGER NOT NULL,
    row_id     TEXT    NOT NULL,
    shift_time TEXT    DEFAULT '',
    PRIMARY KEY(week_id, row_id),
    FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS week_sections (
    week_id   INTEGER NOT NULL,
    section   TEXT    NOT NULL,
    row_count INTEGER DEFAULT 1,
    PRIMARY KEY(week_id, section),
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
  CREATE TABLE IF NOT EXISTS holidays (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    year INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shift_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    person        TEXT NOT NULL,
    user_id       INTEGER,
    day_text      TEXT NOT NULL,
    day_index     INTEGER DEFAULT -1,
    shift_text    TEXT NOT NULL,
    row_id        TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    status        TEXT DEFAULT 'pending',
    reject_reason TEXT DEFAULT '',
    week_id       INTEGER,
    needs_approval INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    resolved_at   TEXT,
    resolved_by   TEXT
  );
  CREATE TABLE IF NOT EXISTS vacation_plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    person     TEXT NOT NULL,
    week_start TEXT NOT NULL,
    type       TEXT DEFAULT 'yillik',
    year       INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(person, week_start, type)
  );
  CREATE TABLE IF NOT EXISTS ki_entries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    person     TEXT NOT NULL,
    days       REAL NOT NULL,
    reason     TEXT DEFAULT '',
    date_given TEXT DEFAULT (date('now','localtime')),
    week_id    INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// ── İlk Admin ──────────────────────────────────────────────────────────────
function seedAdmin() {
  const u = process.env.ADMIN_USER || 'admin';
  const p = process.env.ADMIN_PASS || 'nobet2026';
  if (!db.prepare('SELECT id FROM users WHERE role=?').get('admin')) {
    db.prepare('INSERT OR IGNORE INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)')
      .run(u, bcrypt.hashSync(p, 10), 'Yönetici', 'admin');
    console.log(`[DB] Admin oluşturuldu: ${u}`);
  }
}
seedAdmin();

// ── Türkiye Resmi Tatilleri (ilk kurulumda ekle) ───────────────────────────
function seedHolidays() {
  const count = db.prepare('SELECT COUNT(*) c FROM holidays').get().c;
  if (count > 0) return;
  const year = new Date().getFullYear();
  const fixed = [
    [`${year}-01-01`,"Yılbaşı"],[`${year}-04-23`,"Ulusal Egemenlik ve Çocuk Bayramı"],
    [`${year}-05-01`,"İşçi Bayramı"],[`${year}-05-19`,"Atatürk'ü Anma ve Gençlik Bayramı"],
    [`${year}-07-15`,"Demokrasi Bayramı"],[`${year}-08-30`,"Zafer Bayramı"],
    [`${year}-10-29`,"Cumhuriyet Bayramı"],
    [`${year+1}-01-01`,"Yılbaşı"],[`${year+1}-04-23`,"Ulusal Egemenlik ve Çocuk Bayramı"],
    [`${year+1}-05-01`,"İşçi Bayramı"],[`${year+1}-05-19`,"Atatürk'ü Anma ve Gençlik Bayramı"],
    [`${year+1}-07-15`,"Demokrasi Bayramı"],[`${year+1}-08-30`,"Zafer Bayramı"],
    [`${year+1}-10-29`,"Cumhuriyet Bayramı"],
  ];
  const ins = db.prepare('INSERT OR IGNORE INTO holidays(date,name,year) VALUES(?,?,?)');
  fixed.forEach(([d,n]) => ins.run(d, n, parseInt(d.slice(0,4))));
}
seedHolidays();

// ── Genel ──────────────────────────────────────────────────────────────────
const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting = (k,v) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,v);

// ── Kullanıcılar ───────────────────────────────────────────────────────────
const getUsers          = ()        => db.prepare('SELECT id,username,full_name,role,created_at FROM users ORDER BY role DESC,full_name').all();
const getUserByUsername = u         => db.prepare('SELECT * FROM users WHERE username=?').get(u);
const createUser        = (u,h,n,r) => db.prepare('INSERT INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)').run(u,h,n,r||'user');
const updateUserPass    = (id,h)    => db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(h,id);
const deleteUser        = id        => db.prepare('DELETE FROM users WHERE id=?').run(id);

// ── Haftalar ───────────────────────────────────────────────────────────────
const getWeeks   = ()           => db.prepare('SELECT * FROM weeks ORDER BY start_date DESC').all();
const getWeek    = id           => db.prepare('SELECT * FROM weeks WHERE id=?').get(id);
const getWeekByDate = date      => db.prepare('SELECT * FROM weeks WHERE start_date<=? AND end_date>=?').get(date,date);
const createWeek = (l,s,e,y)   => {
  const r = db.prepare('INSERT INTO weeks(label,start_date,end_date,year) VALUES(?,?,?,?)').run(l,s,e,y);
  return r;
};
const lockWeek   = id           => db.prepare('UPDATE weeks SET locked=1 WHERE id=?').run(id);
const unlockWeek = id           => db.prepare('UPDATE weeks SET locked=0 WHERE id=?').run(id);
const deleteWeek = id           => db.prepare('DELETE FROM weeks WHERE id=?').run(id);

// ── Dinamik satır sayıları ─────────────────────────────────────────────────
const DEFAULT_COUNTS = { pcr:5, tm:3, olcu:1, dis:2, hafizin:3, yl:3, dogum:1, ki:2 };

function getSectionCounts(week_id) {
  const rows = db.prepare('SELECT section,row_count FROM week_sections WHERE week_id=?').all(week_id);
  const counts = { ...DEFAULT_COUNTS };
  rows.forEach(r => { counts[r.section] = r.row_count; });
  return counts;
}

function setSectionCount(week_id, section, count) {
  db.prepare('INSERT OR REPLACE INTO week_sections(week_id,section,row_count) VALUES(?,?,?)')
    .run(week_id, section, Math.max(1, count));
}

// ── Satır meta (shift time seçimi) ────────────────────────────────────────
const getRowMeta    = week_id => db.prepare('SELECT row_id,shift_time FROM row_meta WHERE week_id=?').all(week_id);
const setRowMeta    = (week_id,row_id,shift_time) =>
  db.prepare('INSERT OR REPLACE INTO row_meta(week_id,row_id,shift_time) VALUES(?,?,?)').run(week_id,row_id,shift_time);

// ── Çizelge ────────────────────────────────────────────────────────────────
const getSchedule = wid => db.prepare("SELECT row_id,day_index,person FROM schedule WHERE week_id=? AND person!=''").all(wid);
const upsertCell  = (wid,rid,gi,p) => db.prepare('INSERT OR REPLACE INTO schedule(week_id,row_id,day_index,person) VALUES(?,?,?,?)').run(wid,rid,gi,p);
const getNotes    = wid => db.prepare('SELECT note_index,day_index,content FROM notes WHERE week_id=?').all(wid);
const upsertNote  = (wid,ni,gi,c) => db.prepare('INSERT OR REPLACE INTO notes(week_id,note_index,day_index,content) VALUES(?,?,?,?)').run(wid,ni,gi,c);

// ── Tatiller ───────────────────────────────────────────────────────────────
const getHolidays   = year => year ? db.prepare('SELECT * FROM holidays WHERE year=? ORDER BY date').all(year) : db.prepare('SELECT * FROM holidays ORDER BY date').all();
const addHoliday    = (date,name) => db.prepare('INSERT OR IGNORE INTO holidays(date,name,year) VALUES(?,?,?)').run(date,name,parseInt(date.slice(0,4)));
const deleteHoliday = id => db.prepare('DELETE FROM holidays WHERE id=?').run(id);
const isHoliday     = date => !!db.prepare('SELECT id FROM holidays WHERE date=?').get(date);

// ── Doğum günleri ──────────────────────────────────────────────────────────
const getBirthdays   = () => db.prepare('SELECT * FROM birthdays ORDER BY substr(birth_date,6)').all();
const addBirthday    = (n,d,nt) => db.prepare('INSERT INTO birthdays(name,birth_date,note) VALUES(?,?,?)').run(n,d,nt);
const deleteBirthday = id => db.prepare('DELETE FROM birthdays WHERE id=?').run(id);

// ── K.İ ────────────────────────────────────────────────────────────────────
const getKiEntries  = person => person
  ? db.prepare('SELECT * FROM ki_entries WHERE person=? ORDER BY date_given DESC').all(person)
  : db.prepare('SELECT * FROM ki_entries ORDER BY date_given DESC').all();
const addKiEntry    = (person,days,reason,date_given,week_id) =>
  db.prepare('INSERT INTO ki_entries(person,days,reason,date_given,week_id) VALUES(?,?,?,?,?)').run(person,days,reason||'',date_given||new Date().toISOString().slice(0,10),week_id||null);
const deleteKiEntry = id => db.prepare('DELETE FROM ki_entries WHERE id=?').run(id);
const getKiSummary  = () => {
  const PERSONEL = ["Alpcan ŞİŞMAN","Doğuhan DEMİROK","Evren KARA","İlyas GÜNEŞ","Özgür YENİAY","Özkan AYTEN","Mustafa ALTAŞ","Melih MEMİŞLER","Yusuf YİĞİT","Tolga KANOĞLU","Yağız GÜVEN"];
  const given = db.prepare('SELECT person, SUM(days) total FROM ki_entries GROUP BY person').all();
  const usedRows = db.prepare("SELECT person, COUNT(*) cnt FROM schedule WHERE row_id LIKE 'ki_%' AND person!='' GROUP BY person").all();
  const givenMap = {}; given.forEach(g => { givenMap[g.person] = g.total || 0; });
  const usedMap  = {}; usedRows.forEach(u => { usedMap[u.person] = u.cnt; });
  return PERSONEL.map(p => ({ person:p, given:givenMap[p]||0, used:usedMap[p]||0, remaining:(givenMap[p]||0)-(usedMap[p]||0), entries:getKiEntries(p) }));
};

// ── Talepler ───────────────────────────────────────────────────────────────
const getRequests     = (status,userId,role) => {
  if (role==='user' && userId) return db.prepare('SELECT * FROM shift_requests WHERE user_id=? ORDER BY created_at DESC').all(userId);
  if (status) return db.prepare('SELECT * FROM shift_requests WHERE status=? ORDER BY created_at DESC').all(status);
  return db.prepare('SELECT * FROM shift_requests ORDER BY created_at DESC LIMIT 300').all();
};
const getRequestById  = id => db.prepare('SELECT * FROM shift_requests WHERE id=?').get(id);
const createRequest   = d  => db.prepare(
  'INSERT INTO shift_requests(person,user_id,day_text,day_index,shift_text,row_id,note,week_id,needs_approval) VALUES(?,?,?,?,?,?,?,?,?)'
).run(d.person,d.user_id||null,d.day_text,d.day_index??-1,d.shift_text,d.row_id||'',d.note||'',d.week_id||null,d.needs_approval||0);
const resolveRequest  = (id,status,reason,by) => db.prepare(
  "UPDATE shift_requests SET status=?,reject_reason=?,resolved_by=?,resolved_at=datetime('now','localtime') WHERE id=?"
).run(status,reason||'',by||'',id);
const checkConflict   = (wid,gi,rid) => db.prepare(
  "SELECT person FROM shift_requests WHERE week_id=? AND day_index=? AND row_id=? AND status='approved' LIMIT 1"
).get(wid,gi,rid);

// ── İstatistik ─────────────────────────────────────────────────────────────
const getStats = year => {
  const wids = year
    ? db.prepare('SELECT id FROM weeks WHERE year=?').all(year).map(w=>w.id)
    : db.prepare('SELECT id FROM weeks').all().map(w=>w.id);
  if (!wids.length) return {};
  const ph = wids.map(()=>'?').join(',');
  const rows = db.prepare(`SELECT person,row_id,COUNT(*) cnt FROM schedule WHERE week_id IN (${ph}) AND person!='' GROUP BY person,row_id`).all(...wids);
  const s = {};
  rows.forEach(r => {
    if (!s[r.person]) s[r.person] = {sabah:0,prime:0,aksam:0,gece:0,dis:0,izin:0,yillik:0,dogum:0,ki:0,total:0};
    let cat = 'diger';
    if (r.row_id.startsWith('ki_'))    cat = 'ki';
    else if (r.row_id.startsWith('yl_'))    cat = 'yillik';
    else if (r.row_id.startsWith('dogum_')) cat = 'dogum';
    else if (r.row_id.startsWith('hafizin_')) cat = 'izin';
    else if (r.row_id.startsWith('dis_'))   cat = 'dis';
    else if (r.row_id.startsWith('olcu_'))  cat = 'sabah';
    // pcr_ ve tm_ satırları için row_meta'dan shift_time'a bakabiliriz ama basit tutuyoruz
    s[r.person][cat] = (s[r.person][cat]||0) + r.cnt;
    s[r.person].total += r.cnt;
  });
  return s;
};
const getYears = () => db.prepare('SELECT DISTINCT year FROM weeks ORDER BY year DESC').all().map(r=>r.year);


// ── Yıllık Planlama ────────────────────────────────────────────────────────
const getVacationPlans = (year) =>
  db.prepare('SELECT * FROM vacation_plans WHERE year=? ORDER BY week_start,person').all(year);
const toggleVacationPlan = (person, week_start, type) => {
  const year = parseInt(week_start.slice(0,4));
  const existing = db.prepare('SELECT id FROM vacation_plans WHERE person=? AND week_start=? AND type=?').get(person, week_start, type);
  if (existing) {
    db.prepare('DELETE FROM vacation_plans WHERE id=?').run(existing.id);
    return { action: 'removed' };
  } else {
    db.prepare('INSERT INTO vacation_plans(person,week_start,type,year) VALUES(?,?,?,?)').run(person, week_start, type, year);
    return { action: 'added' };
  }
};
const deleteVacationPlan = (id) => db.prepare('DELETE FROM vacation_plans WHERE id=?').run(id);

// Hafta açıldığında planlardan otomatik doldur
function autoPopulateFromPlans(weekId, startDate, endDate) {
  const plans = db.prepare('SELECT DISTINCT person,type FROM vacation_plans WHERE week_start >= ? AND week_start <= ?').all(startDate, endDate);
  let ylIdx = 1, kiIdx = 1;
  plans.forEach(plan => {
    let rowId;
    if (plan.type === 'yillik') { rowId = `yl_${ylIdx}`; ylIdx++; }
    else if (plan.type === 'ki') { rowId = `ki_${kiIdx}`; kiIdx++; }
    else return;
    // Tüm haftaya ekle
    for (let gi = 0; gi < 7; gi++) {
      db.prepare('INSERT OR REPLACE INTO schedule(week_id,row_id,day_index,person) VALUES(?,?,?,?)').run(weekId, rowId, gi, plan.person);
    }
    // Section count güncelle
    if (plan.type === 'yillik' && ylIdx > 3) {
      db.prepare('INSERT OR REPLACE INTO week_sections(week_id,section,row_count) VALUES(?,?,?)').run(weekId, 'yl', ylIdx - 1);
    }
  });
  return plans.length;
}

module.exports = {
  db, getSetting, setSetting,
  getUsers, getUserByUsername, createUser, updateUserPass, deleteUser,
  getWeeks, getWeek, getWeekByDate, createWeek, lockWeek, unlockWeek, deleteWeek,
  getSectionCounts, setSectionCount,
  getRowMeta, setRowMeta,
  getSchedule, upsertCell, getNotes, upsertNote,
  getHolidays, addHoliday, deleteHoliday, isHoliday,
  getBirthdays, addBirthday, deleteBirthday,
  getKiEntries, addKiEntry, deleteKiEntry, getKiSummary,
  getRequests, getRequestById, createRequest, resolveRequest, checkConflict,
  getStats, getYears,
  getVacationPlans, toggleVacationPlan, deleteVacationPlan, autoPopulateFromPlans
};
