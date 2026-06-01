require('dotenv').config();
const express   = require('express');
const bcrypt    = require('bcryptjs');
const path      = require('path');
const nodemailer= require('nodemailer');
const { sign, requireAuth, requireAdmin } = require('./auth');
const {
  getSetting, setSetting,
  getUsers, getUserByUsername, createUser, updateUserPass, deleteUser,
  getWeeks, getPublishedWeeks, getWeek, getWeekByDate, createWeek, lockWeek, unlockWeek, publishWeek, unpublishWeek, draftWeek, deleteWeek,
  getSectionCounts, setSectionCount, getRowMeta, setRowMeta,
  getSchedule, upsertCell, getNotes, upsertNote,
  getHolidays, addHoliday, deleteHoliday, isHoliday,
  getBirthdays, addBirthday, deleteBirthday,
  getKiEntries, addKiEntry, deleteKiEntry, getKiSummary,
  getVacationPlans, toggleVacationPlan, deleteVacationPlan, autoPopulateFromPlans,
  getRequests, getRequestById, createRequest, resolveRequest, checkConflict,
  getStats, getYears, takeSnapshot, getChanges, hasSnapshot, getSnapshotSchedule, markWeekViewed, hasViewedWeek, clearWeekViews, getWeekViewers,
  getActivePersonnel, setUserActive,
  getSodexoPeriod, getSodexoNights, setSodexoApproval, db
} = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(require('cors')());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname,'public')));

process.on('uncaughtException',  e => console.error('[ERR]', e.message));
process.on('unhandledRejection', e => console.error('[ERR]', e?.message||e));

// ── Mail ─────────────────────────────────────────────────────────────────
async function sendMail(to, subject, html) {
  const user = getSetting('mailUser') || process.env.MAIL_USER;
  const pass = getSetting('mailPass') || process.env.MAIL_PASS;
  if (!user || !pass || !to) return;
  try {
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
    await t.sendMail({ from: user, to, subject, html });
    console.log(`[Mail] Gönderildi → ${to}`);
  } catch(e) { console.error('[Mail]', e.message); }
}

// ── Doğum günü ───────────────────────────────────────────────────────────
function checkBirthdays() {
  const t    = new Date();
  const mmdd = `${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  const mgr  = getSetting('mailTo') || process.env.MAIL_TO;
  if (!mgr) return;
  getBirthdays().filter(b => b.birth_date.slice(5) === mmdd).forEach(b => {
    const age = t.getFullYear() - parseInt(b.birth_date.slice(0,4));
    sendMail(mgr, `🎂 Bugün Doğum Günü: ${b.name}`,
      `<div style="font-family:Arial;font-size:14px"><h2>🎂 ${b.name}</h2>
       <p>Bugün <b>${age}. yaşını</b> kutluyor!${b.note ? ` — ${b.note}` : ''}</p>
       <p>Çizelgede <b>Doğum Günü İzni</b> satırına +1 gün eklemeyi unutmayın.</p></div>`);
  });
}
checkBirthdays();
setInterval(() => { const n=new Date(); if(n.getHours()===9&&n.getMinutes()===0) checkBirthdays(); }, 60000);

// ── Hafta yardımcısı — tarihe göre hafta bul veya oluştur ──────────────
function findOrCreateWeek(dateStr) {
  let week = getWeekByDate(dateStr);
  if (week) return week;
  // Tarihin pazartesisi ve pazar gününü bul
  const d    = new Date(dateStr);
  const dow  = (d.getDay() + 6) % 7; // 0=Pzt
  const pzt  = new Date(d); pzt.setDate(d.getDate() - dow);
  const paz  = new Date(pzt); paz.setDate(pzt.getDate() + 6);
  const fmt  = x => x.toISOString().slice(0,10);
  const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const tr   = x => `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
  const label = `${tr(pzt)} – ${tr(paz)}`;
  const r    = createWeek(label, fmt(pzt), fmt(paz), pzt.getFullYear());
  return getWeek(r.lastInsertRowid);
}

// ── AUTH ─────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req,res) => {
  const { username, password } = req.body;
  if (!username||!password) return res.status(400).json({error:'Eksik'});
  const u = getUserByUsername(username.trim().toLowerCase());
  if (!u) return res.status(401).json({error:'Kullanıcı bulunamadı'});
  if (!await bcrypt.compare(password, u.password_hash)) return res.status(401).json({error:'Şifre hatalı'});
  res.json({ token: sign({id:u.id,role:u.role,name:u.full_name,username:u.username}), role:u.role, name:u.full_name });
});
app.get('/api/auth/me', requireAuth, (req,res) => res.json(req.user));
app.post('/api/auth/change-password', requireAuth, async (req,res) => {
  const { oldPass, newPass } = req.body;
  if (!oldPass||!newPass||newPass.length<4) return res.status(400).json({error:'Geçersiz'});
  const u = getUserByUsername(req.user.username);
  if (!u || !await bcrypt.compare(oldPass, u.password_hash)) return res.status(401).json({error:'Mevcut şifre hatalı'});
  updateUserPass(u.id, bcrypt.hashSync(newPass,10));
  res.json({ok:true});
});

// ── KULLANICILAR ─────────────────────────────────────────────────────────
app.get('/api/personnel', requireAuth, (req,res) => res.json(getActivePersonnel()));

app.get('/api/users', requireAdmin, (req,res) => res.json(getUsers()));
app.post('/api/users', requireAdmin, async (req,res) => {
  const { username, password, full_name, role } = req.body;
  if (!username||!password||!full_name) return res.status(400).json({error:'Eksik'});
  if (getUserByUsername(username.toLowerCase())) return res.status(409).json({error:'Kullanıcı adı zaten var'});
  const r = createUser(username.toLowerCase().trim(), await bcrypt.hash(password,10), full_name.trim(), role||'user');
  res.json({id:r.lastInsertRowid,ok:true});
});
app.put('/api/users/:id/password', requireAdmin, async (req,res) => {
  const { password } = req.body;
  if (!password||password.length<4) return res.status(400).json({error:'En az 4 karakter'});
  updateUserPass(req.params.id, await bcrypt.hash(password,10));
  res.json({ok:true});
});
app.patch('/api/users/:id/active', requireAdmin, (req,res) => {
  const {active} = req.body;
  setUserActive(req.params.id, active);
  res.json({ok:true});
});

app.delete('/api/users/:id', requireAdmin, (req,res) => {
  if (parseInt(req.params.id)===req.user.id) return res.status(400).json({error:'Kendinizi silemezsiniz'});
  // En az 1 admin kalsın
  const target = db.prepare('SELECT role FROM users WHERE id=?').get(req.params.id);
  if (target && target.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
    if (adminCount <= 1) return res.status(400).json({error:'Son yönetici silinemez. Önce başka bir yönetici ekleyin.'});
  }
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

// ── HAFTALAR ─────────────────────────────────────────────────────────────
app.get('/api/weeks', requireAuth, (req,res) => {
  if (req.user.role === 'admin') return res.json(getWeeks());
  res.json(getPublishedWeeks());
});
app.post('/api/weeks', requireAdmin, (req,res) => {
  const { label, start_date, end_date } = req.body;
  if (!label||!start_date||!end_date) return res.status(400).json({error:'Eksik'});
  const r = createWeek(label, start_date, end_date, parseInt(start_date.slice(0,4)));
  const weekId = r.lastInsertRowid;
  // Yıllık planlardan otomatik doldur
  const autoCount = autoPopulateFromPlans(weekId, start_date, end_date);
  if (autoCount > 0) console.log(`[Auto] ${autoCount} kişi yıllık plandan eklendi → hafta ${weekId}`);
  res.json({ id: weekId, label, start_date, end_date, auto_populated: autoCount });
});
app.patch('/api/weeks/:id/lock',    requireAdmin, (req,res) => { lockWeek(req.params.id);     res.json({ok:true}); });
app.patch('/api/weeks/:id/publish', requireAdmin, (req,res) => {
  const id = req.params.id;
  publishWeek(id);
  lockWeek(id);
  clearWeekViews(id); // Personelin "gördü" işaretini sıfırla (snapshot değişmez)
  res.json({ok:true});
});
app.patch('/api/weeks/:id/unpublish',requireAdmin, (req,res) => { unpublishWeek(req.params.id); res.json({ok:true}); });
app.patch('/api/weeks/:id/draft', requireAdmin, (req,res) => {
  const id = req.params.id;
  takeSnapshot(id);  // Değişiklik öncesi hali kaydet
  draftWeek(id);
  unlockWeek(id);
  res.json({ok:true});
});
app.patch('/api/weeks/:id/unlock', requireAdmin, (req,res) => { unlockWeek(req.params.id); res.json({ok:true}); });
app.delete('/api/weeks/:id',       requireAdmin, (req,res) => { deleteWeek(req.params.id); res.json({ok:true}); });

// ── SECTION COUNTS (dinamik satırlar) ─────────────────────────────────────
app.get('/api/weeks/:id/sections', requireAuth, (req,res) => res.json(getSectionCounts(req.params.id)));
app.put('/api/weeks/:id/sections', requireAdmin, (req,res) => {
  const { section, count } = req.body;
  setSectionCount(req.params.id, section, count);
  res.json({ok:true});
});

// ── ÇİZELGE ──────────────────────────────────────────────────────────────
app.get('/api/schedule/:weekId', requireAuth, (req,res) => {
  const weekId = req.params.weekId;
  const w = getWeek(weekId);

  // Draft modda personele snapshot göster (eski yayınlanmış hali)
  if(w && w.draft_mode && req.user.role !== 'admin' && hasSnapshot(weekId)){
    const snap = getSnapshotSchedule(weekId);
    const nts = getNotes(weekId);
    const na = [Array(7).fill(''),Array(7).fill('')];
    nts.forEach(n => { na[n.note_index][n.day_index]=n.content; });
    return res.json({ sched: snap.sched, notes: na, meta: snap.meta });
  }

  const rows    = getSchedule(weekId);
  const nts     = getNotes(weekId);
  const metaRows= getRowMeta(weekId);
  const sched = {};
  rows.forEach(r => { if(!sched[r.row_id])sched[r.row_id]=Array(7).fill(''); sched[r.row_id][r.day_index]=r.person; });
  const na = [Array(7).fill(''),Array(7).fill('')];
  nts.forEach(n => { na[n.note_index][n.day_index]=n.content; });
  const meta = {};
  metaRows.forEach(m => { meta[m.row_id]=m.shift_time; });
  res.json({ sched, notes: na, meta });
});
app.put('/api/schedule/:weekId/cell', requireAdmin, (req,res) => {
  const w = getWeek(req.params.weekId);
  if (!w) return res.status(404).json({error:'Hafta yok'});
  if (w.locked && !w.draft_mode) return res.status(403).json({error:'Kilitli'});
  upsertCell(req.params.weekId, req.body.row_id, req.body.day_index, req.body.person||'');
  res.json({ok:true});
});
app.put('/api/schedule/:weekId/note', requireAdmin, (req,res) => {
  upsertNote(req.params.weekId, req.body.note_index, req.body.day_index, req.body.content||'');
  res.json({ok:true});
});
app.put('/api/schedule/:weekId/rowmeta', requireAdmin, (req,res) => {
  setRowMeta(req.params.weekId, req.body.row_id, req.body.shift_time||'');
  res.json({ok:true});
});

// ── TATİLLER ─────────────────────────────────────────────────────────────
app.get('/api/holidays', requireAuth, (req,res) => res.json(getHolidays(req.query.year ? parseInt(req.query.year) : null)));
app.post('/api/holidays', requireAdmin, (req,res) => {
  const { date, name } = req.body;
  if (!date||!name) return res.status(400).json({error:'Eksik'});
  addHoliday(date, name);
  res.json({ok:true});
});
app.delete('/api/holidays/:id', requireAdmin, (req,res) => { deleteHoliday(req.params.id); res.json({ok:true}); });

// ── DOĞUM GÜNLERİ ────────────────────────────────────────────────────────
app.get('/api/birthdays', requireAuth, (req,res) => {
  // Sadece admin tam listeyi görür, user kendi doğum gününü göremez zaten
  if (req.user.role !== 'admin') return res.json([]);
  const t=new Date(), mmdd=`${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  const list=getBirthdays().map(b=>{
    const bm=b.birth_date.slice(5),ny=new Date(`${t.getFullYear()}-${bm}`);
    if(ny<t)ny.setFullYear(t.getFullYear()+1);
    return{...b,isToday:bm===mmdd,age:t.getFullYear()-parseInt(b.birth_date.slice(0,4)),daysLeft:Math.ceil((ny-t)/86400000)};
  }).sort((a,b)=>a.daysLeft-b.daysLeft);
  res.json(list);
});
app.post('/api/birthdays', requireAdmin, (req,res) => {
  if(!req.body.name||!req.body.birth_date) return res.status(400).json({error:'Eksik'});
  const r=addBirthday(req.body.name,req.body.birth_date,req.body.note||'');
  res.json({id:r.lastInsertRowid});
});
app.delete('/api/birthdays/:id', requireAdmin, (req,res) => { deleteBirthday(req.params.id); res.json({ok:true}); });

// ── K.İ ──────────────────────────────────────────────────────────────────
app.get('/api/ki', requireAuth, (req,res) => {
  const summary = getKiSummary();
  // User sadece kendi K.İ bakiyesini görür
  if (req.user.role !== 'admin') {
    const own = summary.find(k => k.person === req.user.name);
    return res.json(own ? [own] : []);
  }
  res.json(summary);
});
app.post('/api/ki', requireAdmin, async (req,res) => {
  const { person, days, reason, date_given, notify_email, week_id } = req.body;
  if (!person||!days) return res.status(400).json({error:'Eksik'});
  addKiEntry(person, parseFloat(days), reason, date_given, week_id);
  if (notify_email) {
    await sendMail(notify_email, `📋 K.İ Hakkı Tanımlandı — ${person}`,
      `<div style="font-family:Arial;font-size:14px"><h2>📋 Kullanılmayan İzin</h2>
       <p>Merhaba <b>${person}</b>, hesabınıza <b>${days} gün</b> K.İ tanımlandı.</p>
       ${reason?`<p>Açıklama: ${reason}</p>`:''}
       <p>Tarih: ${date_given||new Date().toISOString().slice(0,10)}</p></div>`);
  }
  res.json({ok:true});
});
app.delete('/api/ki/:id', requireAdmin, (req,res) => { deleteKiEntry(req.params.id); res.json({ok:true}); });

// ── VARDİYA TALEPLERİ ────────────────────────────────────────────────────
const DAY_NAMES = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];

app.get('/api/requests', requireAuth, (req,res) => res.json(getRequests(req.query.status,req.user.id,req.user.role)));

app.post('/api/requests', requireAuth, (req,res) => {
  const { day_text, day_index, shift_text, row_id, note, date_str } = req.body;
  if (!day_text||!shift_text) return res.status(400).json({error:'Eksik'});
  const person = req.user.name;

  // Haftayı bul veya oluştur
  let weekId = null;
  if (date_str) {
    const week = findOrCreateWeek(date_str);
    weekId = week?.id || null;
  }

  if (weekId && row_id && day_index >= 0) {
    const c = checkConflict(weekId, parseInt(day_index), row_id);
    if (c) return res.json({ok:false,conflict:true,reason:`Bu gün ve saat için ${c.person} zaten onaylı.`});
  }

  const r = createRequest({ person, user_id:req.user.id, day_text, day_index:parseInt(day_index??-1), shift_text, row_id:row_id||'', note, week_id:weekId, needs_approval:0 });
  res.json({id:r.lastInsertRowid,ok:true,week_id:weekId});
});

app.post('/api/requests/:id/resolve', requireAdmin, (req,res) => {
  const { status, reject_reason, week_id, row_id, day_index } = req.body;
  const rq = getRequestById(req.params.id);
  if (!rq) return res.status(404).json({error:'Bulunamadı'});
  if (status==='approved' && week_id && row_id && day_index!==undefined) {
    const c = checkConflict(week_id, parseInt(day_index), row_id);
    if (c && c.person!==rq.person) return res.json({ok:false,conflict:true,reason:`${c.person} zaten onaylı.`});
    upsertCell(week_id, row_id, parseInt(day_index), rq.person);
  }
  resolveRequest(req.params.id, status, reject_reason||'', req.user.name);
  res.json({ok:true});
});

app.delete('/api/requests/:id', requireAdmin, (req,res) => {
  db.prepare('DELETE FROM shift_requests WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

// ── AYARLAR ──────────────────────────────────────────────────────────────
app.get('/api/settings', requireAdmin, (req,res) => res.json({
  mailUser: getSetting('mailUser')||'',
  mailTo:   getSetting('mailTo')||'',
  mailPass: getSetting('mailPass')?'••••••••':'',
}));
app.post('/api/settings', requireAdmin, (req,res) => {
  const { mailUser, mailTo, mailPass } = req.body;
  if (mailUser!==undefined) setSetting('mailUser',mailUser);
  if (mailTo!==undefined)   setSetting('mailTo',mailTo);
  if (mailPass&&mailPass!=='••••••••') setSetting('mailPass',mailPass);
  res.json({ok:true});
});
app.post('/api/settings/test-mail', requireAdmin, async (req,res) => {
  const to = getSetting('mailTo')||process.env.MAIL_TO;
  if (!to) return res.json({ok:false,error:'Alıcı mail girilmemiş'});
  await sendMail(to,'✅ Test Maili','<h2>✅ Bağlantı başarılı!</h2>');
  res.json({ok:true});
});

// ── VERİ YEDEK (JSON indirme) ─────────────────────────────────────────────
app.get('/api/backup', requireAdmin, (req,res) => {
  try {
    const weeks  = getWeeks();
    const backup = { exportDate: new Date().toISOString(), weeks: [] };
    weeks.forEach(w => {
      try {
        const sched  = getSchedule(w.id);
        const nts    = getNotes(w.id);
        const meta   = getRowMeta(w.id);
        const counts = getSectionCounts(w.id);
        backup.weeks.push({ ...w, sched, notes: nts, meta, counts });
      } catch(e) { backup.weeks.push({ ...w, error: e.message }); }
    });
    try { backup.ki = getKiSummary().map(k => ({ person:k.person, entries:k.entries })); } catch(e) { backup.ki = []; }
    try { backup.birthdays = getBirthdays(); } catch(e) { backup.birthdays = []; }
    try { backup.holidays  = getHolidays();  } catch(e) { backup.holidays  = []; }
    const fname = 'nobet-yedek-' + new Date().toISOString().slice(0,10) + '.json';
    res.setHeader('Content-Disposition', 'attachment; filename=' + fname);
    res.json(backup);
  } catch(e) {
    console.error('[Backup]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── İSTATİSTİK ───────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, (req,res) => res.json(getStats(req.query.year?parseInt(req.query.year):null)));

// Debug: personelin schedule kayıtlarını göster
app.get('/api/debug/person/:name', requireAdmin, (req,res) => {
  const person = decodeURIComponent(req.params.name);
  const rows = db.prepare(`
    SELECT s.week_id, s.row_id, s.day_index, s.person,
           COALESCE(rm.shift_time,'(yok)') as shift_time,
           w.label as week_label
    FROM schedule s
    LEFT JOIN row_meta rm ON rm.week_id=s.week_id AND rm.row_id=s.row_id
    LEFT JOIN weeks w ON w.id=s.week_id
    WHERE s.person=? AND s.person!=''
    ORDER BY s.week_id, s.row_id, s.day_index
  `).all(person);
  res.json(rows);
});
app.get('/api/years', requireAuth, (req,res) => res.json(getYears()));
app.get('/api/ki/summary', requireAuth, (req,res) => {
  const s = getKiSummary();
  if (req.user.role !== 'admin') return res.json(s.filter(k=>k.person===req.user.name));
  res.json(s);
});


// ── YILLIK PLANLAMA ───────────────────────────────────────────────────────
app.get('/api/vacation-plans', requireAuth, (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  res.json(getVacationPlans(year));
});

app.post('/api/vacation-plans', requireAuth, (req, res) => {
  const { week_start, type } = req.body;
  if (!week_start) return res.status(400).json({ error: 'Eksik' });
  const person = req.user.name;
  const result = toggleVacationPlan(person, week_start, type || 'yillik');
  res.json({ ok: true, ...result });
});

// Admin: başkası adına ekle/çıkar
app.post('/api/vacation-plans/admin', requireAdmin, (req, res) => {
  const { person, week_start, type } = req.body;
  if (!person || !week_start) return res.status(400).json({ error: 'Eksik' });
  const result = toggleVacationPlan(person, week_start, type || 'yillik');
  res.json({ ok: true, ...result });
});

app.delete('/api/vacation-plans/:id', requireAdmin, (req, res) => {
  deleteVacationPlan(req.params.id);
  res.json({ ok: true });
});

// Belirli bir haftanın planlarını getir
app.get('/api/vacation-plans/week', requireAuth, (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.json([]);
  const plans = require('./database').db
    .prepare('SELECT * FROM vacation_plans WHERE week_start >= ? AND week_start <= ?')
    .all(start, end);
  res.json(plans);
});




// ── Değişiklik & Görüntüleme ──────────────────────────────────────────────
app.get('/api/weeks/:id/changes', requireAuth, (req,res) => {
  const weekId = req.params.id;
  const w = getWeek(weekId);
  if(!w) return res.status(404).json({error:'Hafta yok'});
  if(req.user.role !== 'admin' && !w.published) return res.json([]);
  // Personel sadece draft_mode=0 iken (yeni yayınlanmış) değişiklikleri görür
  if(req.user.role !== 'admin' && w.draft_mode) return res.json([]);
  if(req.user.role !== 'admin' && !req.query.force && hasViewedWeek(weekId, req.user.username)) return res.json([]);
  const snap = hasSnapshot(weekId);
  const changes = getChanges(weekId);
  if(req.query.debug) {
    // Raw data for debugging
    const snapRows = db.prepare('SELECT * FROM schedule_snapshot WHERE week_id=? LIMIT 5').all(weekId);
    const schedRows = db.prepare('SELECT * FROM schedule WHERE week_id=? AND person!=? LIMIT 5').all(weekId,'');
    return res.json({hasSnapshot:snap, changes, weekId, role:req.user.role, snapSample:snapRows, schedSample:schedRows});
  }
  res.json(changes);
});

app.post('/api/weeks/:id/view', requireAuth, (req,res) => {
  markWeekViewed(req.params.id, req.user.username);
  res.json({ok:true});
});



// Kim gördü?
app.get('/api/weeks/:id/viewers', requireAdmin, (req,res) => {
  const viewers = getWeekViewers(req.params.id);
  res.json(viewers);
});


// ── Talep İstatistikleri ──────────────────────────────────────────────────
app.get('/api/request-stats', requireAdmin, (req,res) => {
  const year  = req.query.year  ? parseInt(req.query.year)  : null;
  const month = req.query.month ? parseInt(req.query.month) : null;

  let where = "WHERE 1=1";
  const params = [];
  if(year){
    where += " AND strftime('%Y', created_at) = ?";
    params.push(String(year));
  }
  if(month){
    where += " AND strftime('%m', created_at) = ?";
    params.push(String(month).padStart(2,'0'));
  }

  // Genel özet
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) as pending
    FROM shift_requests ${where}
  `).get(...params);

  // Personel bazlı
  const byPerson = db.prepare(`
    SELECT person,
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) as pending
    FROM shift_requests ${where}
    GROUP BY person ORDER BY total DESC
  `).all(...params);

  // En çok istenen vardiyalar
  const byShift = db.prepare(`
    SELECT shift_text,
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved
    FROM shift_requests ${where}
    GROUP BY shift_text ORDER BY total DESC LIMIT 10
  `).all(...params);

  // Aylık trend (son 12 ay)
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', created_at) as month,
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved
    FROM shift_requests
    GROUP BY month ORDER BY month DESC LIMIT 12
  `).all();

  res.json({ summary, byPerson, byShift, monthly });
});

// ── SODEXO ───────────────────────────────────────────────────────────────
app.get('/api/sodexo', requireAdmin, (req, res) => {
  const year  = parseInt(req.query.year)  || new Date().getFullYear();
  const month = parseInt(req.query.month) || new Date().getMonth() + 1;
  const nights = getSodexoNights(year, month);
  const period = getSodexoPeriod(year, month);
  res.json({ nights, period });
});

app.post('/api/sodexo/approve', requireAdmin, (req, res) => {
  const { person, date, approved } = req.body;
  if (!person || !date) return res.status(400).json({ error: 'Eksik' });
  setSodexoApproval(person, date, approved, req.user.name);
  res.json({ ok: true });
});


app.listen(PORT, () => console.log(`\n✅  Nöbet Çizelgesi → http://localhost:${PORT}\n`));
