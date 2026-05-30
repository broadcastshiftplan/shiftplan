# Nöbet Çizelgesi v3.0 — Kurulum Kılavuzu

## Kurulum (tek seferlik, 5 dakika)

**1. Node.js kur** → https://nodejs.org → LTS → İndir → İleri İleri Bitir

**2. Terminali aç** → Başlat → `cmd` yaz → Yönetici olarak çalıştır

**3. Klasöre gir:**
```
cd "C:\Users\KULLANICI_ADIN\OneDrive\Masaüstü\nobet-app"
```
(KULLANICI_ADIN yerine kendi adını yaz, örn: sefil)

**4. Paketleri yükle (1-3 dakika):**
```
npm install
```

**5. Ayar dosyası oluştur:**
```
copy .env.example .env
```

**6. Başlat:**
```
npm start
```

**7. Tarayıcıda aç:** http://localhost:3000

---

## Her gün açmak için

Sadece 2 adım:
```
cd "C:\Users\sefil\OneDrive\Masaüstü\nobet-app"
npm start
```

---

## Mail Bildirimi Kurulumu (isteğe bağlı)

Uygulamada **Ayarlar** sekmesine git:
1. Gmail adresin
2. Gmail Uygulama Şifresi (nasıl alınır → Ayarlar sekmesinde açıklanmış)
3. Bildirimlerin gideceği mail
4. "Kaydet" → "Test Maili Gönder" ile dene

---

## Doğum Günü Bildirimi

- "Doğum Günleri" sekmesine git
- Personeli seç, tarihi gir, ekle
- Her gün saat 09:00'da otomatik kontrol edilir
- Doğum günü gelince mail gelir
- Çizelgede "Doğum İzni" satırı vardır → +1 gün ekle

---

## Veriler nerede saklanır?

`nobet-app/data/nobet.db` dosyası — bu dosyayı silme!
Yedek almak için bu dosyayı kopyala.

