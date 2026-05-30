require('dotenv').config();
const express  = require('express');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const nodemailer= require('nodemailer');
const { sign, requireAuth, requireAdmin } = require('./auth');
const {
  getSetting, setSetting,
  getUsers, getUserByUsername, createUser, updateUserPass, deleteUser, getUserCount,
  getWeeks, getWeek, createWeek, lockWeek, deleteWeek,
  getSchedule, upsertCell, getNotes, upsertNote,
  getBirthdays, addBirthday, deleteBirthday,
  getRequests, getRequestById, createRequest, resolveRequest, checkConflict,
  getKiEntries, addKiEntry, deleteKiEntry, getKiSummary,
  getStats, getYears
} = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(require('cors')());
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
process.on('uncaughtException',  e => console.error('[ERR]',e.message));
process.on('unhandledRejection', e => console.error('[ERR]',e?.message||e));

// ── Mail (sadece doğum günü bildirimi için, opsiyonel) ───────────────────────
async function sendMail(to,subject,html){
  const user=getSetting('mailUser')||process.env.MAIL_USER;
  const pass=getSetting('mailPass')||process.env.MAIL_PASS;
  if(!user||!pass||!to)return;
  try{
    const t=nodemailer.createTransport({service:'gmail',auth:{user,pass}});
    await t.sendMail({from:user,to,subject,html});
  }catch(e){console.error('[Mail]',e.message);}
}

// ── Doğum günü kontrolü ──────────────────────────────────────────────────────
function checkBirthdays(){
  const t=new Date(), mmdd=`${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  const mgr=getSetting('mailTo')||process.env.MAIL_TO;
  if(!mgr)return;
  getBirthdays().filter(b=>b.birth_date.slice(5)===mmdd).forEach(b=>{
    const age=t.getFullYear()-parseInt(b.birth_date.slice(0,4));
    sendMail(mgr,`🎂 Bugün Doğum Günü: ${b.name}`,
      `<div style="font-family:Arial;font-size:14px"><h2>🎂 ${b.name}</h2>
       <p>Bugün <b>${age}. yaşını</b> kutluyor!${b.note?` — ${b.note}`:''}</p>
       <p>Çizelgede <b>Doğum İzni</b> satırına +1 gün ekleyin.</p></div>`);
  });
}
checkBirthdays();
setInterval(()=>{ const n=new Date(); if(n.getHours()===9&&n.getMinutes()===0)checkBirthdays(); },60000);

// ══════════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/auth/login', async(req,res)=>{
  const{username,password}=req.body;
  if(!username||!password)return res.status(400).json({error:'Eksik'});
  const u=getUserByUsername(username.trim().toLowerCase());
  if(!u)return res.status(401).json({error:'Kullanıcı bulunamadı'});
  const ok=await bcrypt.compare(password,u.password_hash);
  if(!ok)return res.status(401).json({error:'Şifre hatalı'});
  res.json({token:sign({id:u.id,role:u.role,name:u.full_name,username:u.username}),role:u.role,name:u.full_name});
});

app.get('/api/auth/me', requireAuth, (req,res)=>res.json(req.user));

app.post('/api/auth/change-password', requireAuth, async(req,res)=>{
  const{oldPass,newPass}=req.body;
  if(!oldPass||!newPass||newPass.length<4)return res.status(400).json({error:'Geçersiz şifre'});
  const u=getUserByUsername(req.user.username);
  if(!u||!await bcrypt.compare(oldPass,u.password_hash))return res.status(401).json({error:'Mevcut şifre hatalı'});
  updateUserPass(u.id,bcrypt.hashSync(newPass,10));
  res.json({ok:true});
});

// ══════════════════════════════════════════════════════════════════════════════
// KULLANICI YÖNETİMİ (admin only)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/users', requireAdmin, (req,res)=>res.json(getUsers()));

app.post('/api/users', requireAdmin, async(req,res)=>{
  const{username,password,full_name,role}=req.body;
  if(!username||!password||!full_name)return res.status(400).json({error:'Eksik alan'});
  if(getUserByUsername(username.toLowerCase()))return res.status(409).json({error:'Kullanıcı adı zaten var'});
  const hash=await bcrypt.hash(password,10);
  const r=createUser(username.toLowerCase().trim(),hash,full_name.trim(),role||'user');
  res.json({id:r.lastInsertRowid,ok:true});
});

app.put('/api/users/:id/password', requireAdmin, async(req,res)=>{
  const{password}=req.body;
  if(!password||password.length<4)return res.status(400).json({error:'Şifre en az 4 karakter olmalı'});
  updateUserPass(req.params.id,await bcrypt.hash(password,10));
  res.json({ok:true});
});

app.delete('/api/users/:id', requireAdmin, (req,res)=>{
  if(parseInt(req.params.id)===req.user.id)return res.status(400).json({error:'Kendinizi silemezsiniz'});
  require('./database').db.prepare('DELETE FROM users WHERE id=? AND role!=?').run(req.params.id,'admin');
  res.json({ok:true});
});

// ══════════════════════════════════════════════════════════════════════════════
// HAFTALAR
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/weeks',            requireAuth,  (req,res)=>res.json(getWeeks()));
app.post('/api/weeks',           requireAdmin, (req,res)=>{
  const{label,start_date,end_date}=req.body;
  if(!label||!start_date||!end_date)return res.status(400).json({error:'Eksik'});
  const r=createWeek(label,start_date,end_date,parseInt(start_date.slice(0,4)));
  res.json({id:r.lastInsertRowid,label,start_date,end_date});
});
app.patch('/api/weeks/:id/lock', requireAdmin, (req,res)=>{lockWeek(req.params.id);res.json({ok:true});});
app.delete('/api/weeks/:id',     requireAdmin, (req,res)=>{deleteWeek(req.params.id);res.json({ok:true});});

// ══════════════════════════════════════════════════════════════════════════════
// ÇİZELGE
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/schedule/:weekId', requireAuth, (req,res)=>{
  const rows=getSchedule(req.params.weekId),nts=getNotes(req.params.weekId);
  const sched={};
  rows.forEach(r=>{if(!sched[r.row_id])sched[r.row_id]=Array(7).fill('');sched[r.row_id][r.day_index]=r.person;});
  const na=[Array(7).fill(''),Array(7).fill('')];
  nts.forEach(n=>{na[n.note_index][n.day_index]=n.content;});
  res.json({sched,notes:na});
});
app.put('/api/schedule/:weekId/cell', requireAdmin, (req,res)=>{
  const w=getWeek(req.params.weekId);
  if(!w)return res.status(404).json({error:'Hafta yok'});
  if(w.locked)return res.status(403).json({error:'Kilitli'});
  upsertCell(req.params.weekId,req.body.row_id,req.body.day_index,req.body.person||'');
  res.json({ok:true});
});
app.put('/api/schedule/:weekId/note', requireAdmin, (req,res)=>{
  upsertNote(req.params.weekId,req.body.note_index,req.body.day_index,req.body.content||'');
  res.json({ok:true});
});

// ══════════════════════════════════════════════════════════════════════════════
// DOĞUM GÜNLERİ
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/birthdays', requireAuth, (req,res)=>{
  const t=new Date(),mmdd=`${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  const list=getBirthdays().map(b=>{
    const bm=b.birth_date.slice(5),ny=new Date(`${t.getFullYear()}-${bm}`);
    if(ny<t)ny.setFullYear(t.getFullYear()+1);
    return{...b,isToday:bm===mmdd,age:t.getFullYear()-parseInt(b.birth_date.slice(0,4)),daysLeft:Math.ceil((ny-t)/86400000)};
  }).sort((a,b)=>a.daysLeft-b.daysLeft);
  res.json(list);
});
app.post('/api/birthdays',    requireAdmin,(req,res)=>{
  if(!req.body.name||!req.body.birth_date)return res.status(400).json({error:'Eksik'});
  const r=addBirthday(req.body.name,req.body.birth_date,req.body.note||'');
  res.json({id:r.lastInsertRowid});
});
app.delete('/api/birthdays/:id', requireAdmin,(req,res)=>{deleteBirthday(req.params.id);res.json({ok:true});});

// ══════════════════════════════════════════════════════════════════════════════
// VARDİYA TALEPLERİ
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/requests', requireAuth, (req,res)=>{
  res.json(getRequests(req.query.status, req.user.id, req.user.role));
});

app.post('/api/requests', requireAuth, (req,res)=>{
  const{day_text,day_index,shift_text,row_id,note,week_id}=req.body;
  if(!day_text||!shift_text)return res.status(400).json({error:'Eksik'});
  // Sadece kendi adına talep açabilir
  const person=req.user.name;
  if(week_id&&row_id&&day_index>=0){
    const c=checkConflict(week_id,parseInt(day_index),row_id);
    if(c)return res.json({ok:false,conflict:true,reason:`Bu gün ve saat için ${c.person} zaten onaylı.`});
  }
  const r=createRequest({person,user_id:req.user.id,day_text,day_index:parseInt(day_index??-1),shift_text,row_id:row_id||'',note,week_id});
  res.json({id:r.lastInsertRowid,ok:true});
});

app.post('/api/requests/:id/resolve', requireAdmin, (req,res)=>{
  const{status,reject_reason,week_id,row_id,day_index}=req.body;
  const rq=getRequestById(req.params.id);
  if(!rq)return res.status(404).json({error:'Bulunamadı'});
  if(status==='approved'&&week_id&&row_id&&day_index!==undefined){
    const c=checkConflict(week_id,parseInt(day_index),row_id);
    if(c&&c.person!==rq.person)return res.json({ok:false,conflict:true,reason:`${c.person} zaten onaylı.`});
    upsertCell(week_id,row_id,parseInt(day_index),rq.person);
  }
  resolveRequest(req.params.id,status,reject_reason||'',req.user.name);
  res.json({ok:true});
});

app.delete('/api/requests/:id', requireAdmin, (req,res)=>{
  require('./database').db.prepare('DELETE FROM shift_requests WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

// ══════════════════════════════════════════════════════════════════════════════
// AYARLAR (admin only)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/settings',  requireAdmin, (req,res)=>res.json({
  mailUser:getSetting('mailUser')||'',
  mailTo:  getSetting('mailTo')||'',
  mailPass:getSetting('mailPass')?'••••••••':'',
}));
app.post('/api/settings', requireAdmin, (req,res)=>{
  const{mailUser,mailTo,mailPass}=req.body;
  if(mailUser!==undefined)setSetting('mailUser',mailUser);
  if(mailTo!==undefined)setSetting('mailTo',mailTo);
  if(mailPass&&mailPass!=='••••••••')setSetting('mailPass',mailPass);
  res.json({ok:true});
});
app.post('/api/settings/test-mail', requireAdmin, async(req,res)=>{
  const to=getSetting('mailTo')||process.env.MAIL_TO;
  if(!to)return res.json({ok:false,error:'Yönetici mail girilmemiş'});
  await sendMail(to,'✅ Test Maili','<h2>✅ Bağlantı başarılı!</h2>');
  res.json({ok:true});
});

// ══════════════════════════════════════════════════════════════════════════════
// İSTATİSTİK
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/stats', requireAuth, (req,res)=>res.json(getStats(req.query.year?parseInt(req.query.year):null)));
app.get('/api/years', requireAuth, (req,res)=>res.json(getYears()));


// ══════════════════════════════════════════════════════════════════════════════
// K.İ (KULLANILMAYAN İZİN)
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/ki', requireAuth, (req, res) => {
  const summary = getKiSummary();
  // Tüm personelden K.İ'si olmayanları da ekle
  const PERSONEL = ["Alpcan ŞİŞMAN","Doğuhan DEMİROK","Evren KARA","İlyas GÜNEŞ","Özgür YENİAY","Özkan AYTEN","Mustafa ALTAŞ","Melih MEMİŞLER","Yusuf YİĞİT","Tolga KANOĞLU","Yağız GÜVEN"];
  const map = {};
  summary.forEach(s => { map[s.person] = s; });
  const full = PERSONEL.map(p => map[p] || { person:p, given:0, used:0, remaining:0 });
  res.json(full);
});

app.get('/api/ki/:person/entries', requireAdmin, (req, res) => {
  res.json(getKiEntries(decodeURIComponent(req.params.person)));
});

app.post('/api/ki', requireAdmin, async (req, res) => {
  const { person, days, reason, week_id, notify_email } = req.body;
  if (!person || !days) return res.status(400).json({ error: 'Eksik alan' });
  const r = addKiEntry(person, parseFloat(days), reason || '', week_id || null);

  // İsteğe bağlı mail bildirimi
  if (notify_email) {
    await sendMail(notify_email,
      `📋 K.İ Hakkı Tanımlandı — ${person}`,
      `<div style="font-family:Arial;font-size:14px;color:#222">
        <h2 style="color:#1F3864">📋 Kullanılmayan İzin Bildirimi</h2>
        <p>Merhaba <b>${person}</b>,</p>
        <p>Hesabınıza <b>${days} gün</b> Kullanılmayan İzin (K.İ) tanımlanmıştır.</p>
        ${reason ? `<p><b>Açıklama:</b> ${reason}</p>` : ''}
        <p>Bu izni ilerleyen haftalarda kullanmak için yöneticinize başvurun.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p style="color:#888;font-size:12px">Bu bildirim otomatik olarak gönderilmiştir.</p>
      </div>`
    );
  }

  res.json({ id: r.lastInsertRowid, ok: true });
});

app.delete('/api/ki/:id', requireAdmin, (req, res) => {
  deleteKiEntry(req.params.id);
  res.json({ ok: true });
});

// K.İ hatırlatma maili gönder
app.post('/api/ki/reminder', requireAdmin, async (req, res) => {
  const { person, email, remaining } = req.body;
  if (!person || !email) return res.status(400).json({ error: 'Eksik' });
  await sendMail(email,
    `⏰ K.İ Hatırlatma — ${person}`,
    `<div style="font-family:Arial;font-size:14px;color:#222">
      <h2 style="color:#1F3864">⏰ Kullanılmayan İzin Hatırlatması</h2>
      <p>Merhaba <b>${person}</b>,</p>
      <p>Hesabınızda kullanılmayı bekleyen <b>${remaining} gün</b> K.İ hakkınız bulunmaktadır.</p>
      <p>Bu iznizi kullanmak için yöneticinize başvurabilirsiniz.</p>
    </div>`
  );
  res.json({ ok: true });
});


app.listen(PORT,()=>console.log(`\n✅  Nöbet Çizelgesi → http://localhost:${PORT}\n`));
