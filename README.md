# 📋 Nöbet Çizelgesi Yönetim Sistemi v2.0

Yayın Mühendisliği nöbet çizelgesi — Node.js tabanlı, SQLite veritabanı, WhatsApp talep entegrasyonu.

---

## 🚀 Kurulum (5 dakika)

### 1. Node.js Yükle
https://nodejs.org adresinden **LTS** sürümünü indir ve kur.

### 2. Projeyi Aç
```
nobet-app klasörünü istediğin bir yere kopyala.
```

### 3. Bağımlılıkları Yükle
Terminali (cmd/powershell) aç, klasöre gir:
```
cd nobet-app
npm install
```

### 4. Ayar Dosyasını Kopyala
```
# Windows:
copy .env.example .env

# Mac/Linux:
cp .env.example .env
```

### 5. Uygulamayı Başlat
```
npm start
```

Tarayıcıda aç: **http://localhost:3000**

---

## 📱 WhatsApp Entegrasyonu

### Twilio Kurulumu
1. **Ücretsiz hesap aç**: https://www.twilio.com/try-twilio
2. Console → Messaging → **Try it out** → Send a WhatsApp message
3. Sandbox'a katılım: Verilen numaraya `join [kelime]` yaz
4. Account SID ve Auth Token'ı `.env` dosyasına yaz:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxx...
   TWILIO_AUTH_TOKEN=xxxxxxxx...
   TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
   MANAGER_WHATSAPP=whatsapp:+905321234567
   ```

### Ngrok ile Public URL Alma (Twilio webhook için)
1. https://ngrok.com/download → ücretsiz indir ve kur
2. Yeni terminalde çalıştır:
   ```
   ngrok http 3000
   ```
3. Verilen URL'yi (örn. `https://xxxx.ngrok.io`) uygulamada **Ayarlar** sekmesine gir
4. Twilio konsolunda Sandbox Settings → **When a message comes in** kutusuna:
   ```
   https://xxxx.ngrok.io/webhook/whatsapp
   ```

### Personel Talep Gönderimi
Personel WhatsApp'tan şu formatta mesaj atar:
```
TALEP CUMA SABAH
TALEP PAZARTESİ 15:00-00:00
TALEP ÇARŞAMBA GECE
```

---

## 💾 Veri Yönetimi

- Tüm veriler `data/nobet.db` dosyasında saklanır (SQLite)
- Bu dosyayı yedeklemek yeterli
- Tüm haftalar, yıllar ve istatistikler burada birikir
- Uygulama silinse bile `.db` dosyası duygunda veriler korunur

---

## 🗓️ Hafta Açma

1. Çizelge sekmesinde **+ Yeni Hafta** butonuna tıkla
2. Tarih ve başlık gir
3. Otomatik olarak önerilen tarih bir sonraki haftadır
4. Hafta bittikten sonra **Haftayı Kilitle** ile arşivle
5. Arşiv sekmesinde geçmiş haftalara bakabilirsin

---

## 📊 İstatistikler

- İstatistik sekmesinde tüm haftaların kümülatif toplamı görünür
- Yıl filtresiyle sadece belirli bir yılı inceleyebilirsin
- Her personelin: Sabah/Araçı/Akşam/Gece/Dış Görev/İzin sayıları toplanır

---

## 🔄 Sunucu Olarak Çalıştırma

Ofis içi ağda herkes erişsin istiyorsan:
```
npm start
```
Diğer bilgisayarlardan: `http://[sunucu-IP]:3000`

Arka planda çalıştırmak için (Linux/Mac):
```
npm install -g pm2
pm2 start server.js --name nobet
pm2 startup
pm2 save
```

---

## ❓ Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| `npm install` hata veriyor | Node.js'in doğru kurulduğunu kontrol et |
| Port 3000 meşgul | `.env` dosyasında `PORT=3001` yaz |
| WhatsApp mesaj gelmiyor | Ngrok çalışıyor mu? Twilio webhook URL doğru mu? |
| Veri kayboldu | `data/nobet.db` dosyasını kontrol et |
