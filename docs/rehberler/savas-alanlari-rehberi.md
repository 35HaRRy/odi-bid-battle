# Savaş Alanı ve Arka Plan Varlık Yönetimi Rehberi (Issue #5)

Bu rehber, ODI Bid Battle projesine eklenen yeniden kullanılabilir savaş alanı kütüphanesi, kopyala-düzenle (copy-on-edit) mekanizması, taslak arka plan özelleştirmeleri ve arayüz entegrasyonu özelliklerini test etmeniz için adım adım talimatlar içerir.

## Yapılan Değişiklikler Özetle
1. **Savaş Alanı Kütüphanesi:** Savaş alanlarının (isim, coğrafya, tarihçe ve görsel) yönetildiği, arşivlenebildiği ve güncellenebildiği kütüphane altyapısı.
2. **Kopyala-Düzenle Güvenliği:** Referans verilmiş savaş alanları düzenlendiğinde orijinali arşivlenir ve yeni kopya oluşturulur; referanssızlar yerinde güncellenir.
3. **Taslak Entegrasyonu (Adım 0):** Taslak hazırlık ekranında (Step 0) savaş alanı seçimi ve taslağa özel arka plan yükleme / varsayılana sıfırlama özellikleri.
4. **Varsayılan Arka Plan:** Yerleşik parşömen SVG arka planı (`default-background.svg`) ve önbellekleme/güvenlik başlıkları.

---

## Adım Adım Deneme Kılavuzu (Tarayıcı ve PowerShell)

### 1. Veritabanını Başlatın ve Göçleri Uygulayın
PowerShell penceresinde proje kök dizinindeyken:
```powershell
npm run db:up
npm run db:migrate
```

### 2. API ve Web Sunucularını Başlatın
İki ayrı PowerShell terminali açarak sırasıyla API ve Web sunucularını başlatın:

**Terminal 1 (API):**
```powershell
cd api
npm run dev
```

**Terminal 2 (Web):**
```powershell
cd web
npm run dev
```

### 3. Tarayıcıda Test Etme Adımları
1. Tarayıcınızda `http://localhost:5173` adresine gidin.
2. Üst menüden **"Savaş Alanları"** (Battlefields) sekmesine tıklayın.
3. **"Yeni Savaş Alanı"** butonuna tıklayarak bir savaş alanı adı, coğrafyası, tarihçesi ve bir görsel (PNG/JPEG) yükleyip kaydedin.
4. **"Müzayedeler"** sekmesine dönün ve yeni bir taslak oluşturun.
5. Taslak hazırlık ekranında **Adım 0 (Savaş Alanı)** aşamasında eklediğiniz savaş alanını seçin.
6. Arka plan bölümünden özel bir görsel yükleyin veya varsayılana sıfırlayın.
7. Dil seçeneğini Türkçe ve İngilizce arasında değiştirerek metinlerin uyumunu gözlemleyin.
