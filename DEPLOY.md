# 🌐 Online Yayına Alma (Railway.app)

## Neden Railway?
- Ücretsiz plan: aylık $5 kredi (küçük uygulamalar için yeterli)
- Node.js + SQLite mükemmel çalışır
- Kalıcı disk (veriler silinmez)
- Otomatik HTTPS

---

## Kurulum — 10 Dakika

### 1. GitHub Hesabı Aç (yoksa)
https://github.com → Sign up

### 2. Projeyi GitHub'a Yükle
- github.com'da yeni repo aç → "nobet-cizelgesi"
- nobet-app klasöründeki dosyaları yükle (node_modules hariç)

### 3. Railway'e Deploy Et
1. https://railway.app → "Start a New Project"
2. "Deploy from GitHub repo" → nobet-cizelgesi'ni seç
3. Railway otomatik algılar ve başlatır

### 4. Environment Variables Ekle
Railway Dashboard → proje → Variables:
```
PORT=3000
ADMIN_USER=admin
ADMIN_PASS=guclu_sifreniz
VIEWER_PASS=personel_sifresi
JWT_SECRET=cok_uzun_gizli_bir_metin_buraya
MAIL_USER=nobet@gmail.com
MAIL_PASS=xxxx xxxx xxxx xxxx
MAIL_TO=yonetici@gmail.com
```

### 5. Volume Ekle (SQLite için)
Railway Dashboard → proje → Add Volume:
- Mount Path: /app/data

### 6. Domain Al
Railway Dashboard → Settings → Domains → "Generate Domain"
Örn: nobet-cizelgesi.up.railway.app

---

## Alternatif: Render.com (ücretsiz)
1. https://render.com → New → Web Service
2. GitHub repo bağla
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Add Disk: /app/data (1GB)
6. Environment Variables ekle (aynı şekilde)

---

## Yerel Kullanım (mevcut)
BASLAT.bat → localhost:3000
Sadece aynı ağdaki bilgisayarlardan erişilebilir.

## Online Kullanım (Railway/Render sonrası)
https://nobet.sirketniz.com → herhangi bir cihazdan erişilebilir
Personel telefondan nöbet listesini görebilir.
