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
    published  INTEGER DEFAULT 0,
    draft_mode INTEGER DEFAULT 0,
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
  CREATE TABLE IF NOT EXISTS sodexo_approvals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    person     TEXT NOT NULL,
    date       TEXT NOT NULL,
    approved   INTEGER DEFAULT 0,
    approved_by TEXT DEFAULT '',
    approved_at TEXT DEFAULT '',
    UNIQUE(person, date)
  );

  CREATE TABLE IF NOT EXISTS schedule_snapshot (
    week_id    INTEGER NOT NULL,
    row_id     TEXT NOT NULL,
    day_index  INTEGER NOT NULL,
    person     TEXT DEFAULT '',
    PRIMARY KEY(week_id, row_id, day_index)
  );

  CREATE TABLE IF NOT EXISTS week_views (
    week_id    INTEGER NOT NULL,
    username   TEXT NOT NULL,
    viewed_at  TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY(week_id, username)
  );

  CREATE TABLE IF NOT EXISTS row_meta_snapshot (
    week_id    INTEGER NOT NULL,
    row_id     TEXT NOT NULL,
    shift_time TEXT DEFAULT '',
    PRIMARY KEY(week_id, row_id)
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
// ── Migration: Eksik kolonları ekle ──────────────────────────────────────
try { db.exec("ALTER TABLE ki_entries ADD COLUMN date_given TEXT DEFAULT (date('now','localtime'))"); console.log('[DB] date_given kolonu eklendi'); } catch(e) {}
try { db.exec("ALTER TABLE shift_requests ADD COLUMN needs_approval INTEGER DEFAULT 0"); } catch(e) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS vacation_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  week_start TEXT NOT NULL,
  type TEXT DEFAULT 'yillik',
  year INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(person, week_start, type)
)`); } catch(e) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS row_meta (
  week_id INTEGER NOT NULL, row_id TEXT NOT NULL, shift_time TEXT DEFAULT '',
  PRIMARY KEY(week_id, row_id)
)`); } catch(e) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS week_sections (
  week_id INTEGER NOT NULL, section TEXT NOT NULL, row_count INTEGER DEFAULT 1,
  PRIMARY KEY(week_id, section)
)`); } catch(e) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE, name TEXT NOT NULL, year INTEGER NOT NULL
)`); } catch(e) {}

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

// ── Migration: Eski veritabanına eksik kolonları ekle ─────────────────────
(function runMigrations() {
  const migrations = [
    // Kolon eklemeleri (zaten varsa hata vermez)
    "ALTER TABLE weeks ADD COLUMN published INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1",
    "ALTER TABLE weeks ADD COLUMN draft_mode INTEGER DEFAULT 0",
    "ALTER TABLE ki_entries ADD COLUMN date_given TEXT DEFAULT (date('now','localtime'))",
    "ALTER TABLE ki_entries ADD COLUMN week_id INTEGER",
    "ALTER TABLE shift_requests ADD COLUMN needs_approval INTEGER DEFAULT 0",
    "ALTER TABLE shift_requests ADD COLUMN resolved_by TEXT",
    // Eski row_id formatlarını temizle (schedule)
    "DELETE FROM schedule WHERE row_id IN ('p1a','p1b','p1c','p1d','p1e','p1f','p1g','p3a','p3b','p3c','p3d','p3e','p3f','p3g','tma','tmb','tmc','tmd','tme','tmf','tmg','ob1','r01','r02','r03','r04','r05','r06','r07','r08','r09','r10','r11','r12','r12b','r13','r14','r15','r16','r17','r18','bday','iz1','iz2','iz3','dg1','dg2','yl1','yl2','yl3','dgi1','ki1','ki2','pcr_4','pcr_5','pcr_6','pcr_7')",
    "DELETE FROM schedule_snapshot WHERE row_id IN ('pcr_4','pcr_5','pcr_6','pcr_7','p1a','p1b','p1c','p1d','p1e','p1f','p1g','tma','tmb','tmc','tmd','tme','tmf','tmg')",
    // Eski row_id formatlarını temizle (row_meta)
    "DELETE FROM row_meta WHERE row_id IN ('p1a','p1b','p1c','p1d','p1e','p1f','p1g','p3a','p3b','p3c','p3d','p3e','p3f','p3g','tma','tmb','tmc','tmd','tme','tmf','tmg','r01','r02','r03','r04','r05','r06','r07','r08','r09','r10','r11','r12','pcr_4','pcr_5','pcr_6','pcr_7')",
  ];
    migrations.forEach(sql => {
    try { db.exec(sql); console.log('[DB Migration] OK:', sql.slice(0,50)); }
    catch(e) { /* kolon zaten var, normal */ }
  });
})();


// ── Genel ──────────────────────────────────────────────────────────────────
const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value;
const setSetting = (k,v) => db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,v);

// ── Kullanıcılar ───────────────────────────────────────────────────────────
const getUsers          = ()        => db.prepare('SELECT id,username,full_name,role,COALESCE(active,1) as active FROM users ORDER BY role DESC,full_name').all();
const getActivePersonnel= ()        => db.prepare("SELECT full_name FROM users WHERE role='user' AND COALESCE(active,1)=1 ORDER BY full_name").all().map(u=>u.full_name);
const setUserActive     = (id,val)  => db.prepare('UPDATE users SET active=? WHERE id=?').run(val?1:0, id);
const getUserByUsername = u         => db.prepare('SELECT * FROM users WHERE username=?').get(u);
const createUser        = (u,h,n,r) => db.prepare('INSERT INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)').run(u,h,n,r||'user');
const updateUserPass    = (id,h)    => db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(h,id);
const deleteUser        = id        => db.prepare('DELETE FROM users WHERE id=?').run(id);

// ── Haftalar ───────────────────────────────────────────────────────────────
const getWeeks        = ()    => db.prepare('SELECT * FROM weeks ORDER BY start_date DESC').all();
const getPublishedWeeks = ()  => db.prepare('SELECT * FROM weeks WHERE published=1 ORDER BY start_date DESC').all();
const getWeek    = id           => db.prepare('SELECT * FROM weeks WHERE id=?').get(id);
const getWeekByDate = date      => db.prepare('SELECT * FROM weeks WHERE start_date<=? AND end_date>=?').get(date,date);
const createWeek = (l,s,e,y)   => {
  const r = db.prepare('INSERT INTO weeks(label,start_date,end_date,year) VALUES(?,?,?,?)').run(l,s,e,y);
  return r;
};
const lockWeek     = id => db.prepare('UPDATE weeks SET locked=1 WHERE id=?').run(id);
const publishWeek  = id => db.prepare('UPDATE weeks SET published=1, draft_mode=0 WHERE id=?').run(id);
const unpublishWeek= id => db.prepare('UPDATE weeks SET published=0 WHERE id=?').run(id);
const draftWeek    = id => db.prepare('UPDATE weeks SET draft_mode=1 WHERE id=?').run(id);
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
const getKiEntries  = person => {
  try {
    return person
      ? db.prepare('SELECT * FROM ki_entries WHERE person=? ORDER BY date_given DESC').all(person)
      : db.prepare('SELECT * FROM ki_entries ORDER BY date_given DESC').all();
  } catch(e) {
    // date_given kolonu henüz yoksa created_at ile sırala
    return person
      ? db.prepare('SELECT *, created_at as date_given FROM ki_entries WHERE person=? ORDER BY created_at DESC').all(person)
      : db.prepare('SELECT *, created_at as date_given FROM ki_entries ORDER BY created_at DESC').all();
  }
};
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
  // schedule + row_meta join ile shift_time bilgisini al
  const rows = db.prepare(`
    SELECT s.person, s.row_id, s.week_id,
           COALESCE(rm.shift_time, '') as shift_time,
           COUNT(*) cnt
    FROM schedule s
    LEFT JOIN row_meta rm ON rm.week_id=s.week_id AND rm.row_id=s.row_id
    WHERE s.week_id IN (${ph}) AND s.person!=''
    GROUP BY s.person, s.row_id, s.week_id
  `).all(...wids);

  // Varsayılan başlangıç saatleri (row_meta'da kayıt yoksa)
  const DEFAULT_START = {
    // PCR satırları (1-7)
    pcr_1:'06:15',pcr_2:'08:00',pcr_3:'10:00',pcr_4:'12:00',pcr_5:'15:00',pcr_6:'17:00',pcr_7:'00:00',
    // TM satırları (1-7)  
    tm_1:'06:15',tm_2:'08:00',tm_3:'10:00',tm_4:'12:00',tm_5:'15:00',tm_6:'17:00',tm_7:'00:00',
    // Diğer
    olcu_1:'08:00',dis_1:'08:00',dis_2:'08:00',
  };

  // Başlangıç saatine göre kategori belirle
  function startCat(row_id, shift_time) {
    // Özel satırlar (saate bakma)
    if (row_id.startsWith('ki_'))       return 'ki';
    if (row_id.startsWith('yl_'))       return 'yillik';
    if (row_id.startsWith('dogum_'))    return 'dogum';
    if (row_id.startsWith('hafizin_'))  return 'izin';
    if (row_id.startsWith('dis_'))      return 'dis';

    // Önce row_meta'daki shift_time, yoksa varsayılan
    const st = (shift_time && shift_time.trim()) ? shift_time : (DEFAULT_START[row_id] || '');
    const m = st.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null; // tanımsız — sayma

    const h = parseInt(m[1]) + parseInt(m[2]) / 60;
    if (h < 1)   return 'gece';       // 00:00
    if (h < 10)  return 'sabah';      // 06:15 – 09:59
    if (h < 12)  return 'gec_gunduz'; // 10:00 – 11:59
    if (h < 15)  return 'prime';      // 12:00 – 14:59
    return 'aksam';                   // 15:00+
  }

  const s = {};
  rows.forEach(r => {
    const cat = startCat(r.row_id, r.shift_time);
    if (!cat) return; // kategorisiz sayma
    if (!s[r.person]) s[r.person] = {sabah:0,gec_gunduz:0,prime:0,aksam:0,gece:0,dis:0,izin:0,yillik:0,dogum:0,ki:0};
    s[r.person][cat] = (s[r.person][cat]||0) + r.cnt;
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


// ── Sodexo ─────────────────────────────────────────────────────────────────
// Dönem: ay 21'den başlar, ertesi ay 20'de biter
function getSodexoPeriod(year, month) {
  // month: 1-12 (hedef ay)
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const start = `${prevYear}-${String(prevMonth).padStart(2,'0')}-21`;
  const end   = `${year}-${String(month).padStart(2,'0')}-20`;
  return { start, end };
}

function getSodexoNights(year, month) {
  const { start, end } = getSodexoPeriod(year, month);
  // Gece nöbeti tutan personel — tm_ ve pcr_ satırlarından 00:00 başlayanlar
  // row_meta'da 00:00 olanlar VEYA gece kategorisi
  const rows = db.prepare(`
    SELECT s.person, w.start_date, w.end_date, s.day_index,
           date(w.start_date, '+' || s.day_index || ' days') as shift_date,
           COALESCE(rm.shift_time, '') as shift_time
    FROM schedule s
    JOIN weeks w ON w.id = s.week_id
    LEFT JOIN row_meta rm ON rm.week_id = s.week_id AND rm.row_id = s.row_id
    WHERE s.person != ''
      AND (s.row_id LIKE 'tm_%' OR s.row_id LIKE 'pcr_%')
      AND date(w.start_date, '+' || s.day_index || ' days') BETWEEN ? AND ?
  `).all(start, end);

  // Gece filtrelemesi: shift_time 00: ile başlıyorsa veya tm_ ve default gece
  const nights = rows.filter(r => {
    const st = r.shift_time || '';
    if (st.startsWith('00:')) return true;
    // tm_ satırları için varsayılan kontrol
    return false;
  });

  // Onay durumları
  const approvals = db.prepare(
    "SELECT person, date, approved, approved_by, approved_at FROM sodexo_approvals WHERE date BETWEEN ? AND ?"
  ).all(start, end);
  const approvalMap = {};
  approvals.forEach(a => { approvalMap[`${a.person}|${a.date}`] = a; });

  return nights.map(n => ({
    ...n,
    approval: approvalMap[`${n.person}|${n.shift_date}`] || null
  }));
}

const setSodexoApproval = (person, date, approved, by) => {
  db.prepare(`INSERT INTO sodexo_approvals(person,date,approved,approved_by,approved_at)
    VALUES(?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(person,date) DO UPDATE SET approved=?,approved_by=?,approved_at=datetime('now','localtime')`)
  .run(person, date, approved?1:0, by||'', approved?1:0, by||'');
};


// ── Snapshot & Değişiklik Takibi ───────────────────────────────────────────
function takeSnapshot(weekId) {
  // Mevcut schedule'ı snapshot'a kopyala
  db.prepare('DELETE FROM schedule_snapshot WHERE week_id=?').run(weekId);
  db.prepare('DELETE FROM row_meta_snapshot WHERE week_id=?').run(weekId);
  db.prepare(`INSERT INTO schedule_snapshot(week_id,row_id,day_index,person)
    SELECT week_id,row_id,day_index,person FROM schedule WHERE week_id=?`).run(weekId);
  db.prepare(`INSERT INTO row_meta_snapshot(week_id,row_id,shift_time)
    SELECT week_id,row_id,shift_time FROM row_meta WHERE week_id=?`).run(weekId);
}

function getChanges(weekId) {
  // Geçersiz row_id'leri temizle
  db.prepare("DELETE FROM schedule_snapshot WHERE week_id=? AND row_id IN ('pcr_4','pcr_5','pcr_6','pcr_7','p1a','tmd')").run(weekId);
  // Mevcut ile snapshot karşılaştır — farklı olan hücreler
  const changed = db.prepare(`
    SELECT s.row_id, s.day_index, s.person as current_person,
           COALESCE(sn.person,'') as snapshot_person
    FROM schedule s
    LEFT JOIN schedule_snapshot sn ON sn.week_id=s.week_id AND sn.row_id=s.row_id AND sn.day_index=s.day_index
    WHERE s.week_id=? AND (s.person != COALESCE(sn.person,'') OR (s.person='' AND sn.person IS NOT NULL AND sn.person!=''))
  `).all(weekId);
  
  // Snapshot'ta olup şimdi olmayan hücreler (silinen)
  const deleted = db.prepare(`
    SELECT sn.row_id, sn.day_index, '' as current_person, sn.person as snapshot_person
    FROM schedule_snapshot sn
    LEFT JOIN schedule s ON s.week_id=sn.week_id AND s.row_id=sn.row_id AND s.day_index=sn.day_index
    WHERE sn.week_id=? AND sn.person!='' AND (s.person IS NULL OR s.person='')
    AND NOT EXISTS (SELECT 1 FROM schedule sc WHERE sc.week_id=sn.week_id AND sc.row_id=sn.row_id AND sc.day_index=sn.day_index AND sc.person!='')
  `).all(weekId);
  
  return [...changed, ...deleted];
}

function hasSnapshot(weekId) {
  const r = db.prepare('SELECT COUNT(*) as cnt FROM schedule_snapshot WHERE week_id=?').get(weekId);
  return r.cnt > 0;
}

function markWeekViewed(weekId, username) {
  db.prepare(`INSERT INTO week_views(week_id,username,viewed_at)
    VALUES(?,?,datetime('now','localtime'))
    ON CONFLICT(week_id,username) DO UPDATE SET viewed_at=datetime('now','localtime')`)
  .run(weekId, username);
}

function hasViewedWeek(weekId, username) {
  const r = db.prepare('SELECT viewed_at FROM week_views WHERE week_id=? AND username=?').get(weekId, username);
  return !!r;
}

function clearWeekViews(weekId) {
  // Yeni yayında görüntüleme sıfırla
  db.prepare('DELETE FROM week_views WHERE week_id=?').run(weekId);
}


function getSnapshotSchedule(weekId) {
  // schedule_snapshot'tan sched objesi oluştur
  const rows = db.prepare(
    'SELECT row_id, day_index, person FROM schedule_snapshot WHERE week_id=?'
  ).all(weekId);
  const sched = {};
  rows.forEach(r => {
    if(!sched[r.row_id]) sched[r.row_id] = Array(7).fill('');
    sched[r.row_id][r.day_index] = r.person || '';
  });
  // row_meta_snapshot'tan meta oluştur
  const metaRows = db.prepare(
    'SELECT row_id, shift_time FROM row_meta_snapshot WHERE week_id=?'
  ).all(weekId);
  const meta = {};
  metaRows.forEach(r => { meta[r.row_id] = r.shift_time; });
  return { sched, meta };
}

function getWeekViewers(weekId) {
  return db.prepare(
    'SELECT username, viewed_at FROM week_views WHERE week_id=? ORDER BY viewed_at DESC'
  ).all(weekId);
}

module.exports = {
  db, getSetting, setSetting,
  getUsers, getUserByUsername, createUser, updateUserPass, deleteUser,
  getWeeks, getPublishedWeeks, getWeek, getWeekByDate, createWeek, lockWeek, unlockWeek, publishWeek, unpublishWeek, draftWeek, deleteWeek,
  getSectionCounts, setSectionCount,
  getRowMeta, setRowMeta,
  getSchedule, upsertCell, getNotes, upsertNote,
  getHolidays, addHoliday, deleteHoliday, isHoliday,
  getBirthdays, addBirthday, deleteBirthday,
  getKiEntries, addKiEntry, deleteKiEntry, getKiSummary,
  getRequests, getRequestById, createRequest, resolveRequest, checkConflict,
  getStats, getYears, takeSnapshot, getChanges, hasSnapshot, markWeekViewed, hasViewedWeek, clearWeekViews, getSodexoPeriod, getSodexoNights, setSodexoApproval,
  getVacationPlans, toggleVacationPlan, deleteVacationPlan, autoPopulateFromPlans
};
