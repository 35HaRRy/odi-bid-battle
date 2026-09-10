# Issue #3 Dilimi — Tarayıcıda Deneme Rehberi

Bu dilimde neler var: kayıtlı aday listesinden **müzayede taslağı** oluşturma, listeleme, açma/devam etme, yeniden adlandırma. Taslak, ilk yerel düzenlemeye kadar kaynak listeyi **takip eder** (listedeki sıra değişimi taslağa yansır); yeniden adlandırma dahil ilk düzenleme taslağı **bağımsız kopyaya** çevirir. Eksik savaş alanı/takım/görsel kaydı engellemez. Taslak adı kullanıcı içeriğidir, dil değişiminde çevrilmez. Kayıt hatası banner gösterir.

Önkoşul: issue #2 dilimi (katalog + listeler) çalışır durumda olmalı.

## Tasarım

`.superpowers/brainstorm/49-1789040875` prototipindeki onaylı atlas görsel dünyası
(parşömen zemin, koyu kahve mürekkep, koyu yeşil detaylar, serif başlıklar) bu dilimde
uygulamaya gömülü: `web/src/design.css` + `web/src/app.css`. Müzayedeler home
(arama + durum etiketli tablo + yardım paneli), katalog ızgarası ve hazırlık aday adımı
(katalog-sol/sıralı-liste-sağ, bağımsız kaydırmalı) prototip düzenini kullanır.
Hazırlık adım göstergesinde 2. adım aktiftir; savaş alanı/takımlar/son kontrol sonraki
issue'ların işidir ve pasif görünür.

## 1. Hazırlık

```powershell
docker --version
node --version
```

## 2. Veritabanını başlat

```powershell
docker compose up -d db
docker compose exec -T db psql -U bidbattle -d bidbattle -c '\dt'
```

`auctions` ve `auction_entries` tabloları görünmeli. Görünmüyorsa şemayı uygula:

```powershell
docker compose exec -T db psql -U bidbattle -d bidbattle -f /docker-entrypoint-initdb.d/schema.sql
```

## 3. API'yi başlat (http://localhost:3001)

```powershell
npm install --prefix api
npm run build --prefix api
Start-Process -FilePath 'node' -ArgumentList 'dist/src/server.js' -WorkingDirectory "$PWD\api"
Start-Sleep -Seconds 3
Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 5
```

`ok: True` dönmeli. Olmazsa:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

## 4. Web'i başlat (http://localhost:5173)

Yeni bir PowerShell penceresinde:

```powershell
npm install --prefix web
npm run dev --prefix web
```

Tarayıcıda `http://localhost:5173` aç.

## 5. Tarayıcıda dene

1. **Liste hazırla:** "Aday Listeleri" sekmesinde en az 2 adaylı bir liste oluştur (yoksa önce "Aday Kataloğu"ndan aday ekle).
2. **Taslak oluştur:** "Müzayedeler" sekmesine geç. Taslak adı yaz, kaynak listeyi seç, "Taslak Oluştur"a bas. Taslak listede görünür.
3. **Takip testi:** Taslağı açmadan "Aday Listeleri"nde kaynak listenin sırasını değiştir (Yukarı/Aşağı). Müzayedelere dön, taslağı aç — sıra değişmiş olmalı (henüz çatallanmadı).
4. **Çatalla testi:** Taslak adını değiştir ("Yeniden Adlandır"). Artık kaynak listede yeni bir değişiklik yap (aday ekle/çıkar/sırala). Taslaktaki sıra **değişmemeli** — kopya bağımsız.
5. **İkinci taslak:** Aynı listeden ikinci taslak oluştur. Kaynak listedeki değişiklik ikinci taslağa yansır, birincisine yansımaz.
6. **Devam etme:** Bir taslağı aç, sayfayı yenile. Aynı taslak açık gelmeli (`localStorage` + sunucu doğrulaması).
7. **Eksik bilgi:** Savaş alanı/takım seçmeden taslak kaydedilebilmeli (bu dilimde savaş alanı seçimi yok, bilerek engellenmez).
8. **Dil:** Sağ üstten Türkçe/English değiştir. Arayüz değişir, taslak/liste/aday adları değişmez.
9. **Restart:** API penceresini kapatıp tekrar başlat (adım 3), sayfayı yenile. Taslaklar + sıralar durur.

## 6. API ile dene (isteğe bağlı)

```powershell
$lists = Invoke-RestMethod -Uri 'http://localhost:3001/lists'
$lists | Select-Object id, name
$listId = $lists[0].id
$body = @{ name = 'Deneme Taslağı'; sourceListId = $listId } | ConvertTo-Json
$draft = Invoke-RestMethod -Uri 'http://localhost:3001/auctions' -Method Post -ContentType 'application/json' -Body $body
$draft | Select-Object id, name, followsSource, entries
Invoke-RestMethod -Uri 'http://localhost:3001/auctions'
$rb = @{ name = 'Yeni Ad' } | ConvertTo-Json
Invoke-RestMethod -Uri ("http://localhost:3001/auctions/" + $draft.id) -Method Patch -ContentType 'application/json' -Body $rb | Select-Object name, followsSource
```

Yeniden adlandırmadan sonra `followsSource` `False` olmalı.

## 7. Kapatma

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
docker compose stop db
```

## Komut yoksa ne yapmalı

- `5433` doluysa: `docker ps --format 'table {{.Names}}\t{{.Ports}}'` ile bak, çakışan servisi durdur.
- API `persistence failed` basıyorsa DB ayakta mı kontrol et (adım 2). Hata bilerek gösterilir, sahte kayıt yapılmaz.
- `auctions` tablosu yok hatası alırsan adım 2'deki şema komutunu tekrar çalıştır.
