# ODI Bid Battle — Vercel + Neon yayınlama tarifi

## 1. Amaç ve durum

Uygulamayı `odibd.hayrihabip.com` üzerinde tek Vercel projesiyle yayınlamak; geliştirme ve testleri yerel kod ve yerel veritabanıyla sürdürmek.

Bu belge, mevcut repoya göre hazırlanmış **uygulama ve kurulum tarifidir**. Vercel deployment adımları 2026-09-16 tarihinde uygulandı ve production yayını doğrulandı (bkz. bölüm 10 sonundaki gerçekleşen durum notu). Boyut bütçeleri (bölüm 4) kodda mevcuttur; canlıda sınır üstü yükleme denenmedi.

Kararlaştırılan kapsam:

- İki ortam vardır: **yerel** ve **canlı**. Preview ortamı kurulmaz.
- Yerel PostgreSQL ile Neon birbirinden bağımsızdır. Yerel testler Neon'a bağlanmaz.
- Canlı veritabanı boş başlar: yalnızca şema kurulur; seed veya yerelden veri aktarımı yapılmaz.
- Canlı frontend ve API aynı origin'dedir. Ayrı backend projesi veya API subdomain'i kullanılmaz.
- İş kuralları, sayfalar ve kullanıcı akışları korunur. Vercel'e uyum için giriş noktası, bağlantı yönetimi, boyut sınırları, doğrulama ve ilgili hata mesajları değiştirilebilir.
- Vercel kaynaklı uygulama sınırları yerelde de uygulanır.

## 2. Mevcut proje

| Konu | Mevcut durum |
| --- | --- |
| Paket düzeni | Kökte pnpm workspaces: `api`, `web`, `db` (tek kök lockfile + `web` altında Vercel uyumluluğu için ayna lockfile/workspace) |
| Frontend | `web/`: React 18, Vite 5, TypeScript |
| Backend | `api/`: Express 4, TypeScript, `pg`, `multer` |
| Express kurulumu | `api/src/server.ts` içindeki `buildApp(store)` |
| Sunucu başlatma | Aynı dosyanın sonunda, `VITEST` dışında bağlantı açıp `listen` çağırıyor |
| API yolları | `/health`, `/candidates`, `/lists`, `/auctions` vb.; henüz `/api` öneki yok |
| Frontend API adresi | `web/src/api.ts`: `VITE_API_URL`, varsayılan `http://localhost:3001` |
| Yerel veritabanı | Docker Compose, PostgreSQL 18, host portu `5433` |
| Şema | `db/schema.sql` |
| Görseller | PostgreSQL `BYTEA`; takım istek/yanıtlarında base64 JSON da kullanılıyor |
| Dosya varlığı | `api/src/assets/default-background.svg`, API tarafından dosyadan okunuyor |
| Frontend build | Repo kökünden `npm run build -w web`, çıktı `web/dist` |
| Backend build | `npm run build -w api`; TypeScript derleme ve asset kopyalama |
| Git | İnceleme sırasında uzak reponun varsayılan ve mevcut branch'i `development` |

Kökte `build` script'i yoktur; build/test/typecheck kökten `pnpm --filter` ile çalıştırılır. Mevcut `db:migrate` komutu yalnızca Docker içindeki yerel veritabanına yöneliktir; Neon migration komutu değildir. Paket yöneticisi pnpm 11.20.0'dır (`packageManager` alanında sabit).

## 3. Hedef dağıtım düzeni

Mevcut workspace'ler korunur. Vercel projesinin Root Directory ayarı `web` olur. Bu dizine yalnızca ince bir function adaptörü ve Vercel yapılandırması eklenir:

```text
odi-bid-battle/
├── package.json
├── package-lock.json
├── api/
│   ├── package.json
│   └── src/
│       ├── app.ts           # Yeni: mevcut buildApp ve route kurulumu
│       ├── server.ts        # Yerel/standalone bağlantı ve listen
│       ├── store.ts
│       └── assets/
├── web/
│   ├── api/
│   │   └── index.ts         # Yeni: Vercel Node.js function adaptörü
│   ├── vercel.json          # Yeni: web köküne göre yapılandırma
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
└── db/
    └── schema.sql
```

Bu seçim, repo kökündeki mevcut `api/src` ve `api/test` dosyalarının Vercel tarafından ayrı ayrı function girişleri olarak algılanmasını önler. Backend kaynakları taşınmaz; adaptör onları kullanır.

**Monorepo koşulu:** Vercel'de Root Directory dışındaki kaynakların build'e dahil edilmesi etkinleştirilmelidir (`Include source files outside of the Root Directory in the Build Step`). Kardeş `api` workspace'inin bağımlılıkları da kurulmalı ve function paketine izlenmelidir. Yalnızca frontend bağımlılıklarını kuran filtreli kurulum kullanılmaz. Adaptörün backend'e bağımlılığı workspace bağımlılıklarında açıkça tanımlanır; paket giriş/export ayarı uygulama aşamasında buna göre eklenir. Backend değişikliklerinin yayını yanlışlıkla atlamaması için başlangıçta “Skip unaffected projects” kapalı tutulur.

### 3.1. Express giriş noktasını ayır

- Mevcut `buildApp(store)` ve route kurulumu `api/src/app.ts` içine ayrılır. Bu modülü import etmek port dinlemeye veya veritabanı bağlantısına yol açmaz.
- `api/src/server.ts`, yerel/standalone başlangıç noktası olarak kalır. `npm run dev -w api` çalışmaya devam eder.
- `web/api/index.ts`, Vercel'in çağırdığı handler'ı export eder; `listen` çağırmaz.
- Adaptör, `/api` altında mevcut Express uygulamasını bağlar. Örneğin dışarıdaki `/api/candidates`, mevcut içerideki `/candidates` route'una ulaşır. Rewrite'ın kendiliğinden öneki sildiği varsayılmaz.
- Bilinmeyen `/api/*` yolları JSON 404 döndürür; SPA HTML'ine düşmez.
- `NODE_ENV !== 'production'` koşuluna güvenerek import yan etkileri bırakılmaz. Yerel production build'i de bağımsız çalışabilmelidir.
- Yeni adaptör ayrıca TypeScript kontrolüne dahil edilir. Mevcut `web/tsconfig.json` yalnızca `src` ve `vite.config.ts` içerdiğinden mevcut typecheck'in adaptörü kapsadığı varsayılmaz.

### 3.2. Bağlantı ömrü

- Mevcut `pg` istemcisi ve SQL transaction'ları korunur; sırf Neon kullanılıyor diye istemci değiştirilmez.
- Function örneği başına tekrar kullanılan bir store/pool veya başlatma promise'i bulunur. Her HTTP isteğinde yeni pool oluşturulmaz ve ortak pool her istek sonunda kapatılmaz.
- İlk bağlantı başarısız olursa başlatma cache'i temizlenerek sonraki istekte yeniden denenebilir olmalıdır.
- Pool bağlantı sayısı ve bağlantı/boşta kalma zaman aşımı sınırlanır; kullanılan Vercel çalışma modeline uygun pool yaşam döngüsü doğrulanır.
- Canlıda eksik `DATABASE_URL` açık hata üretir; `localhost` varsayılanına düşmez.
- Şema kurulumu function başlangıcında veya HTTP isteği sırasında çalıştırılmaz.

### 3.3. Dosyalar ve yönlendirme

- `default-background.svg` function paketine dahil edilir. Yerel API build'inin asset kopyalaması tek başına Vercel paketinde bulunduğunu kanıtlamaz.
- Gerekirse `functions.includeFiles` kullanılır; dosya yolu `web` proje kökü ve gerçek runtime konumuyla doğrulanır.
- Yüklenen görseller Neon'da tutulur; function dosya sistemine kalıcı veri yazılmaz.
- Frontend build ortamında `VITE_API_URL=/api` kullanılır. Bu public bir build değişkenidir; veritabanı bağlantısı değildir.
- Yerelde mevcut `5173 → 3001` bağlantısı ve bunun için gereken CORS desteği korunabilir. Canlı aynı-origin çalışır; canlı API için geniş CORS izni gerekmez.
- Statik asset istekleri gerçek dosyaya, API istekleri function'a gider. SPA fallback API ve statik dosya hatalarını gizlememelidir.

`web/vercel.json` için yönlendirme başlangıç örneği:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "git": {
    "deploymentEnabled": false
  },
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/index" }
  ]
}
```

Bu örnek adaptör, dosya paketleme ve bağımlılık ayarları tamamlandıktan sonra Vercel build'iyle doğrulanır. `buildCommand` burada **web dizininde** çalışır. Repo kökündeki komut karşılığı `npm run build -w web` olur. Backend için derlenmiş paket girişi seçilirse build sırasına önce API build'i eklenir.

## 4. Vercel boyut sınırlarına uyum

Vercel Functions belgelerindeki istek ve yanıt gövdesi sınırı **4,5 MB**. Mevcut aday/savaş alanı upload sınırı 5 MiB; Express JSON sınırı 15 MB. Bunlar aynı şekilde canlıya taşınamaz.

Uygulama için hedef toplam gövde bütçesi **4.000.000 bayt** olarak belirlenir; bu Vercel sınırının kendisi değil, altında seçilmiş uygulama sınırıdır. Multipart metadata ve sınır ayırıcıları da toplam bütçeye dahildir.

Gerekli değişiklikler:

1. Aday, savaş alanı ve arka plan görsellerinin tek dosya sınırı, multipart ek yüküne pay bırakacak şekilde en fazla **3.500.000 bayt** olur. Toplam istek ayrıca sınırlanır.
2. Takım bayrakları/avatarları base64 JSON olarak gönderildiği için yalnızca ham dosya büyüklüğü kontrol edilmez. Gerçek JSON'un UTF-8 bayt boyutu ölçülür; bütün takım görselleri ve metin alanları birlikte değerlendirilir.
3. Frontend, sınırı aşan isteği göndermeden açık hata gösterir. Backend aynı kontrolleri bağımsız uygular; yalnızca `Content-Length` başlığına güvenmez.
4. Express JSON limiti toplam bütçeyle uyumlu olur; multipart ve domain doğrulamaları aynı merkezi sabitlere dayanır.
5. Backend'in yakaladığı boyut aşımı tutarlı JSON 413 üretir. Platformun uygulamaya ulaşmadan döndürdüğü HTML/metin 413 yanıtı da frontend'de anlaşılır hata olarak gösterilir.
6. **Yanıt bütçesi de kontrol edilir.** Takım kaydetme isteği küçük olsa bile mevcut bayrak/avatarların eklendiği GET yanıtı büyük olabilir. Kaydetmeden önce oluşacak tam takım yanıtı değerlendirilir; okunamayacak veri kabul edilmez.
7. Canlı durum ve sonuç yanıtları gibi birleşik yanıtlar ölçülür. Sınıra sığmayan görsel taşıma biçimi varsa ayrı görsel endpoint'leriyle taşınması gibi iç API uyarlaması yapılır; kullanıcı akışı korunur.
8. Yerelde daha önce oluşturulmuş büyük görseller/veriler sessizce silinmez veya bozulmaz; açık uyumsuzluk mesajı ve daha küçük görselle değiştirme yolu sağlanır.

Görsel sıkıştırma veya yeni object storage servisi başlangıç şartı değildir. Sadece upload middleware limitini düşürmek bu bölümün tamamlandığı anlamına gelmez.

## 5. Ortam değişkenleri

| Değişken | Yerel | Canlı |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://bidbattle:bidbattle@localhost:5433/bidbattle` | Neon **pooled** bağlantı; yalnızca Vercel Production |
| `VITE_API_URL` | `http://localhost:3001` | `/api`; frontend build sırasında |
| `PORT` | API için `3001` | Function adaptörü tarafından kullanılmaz |
| `NEON_DIRECT_URL` | Normal geliştirmede tanımlanmaz | Yalnızca yönetim/migration oturumunda kullanılan direct bağlantı |

- Neon bağlantısındaki TLS parametreleri Neon Console'dan alınır ve korunur; sertifika doğrulaması kapatılmaz.
- `DATABASE_URL`, `VITE_` önekli değişkene konmaz ve frontend bundle'ına girmez.
- Canlı bağlantı Preview veya Vercel Development ortamına eklenmez.
- Kökte `.env` oluşturmak mevcut API tarafından otomatik yüklenmesini sağlamaz. Aşağıdaki yerel komutlar PowerShell ortam değişkenleri kullanır; ileride env dosyası desteği eklenirse yükleme yolu açıkça tanımlanır.
- Gerçek bağlantılar Git'e eklenmez. Env örnekleri yalnızca yerel değerler veya secretsiz açıklamalar içerir.

## 6. Yerel geliştirme ve test

Komutlar repo kökünde, PowerShell'de çalıştırılır. Node.js 24, pnpm 11.20.0, Docker ve mevcut lockfile kullanılır. Node ana sürümü (`24.x`) yerel, Vercel ve `engines` alanında aynı sabitlenmiştir; mevcut bağımlılıklarla typecheck/test/build geçmesi gerekir.

İlk kurulum:

```powershell
pnpm install --frozen-lockfile
if (!(Test-Path -LiteralPath "db/data")) {
  New-Item -ItemType Directory -Path "db/data"
}
pnpm run db:up
```

Mevcut Compose dosyası `db/data` dizinini bind-backed volume olarak kullanır. PostgreSQL hazır olduktan sonra:

```powershell
docker compose exec -T db pg_isready -U bidbattle -d bidbattle
npm run db:migrate
```

Boş veritabanının ilk açılışında `db/schema.sql` zaten init script'i olarak çalışır. `db:migrate`, mevcut yerel veritabanına aynı dosyayı uygulama komutudur. Dolu veritabanında şema değişikliği öncesinde SQL incelenir.

Terminal 1 — API:

```powershell
$env:DATABASE_URL = "postgres://bidbattle:bidbattle@localhost:5433/bidbattle"
$env:PORT = "3001"
pnpm --filter odi-bid-battle-api run dev
```

Terminal 2 — frontend:

```powershell
$env:VITE_API_URL = "http://localhost:3001"
pnpm --filter odi-bid-battle-web run dev
```

Doğrulama:

- `http://localhost:5173/`: frontend.
- `http://localhost:3001/health`: uygulama yanıtı.
- `http://localhost:3001/candidates`: şemaya ve veritabanına erişim. `/health` tek başına bunu kanıtlamaz.

Yerel değişikliklerden sonra:

```powershell
pnpm run typecheck
pnpm test
pnpm --filter odi-bid-battle-api run build
pnpm --filter odi-bid-battle-api run verify-built-assets
pnpm --filter odi-bid-battle-web run build
```

Not: `web/pnpm-lock.yaml` ve `web/pnpm-workspace.yaml`, Root Directory `web` iken Vercel'in function bağımlılık kurulumu için gerekli aynalardır. `web/package.json` değiştiğinde kökte `pnpm install --lockfile-only`, `web` dizininde de `pnpm install --lockfile-only` çalıştırılarak iki lockfile da senkron tutulur.

Veritabanı kullanan testlerin bağlantısı yerel hedefte tutulur; canlı credentials bulunan bir shell'de test çalıştırılmaz. Vercel adaptörü için yeni typecheck ve entegrasyon kontrolleri de bu akışa eklenir.

`vercel dev` günlük geliştirme için zorunlu değildir. Adaptör/yönlendirme kontrolünde kullanılabilir ancak yerel DB'ye bağlanmalıdır; platform limitlerini ve canlı çalışma koşullarını birebir taklit ettiği varsayılmaz.

## 7. Boş Neon veritabanını kur

1. Canlı için Neon projesi oluştur. Yereldeki PostgreSQL 18 ile uyumlu sürüm seç; sürüm farkı varsa SQL uyumluluğunu doğrula.
2. Vercel function bölgesine yakın bir Neon bölgesi seç.
3. Boş bir veritabanı oluştur. Örnek veri veya yerel dump yükleme.
4. Console'dan aynı canlı veritabanının pooled ve direct bağlantılarını al.
5. Pooled bağlantıyı Vercel Production `DATABASE_URL` olarak kaydet.
6. İlk şema kurulumu için yönetim oturumunda direct bağlantıyı kullan. PostgreSQL `psql` istemcisi gereklidir. `NEON_DIRECT_URL` güvenli biçimde yalnızca bu oturumda tanımlandıktan sonra repo kökünden:

```powershell
psql "$env:NEON_DIRECT_URL" -X -v ON_ERROR_STOP=1 -f "db/schema.sql"
```

Komutun çıkış kodu sıfır olmalı. `db/schema.sql` kendi transaction sınırlarını içerir. Tabloların oluştuğunu ve iş verisi tablolarının boş olduğunu doğrula.

**Pooled/direct ayrımı:** Runtime için pooled bağlantı bu projenin tercihidir. Direct bağlantı yasak değildir; yönetim ve migration işlemleri için kullanılır.

### Sonraki şema değişiklikleri

`CREATE TABLE IF NOT EXISTS`, var olan tabloları kendiliğinden yeni şemaya dönüştürmez. İlk canlı kurulumdan sonraki değişiklikler sıralı, kaydı tutulan migration SQL dosyalarıyla uygulanmalıdır. Mevcut `db:migrate` script'i migration geçmişi yöneticisi olarak kabul edilmez.

Önce yerel DB'de doğrula; sonra canlı migration'ı ayrı bir yayın adımı olarak çalıştır. Runtime/cold start veya her frontend build'i sırasında otomatik şema güncellemesi yapma. Uygulama rollback'i şemayı geri almaz; migration'lar önceki çalışan sürümle uyumlu hazırlanmalıdır.

## 8. Vercel projesi ve canlı yayın

### Proje ayarları

| Ayar | Hedef |
| --- | --- |
| Proje sayısı | Tek (`odi-bid-battle`, 2026-09-16'da mevcut; yeniden oluşturma gerekmez) |
| Root Directory | `web` |
| Root dışı kaynakları dahil et | Açık (`sourceFilesOutsideRootDirectory: true`); kardeş `api` workspace'i için gerekli |
| Framework Preset | Vite |
| Install | `cd .. && corepack pnpm install --frozen-lockfile` (kök workspace; frontend-only filtre yok) |
| Build Command | `node scripts/copy-api-assets.mjs && cd .. && corepack pnpm --filter odi-bid-battle-web run build` |
| Output Directory | `dist` (web köküne göre) |
| Node.js | `24.x` (yerel v24.18.0 ile aynı; `engines` alanında sabit) |
| Environment | `DATABASE_URL` ve `VITE_API_URL=/api`, yalnızca Production |
| Function region | `iad1`; Neon `aws-us-east-2` (aynı kıta, yakın bölge) |
| Domain | `odibd.hayrihabip.com` (projeye bağlı ve doğrulanmış) |
| Etkilenmemiş projeleri atla | Kapalı (`enableAffectedProjectsDeployments: false`) |

### Preview ve yayın tetikleme politikası

İlk kurulum için **manuel Production yayını** kullanılır. `git.deploymentEnabled: false` bütün otomatik Git yayınlarını kapatır; geliştirme push'ları ne Preview ne Production üretir. Bu ayar CLI ile manuel Preview oluşturmayı engellemez; normal akışta `--prod` kullanılmalıdır.

İnceleme sırasında branch `development` idi. Tarif `main` branch'inin var olduğunu varsaymaz. Yayınlanacak commit bu branch üzerinde doğrulanıp kaydedilir; branch'in adı tek başına yayın onayı anlamına gelmez. İleride otomatik Production istenirse ayrıca canlı branch seçilir ve yalnızca o branch etkinleştirilir.

### İlk yayın sırası

1. Bölüm 3–4 uygulama değişikliklerini tamamla ve yerel kontrolleri geçir.
2. Neon şemasını kur; canlı DB boşluğunu doğrula.
3. Tek Vercel projesini yukarıdaki ayarlarla oluştur; otomatik Git yayını kapalı kalsın.
4. Vercel CLI'ı kullanırken **repo kökünden** projeyi bağla; Root Directory'nin `web` olduğunu doğrula:

   ```powershell
   npx vercel link
   ```

5. Yerel Vercel paketlemesini kontrol et. Production ayarları indirildiğinde bağlantı bilgilerinin `.vercel` altında oluşabileceğini dikkate al; bu dizin Git dışında kalmalı ve normal yerel geliştirme env'i olarak kullanılmamalıdır:

   ```powershell
   npx vercel pull --yes --environment=production
   npx vercel build --prod
   ```

   Build veritabanına bağlantı veya migration gerektirmemelidir. Çıktıda frontend statik dosyaları, tek API function'ı, backend bağımlılıkları ve varsayılan SVG kontrol edilir. Import sırasında `listen` veya DB bağlantısı çalışmadığı doğrulanır.

6. Doğrulanan commit'i Production'a yayınla:

   ```powershell
   npx vercel --prod
   ```

7. Projeye `odibd.hayrihabip.com` domain'ini ekle. DNS sağlayıcıda **Vercel'in bu proje için gösterdiği** CNAME/hedef kaydını uygula; sabit bir DNS hedefi varsayma. Domain doğrulaması ve HTTPS tamamlanmalı.
8. Aşağıdaki canlı kabul kontrollerini gerçekleştir.

Vercel'in verdiği otomatik deployment adresi ayrı bir backend veya Preview ortamı sayılmaz; aynı Production dağıtımının platform adresidir.

## 9. Kabul kontrolleri

### Yayın öncesi yerel kontroller

- [ ] Mevcut typecheck, test ve iki workspace build'i geçiyor.
- [ ] Yeni adaptör typecheck kapsamına dahil; import port açmıyor.
- [ ] `/api` yönlendirmesi GET, POST, PATCH, DELETE ve multipart için çalışıyor; query string korunuyor.
- [ ] Bilinmeyen API yolu JSON 404; statik asset yolları doğru içerik türüyle yanıt veriyor.
- [ ] Ortak pool istekler arasında kullanılıyor; bağlantı hatasından sonra yeniden deneme mümkün.
- [ ] API function paketinde yalnızca hedef giriş var; testler ayrı function olarak yayınlanmıyor.
- [ ] Varsayılan arka plan görseli gerçek function paketinden okunabiliyor.
- [ ] Sınır altı/üstü multipart, base64 JSON, çoklu görsel toplamı ve UTF-8 metin boyutları test edildi.
- [ ] Kabul edilen takım verisi sonraki GET/live/sonuç yanıtlarında bütçeyi aşmıyor.
- [ ] Platform tipi JSON olmayan 413 için kullanıcıya anlaşılır hata gösteriliyor.

### Canlı kontroller

- [ ] `https://odibd.hayrihabip.com/` frontend'i açıyor.
- [ ] Tarayıcı API istekleri aynı origin'de `/api/*` kullanıyor; `localhost:3001` isteği yok.
- [ ] `/api/health` yanıt veriyor; `/api/candidates` ve `/api/auctions` ilk kurulumda boş liste döndürüyor.
- [ ] HTTPS, function logları ve Neon bağlantısı hatasız.
- [ ] Yerel DB'ye eklenen kayıt canlıda görünmüyor.
- [ ] Başka branch'e push otomatik Preview/Production yayını oluşturmuyor.

Canlıda günlük test verisi üretilmez. Yazma, görsel yükleme, hazırlık, başlatma, teklif, satış, geri alma ve sonuç akışları öncelikle yerelde denenir. Canlı yazma doğrulaması gerekiyorsa sahibinin onayladığı ilk gerçek kayıtla yapılır; boş başlangıç şartı korunmak isteniyorsa sentetik kayıt eklenmez. Canlı yazma/yükleme denenmediyse yayın raporunda açıkça belirtilir.

### Gerçekleşen durum (2026-09-16)

- `web/vercel.json` yeniden oluşturuldu; `web/api/index.ts` adaptörü pool yaşam döngüsü (`attachDatabasePool` + hata durumunda pool kapatma) ve `DATABASE_URL` zorunluluğu testleriyle (`web/test/vercel-handler.test.ts`, 5 test) güçlendirildi.
- Yerel: typecheck + 221 test (api 185, web 36) geçti; `vercel build --prod` çıktısında tek function (`api/index.func`, `nodejs24.x`), backend bağımlılıkları, `default-background.svg` ve test sızıntısı olmadığı doğrulandı.
- Production deployment (`npx vercel --prod`) başarılı; `odibd.hayrihabip.com` aynı deployment'a aliaslı. Canlı kontroller: `/` 200 HTML, `/api/health` ok, `/api/candidates` Neon'a bağlı (2 kayıt döndü), `/api/auctions` boş liste, bilinmeyen API yolu JSON 404, bundle'da `localhost:3001` yok (`VITE_API_URL=/api`).
- **Canlı veri kararı:** Neon `production` branch'indeki 2 test kaydı ("100 Mızraklı Gondor Muhafızı", "200 Elf Okcusu") sahip kararıyla bırakıldı; silinmedi.
- **Bağlantı türü:** Vercel'deki `DATABASE_URL` secret'ının Neon pooled bağlantısı olduğu sahip tarafından teyit edildi.
- **Bilinen kozmetik sorun:** Bulut build logunda function paketleme adımında `@types/express` soyuna dair TS uyarıları görülüyor; deployment ve runtime etkilenmiyor (canlıda doğrulandı). Yerel typecheck temiz; soy `pnpm-workspace.yaml` override'larıyla tekilleştirilmiş durumda.
- Canlı yazma/yükleme akışı denenmedi; ilk gerçek kayıt sahip onayıyla oluşturulacak.

## 10. Uygulama sırası ve tamamlanma ölçütü

1. Yan etkisiz Express uygulaması ve Vercel adaptörü.
2. Monorepo bağımlılıkları, function paketleme, yönlendirme ve env ayrımı.
3. İstek/yanıt bütçeleri, frontend/backend doğrulama ve sınır testleri.
4. Yerel kontroller ve Vercel build çıktısı doğrulaması.
5. Boş Neon şeması, Vercel Production ayarları ve manuel yayın.
6. Domain/DNS ve canlı kabul kontrolleri.

Kod/build kontrolleriyle gerçek bulut doğrulamaları ayrı raporlanır. Yalnızca dokümanın hazırlanması, frontend build'inin geçmesi veya `/health` yanıtı, dağıtımın tamamlandığı anlamına gelmez.

## Kaynaklar

Doküman hazırlanırken incelenen resmi kaynaklar; platform sınırları ve ayarları uygulama sırasında tekrar kontrol edilmelidir:

- [Vercel — Build ve Root Directory ayarları](https://vercel.com/docs/builds/configure-a-build)
- [Vercel — Monorepo desteği ve workspace bağımlılıkları](https://vercel.com/docs/monorepos)
- [Vercel — Git deploymentEnabled](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel — Function limitleri](https://vercel.com/docs/functions/limitations#request-body-size)
- [Vercel — Function içinde dosya kullanımı](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions)
- [Neon — Serverless connection pooling](https://neon.com/docs/guides/serverless-connection-pooling)
