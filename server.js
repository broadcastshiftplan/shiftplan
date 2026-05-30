require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const {
  getSetting, setSetting,
  getWeeks, getWeek, createWeek, lockWeek, deleteWeek,
  getSchedule, upsertCell,
  getNotes, upsertNote,
  getWaRequests, createWaRequest, resolveWaRequest,
  getCumulativeStats
} = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════
//  HAFTALAR
// ════════════════════════════════════════════════
app.get('/api/weeks', (req, res) => {
  res.json(getWeeks());
});

app.post('/api/weeks', (req, res) => {
  const { label, start_date, end_date } = req.body;
  if (!label || !start_date || !end_date) return res.status(400).json({ error: 'Eksik alan' });
  const year = parseInt(start_date.slice(0, 4));
  const result = createWeek(label, start_date, end_date, year);
  res.json({ id: result.lastInsertRowid, label, start_date, end_date, year });
});

app.patch('/api/weeks/:id/lock', (req, res) => {
  lockWeek(req.params.id);
  res.json({ ok: true });
});

app.delete('/api/weeks/:id', (req, res) => {
  deleteWeek(req.params.id);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
//  ÇİZELGE
// ════════════════════════════════════════════════
app.get('/api/schedule/:weekId', (req, res) => {
  const rows  = getSchedule(req.params.weekId);
  const notes = getNotes(req.params.weekId);
  // Flatten to {rowId: [7 cells]}
  const sched = {};
  rows.forEach(r => {
    if (!sched[r.row_id]) sched[r.row_id] = Array(7).fill('');
    sched[r.row_id][r.day_index] = r.person;
  });
  const notesArr = [Array(7).fill(''), Array(7).fill('')];
  notes.forEach(n => {
    notesArr[n.note_index][n.day_index] = n.content;
  });
  res.json({ sched, notes: notesArr });
});

app.put('/api/schedule/:weekId/cell', (req, res) => {
  const { row_id, day_index, person } = req.body;
  const week = getWeek(req.params.weekId);
  if (!week) return res.status(404).json({ error: 'Hafta bulunamadı' });
  if (week.locked) return res.status(403).json({ error: 'Bu hafta kilitli' });
  upsertCell(req.params.weekId, row_id, day_index, person || '');
  res.json({ ok: true });
});

app.put('/api/schedule/:weekId/note', (req, res) => {
  const { note_index, day_index, content } = req.body;
  upsertNote(req.params.weekId, note_index, day_index, content || '');
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
//  AYARLAR
// ════════════════════════════════════════════════
app.get('/api/settings', (req, res) => {
  res.json({
    waNumber:   getSetting('waNumber')   || '',
    waTemplate: getSetting('waTemplate') || 'TALEP {GÜN} {SAAT} vardiyasını almak istiyorum.',
    webhook:    getSetting('webhook')    || '',
    ngrokUrl:   getSetting('ngrokUrl')   || '',
  });
});

app.post('/api/settings', (req, res) => {
  const { waNumber, waTemplate, webhook, ngrokUrl } = req.body;
  if (waNumber   !== undefined) setSetting('waNumber',   waNumber);
  if (waTemplate !== undefined) setSetting('waTemplate', waTemplate);
  if (webhook    !== undefined) setSetting('webhook',    webhook);
  if (ngrokUrl   !== undefined) setSetting('ngrokUrl',   ngrokUrl);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════
//  WHATSAPP WEBHOOK (Twilio)
// ════════════════════════════════════════════════
const PERSONEL = [
  "Alpcan ŞİŞMAN","Doğuhan DEMİROK","Evren KARA","İlyas GÜNEŞ",
  "Özgür YENİAY","Özkan AYTEN","Mustafa ALTAŞ","Melih MEMİŞLER",
  "Yusuf YİĞİT","Tolga KANOĞLU","Yağız GÜVEN"
];
const GUN_MAP = {
  'pazartesi':0,'pzt':0,'pt':0,
  'salı':1,'sal':1,'salı':1,
  'çarşamba':2,'çar':2,'carsamba':2,
  'perşembe':3,'per':3,'persembe':3,
  'cuma':4,'cum':4,
  'cumartesi':5,'cmt':5,'cuma':4,
  'pazar':6,'paz':6
};
const SHIFT_MAP = {
  'sabah':'06:15 – 15:15','gece':'00:00 – 06:30',
  'araçı':'12:00 – 20:00','araci':'12:00 – 20:00',
  'akşam':'15:00 – 00:00','aksam':'15:00 – 00:00',
  'pcr':'06:15 – 15:15','pcr1':'06:15 – 15:15','pcr3':'08:00 – 17:00',
  'teknik':'10:00 – 17:00','ölçü':'08:00 – 17:00','olcu':'08:00 – 17:00',
};

function parseWaMessage(body) {
  const text = (body || '').toLowerCase().trim();
  if (!text.startsWith('talep')) return null;

  // Gün bul
  let dayIdx = -1;
  for (const [k, v] of Object.entries(GUN_MAP)) {
    if (text.includes(k)) { dayIdx = v; break; }
  }

  // Vardiya bul
  let shiftStr = '';
  for (const [k, v] of Object.entries(SHIFT_MAP)) {
    if (text.includes(k)) { shiftStr = v; break; }
  }
  if (!shiftStr) {
    // saat formatı: 06:15-15:15
    const m = text.match(/(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/);
    if (m) shiftStr = `${m[1]} – ${m[2]}`;
  }

  return { dayIdx, shiftStr };
}

app.post('/webhook/whatsapp', (req, res) => {
  const from    = req.body.From  || '';
  const msgBody = req.body.Body  || '';

  const parsed = parseWaMessage(msgBody);
  if (!parsed) {
    // Bilinmeyen mesaj — yoksay, boş TwiML dön
    return res.set('Content-Type', 'text/xml').send(`<Response><Message>Anlaşılamadı. Format: TALEP CUMA SABAH</Message></Response>`);
  }

  // En son hafta
  const weeks = getWeeks();
  const activeWeek = weeks.find(w => !w.locked) || weeks[0];
  const weekId = activeWeek ? activeWeek.id : null;

  // Numara → personel eşleşmesi (ayarlarda saklanabilir, şimdilik numara yeterli)
  const reqId = createWaRequest({
    from_number: from,
    raw_message: msgBody,
    person_name: from, // ileride numara→isim mapping eklenebilir
    day_text:    ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'][parsed.dayIdx] || '?',
    shift_text:  parsed.shiftStr || '?',
    week_id:     weekId,
  });

  // Yöneticiye bildir
  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const managerNum = getSetting('waNumber') || process.env.MANAGER_WHATSAPP;
      if (managerNum) {
        twilio.messages.create({
          from: process.env.TWILIO_WHATSAPP_FROM,
          to:   managerNum.startsWith('whatsapp:') ? managerNum : `whatsapp:${managerNum}`,
          body: `📋 YENİ TALEP\n👤 ${from}\n📅 ${['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'][parsed.dayIdx]||'?'}\n⏰ ${parsed.shiftStr||'?'}\n\nTalep #${reqId.lastInsertRowid} — Uygulamadan onaylayın.`
        }).catch(e => console.error('Twilio notify error:', e.message));
      }
    }
  } catch(e) { console.error('Twilio init error:', e.message); }

  res.set('Content-Type', 'text/xml').send(`<Response><Message>Talebiniz alındı! Yönetici onayladığında bildirim gelecek.</Message></Response>`);
});

// WA talepleri listele
app.get('/api/wa-requests', (req, res) => {
  res.json(getWaRequests(req.query.status));
});

// WA talebini onayla/reddet
app.post('/api/wa-requests/:id/resolve', (req, res) => {
  const { status, row_id, day_index, week_id } = req.body; // status: approved|rejected
  const reqRow = getWaRequests().find(r => r.id == req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'Talep bulunamadı' });

  resolveWaRequest(req.params.id, status, row_id || null, day_index ?? null);

  if (status === 'approved' && row_id !== undefined && day_index !== undefined && week_id) {
    upsertCell(week_id, row_id, day_index, reqRow.person_name);
  }

  // Talep sahibine bildirim
  try {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const toNum = reqRow.from_number.startsWith('whatsapp:') ? reqRow.from_number : `whatsapp:${reqRow.from_number}`;
      const msg = status === 'approved'
        ? `✅ Nöbet talebiniz ONAYLANDI!\n📅 ${reqRow.day_text} — ${reqRow.shift_text}`
        : `❌ Nöbet talebiniz reddedildi.\n📅 ${reqRow.day_text} — ${reqRow.shift_text}`;
      twilio.messages.create({ from: process.env.TWILIO_WHATSAPP_FROM, to: toNum, body: msg })
        .catch(e => console.error('Notify error:', e.message));
    }
  } catch(e) {}

  res.json({ ok: true });
});

// ════════════════════════════════════════════════
//  KÜMÜLATİF İSTATİSTİK
// ════════════════════════════════════════════════
app.get('/api/stats', (req, res) => {
  const year = req.query.year ? parseInt(req.query.year) : null;
  res.json(getCumulativeStats(year));
});

// Mevcut yılları listele
app.get('/api/years', (req, res) => {
  const { db } = require('./database');
  const years = db.prepare('SELECT DISTINCT year FROM weeks ORDER BY year DESC').all().map(r => r.year);
  res.json(years);
});

// ════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n✅ Nöbet Çizelgesi çalışıyor → http://localhost:${PORT}`);
  console.log(`📱 WhatsApp Webhook → http://localhost:${PORT}/webhook/whatsapp`);
  console.log(`   (Twilio için ngrok veya public URL gereklidir)\n`);
});
