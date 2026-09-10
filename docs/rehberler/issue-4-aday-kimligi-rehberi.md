# Issue #4 Dilimi — Tarayıcıda Deneme Rehberi

Bu dilimde neler var: tekrar kullanılabilir listelerde **aday kimliğini koruma**. Katalogda, listede ve taslakta **Düzenle** düğmeleri; düzenleme diyalogu (ad + opsiyonel görsel, kopyalama notu); arşiv onay diyaloğu. Kural: katalogda listede geçen aday düzenlenirse **yeni kayıt (B)** oluşur, eski (A) arşivlenir, mevcut listeler **A'da kalır**. Listede/taslakta düzenlenen aday her zaman yeni kayıt olur ve **sadece o listede/taslakta** değişir. Arşivlenen liste yeni seçimde görünmez ama kullanan taslaklar bozulmaz.

Önkoşul: issue #2 (katalog + listeler) ve #3 (taslaklar) çalışır durumda olmalı.

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

Bu dilim `candidate_lists` tablosuna `archived_at` ekler. Şemayı tekrar uygula:

```powershell
docker compose exec -T db psql -U bidbattle -d bidbattle -f /docker-entrypoint-initdb.d/schema.sql
docker compose exec -T db psql -U bidbattle -d bidbattle -c '\d candidate_lists'
```

`archived_at` sütunu görünmeli.

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

1. **Katalogda yerinde düzenleme:** Hiçbir listede olmayan bir adayın adını "Aday Kataloğu"nda Düzenle ile değiştir. Aynı kart güncellenir (yeni kayıt yok).
2. **Katalogda kopyalayarak düzenleme (senaryo 15):** Bir listede geçen adayı katalogda düzenle (görsel yüklemeden). Katalogda yeni adlı kart belirir, eski ad kaybolur. "Aday Listeleri"nde liste **eski adı ve görseli** göstermeye devam eder.
3. **Liste girişi düzenleme:** Listedeki bir adayı listedeki ✎ düğmesiyle düzenle. Sadece o liste yeni adı gösterir; başka liste ve katalogdaki eski kayıt değişmez.
4. **Taslak girişi düzenleme:** Taslaktaki (Güncel Taslak) bir adayı ✎ ile düzenle. Taslak `Bağımsız liste kopyası` notuna döner; kaynak listedeki ad değişmez.
5. **Yeniden adlandırma çatallanması (senaryo 14):** Kaynak listeden taslak aç, sadece adını değiştir. Kaynak listede sıra değiştir — taslak etkilenmez. Taslak adını geri alsan bile kopya durur.
6. **Paylaşılan taslak (senaryo 16):** Aynı listeden iki taslak aç. Kaynak listenin sırasını değiştir — ikisi de değişir. Birinde aday düzenle — sadece o bağımsızlaşır, diğeri takibe devam eder.
7. **Liste arşivleme:** "Aday Listeleri"nde bir listeyi Arşivle (onay diyaloğu çıkar). Liste seçimden kaybolur; ondan açılmış taslaklar ve içindeki aday adları durur.
8. **Arşivlenen aday görünürlüğü:** Arşivlenen aday, listelerde/taslaklarda adı ve görseliyle görünmeye devam eder; katalog aramasında çıkmaz.

## 6. API ile dene (isteğe bağlı)

Tek PowerShell oturumunda çalıştır (değişkenler oturumlar arası yaşamaz):

```powershell
Add-Type -AssemblyName System.Net.Http
$cands = Invoke-RestMethod -Uri 'http://localhost:3001/candidates'
$cands | Select-Object id, name | Select-Object -First 5
$lists = Invoke-RestMethod -Uri 'http://localhost:3001/lists'
$ref = $lists | Where-Object { $_.entries.Count -gt 0 } | Select-Object -First 1
$rid = $ref.entries[0]
Invoke-RestMethod -Uri ("http://localhost:3001/candidates/" + $rid) | Select-Object id, name, archived
$client = New-Object System.Net.Http.HttpClient
$form = New-Object System.Net.Http.MultipartFormDataContent
$form.Add((New-Object System.Net.Http.StringContent('Rehber Dogrulama')), 'name')
$resp = $client.PostAsync(("http://localhost:3001/candidates/" + $rid + "/edit"), $form).Result
$resp.Content.ReadAsStringAsync().Result
```

Dönen `id` farklı olmalı (yeni kayıt). Sonra arşivi ve liste bütünlüğünü kontrol et:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3001/candidates' | Where-Object { $_.id -eq $rid }
Invoke-RestMethod -Uri ("http://localhost:3001/candidates/" + $rid) | Select-Object id, name, archived
Invoke-RestMethod -Uri ("http://localhost:3001/lists/" + $ref.id) | Select-Object -ExpandProperty entries
Invoke-RestMethod -Uri ("http://localhost:3001/lists/" + $ref.id + "/archive") -Method Post
Invoke-RestMethod -Uri 'http://localhost:3001/lists' | Select-Object id, name
```

Beklenen: ilk komut boş döner (eski kayıt katalogda yok), `archived` `True` olur, liste hâlâ eski `id`'yi içerir, arşivlenen liste son listede görünmez.

## 7. Kapatma

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
docker compose stop db
```

## Komut yoksa ne yapmalı

- `5433` doluysa: `docker ps --format 'table {{.Names}}\t{{.Ports}}'` ile bak, çakışan servisi durdur.
- API `persistence failed` basıyorsa DB ayakta mı kontrol et (adım 2). Hata bilerek gösterilir, sahte kayıt yapılmaz.
- `archived_at does not exist` hatası alırsan adım 2'deki şema komutunu tekrar çalıştır.
- API eski davranıyorsa (`Cannot GET /candidates/...` gibi): portta eski sunucu çalışıyordur. Önce `Get-Process node | Stop-Process -Force` ile kapatıp adım 3'ten başlat.
