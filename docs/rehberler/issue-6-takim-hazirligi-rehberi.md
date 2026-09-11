# Issue #6 Dilimi — Tarayıcıda Deneme Rehberi

Bu dilimde neler var: taslakta **iki takım paneli** (ad, bayrak, slogan), satır içi **üye ekleme/düzenleme/silme**, ok düğmesiyle **paneller arası üye taşıma**, üyelerin altınından **hesaplanan takım toplamları** ve fark bandı. Eşitsiz bütçe **kaydı engellemez**, sadece bandı kırmızıya çevirir; eşitlik Son Kontrol'de istenir. Sıfır/negatif/kesirli altın ilgili alanın altında hata verir. Takımlar ve üyeler müzayedeye aittir, atomik kaydedilir. Son Kontrol'de savaş alanı/liste/takım özetleri, başlangıç kontrol listesi ve kilit notu var; **Başlat düğmesi bu dilimde bilerek pasif**.

Önkoşul: savaş alanları ve taslak adımları çalışır durumda olmalı.

## Tasarım

`.superpowers/brainstorm/49-1789040875` prototipindeki onaylı atlas görsel dünyası
(parşömen zemin, koyu kahve mürekkep, koyu yeşil detaylar, serif başlıklar) bu dilimde
uygulamaya gömülü: `web/src/design.css` içindeki `.team-pane`, `.member-row`,
`.balance-banner`, `.review-grid`, `.checklist` sınıfları. Takım ve Son Kontrol
adımları hazırlık akışının 3. ve 4. adımı olarak açık.

## 1. Hazırlık

```powershell
docker --version
node --version
```

## 2. Veritabanını başlat

```powershell
docker compose up -d db
docker compose exec -T db psql -U bidbattle -d bidbattle -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/schema.sql
```

`auction_teams` ve `auction_team_members` tabloları oluşmalı. (Eski `check_team_balance`
trigger'ı bu dilimde kaldırıldı; taslak eşitsizken de kaydedilebilir.)

## 3. API'yi başlat (http://localhost:3001)

```powershell
npm run build --prefix api
Start-Process -FilePath 'node' -ArgumentList 'dist/src/server.js' -WorkingDirectory "$PWD\api"
Start-Sleep -Seconds 3
Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 5
```

`ok: True` dönmeli. `3001` doluysa eski bir sunucu çalışıyordur:

```powershell
netstat -ano | Select-String '3001'
Stop-Process -Id <PID> -Force
```

## 4. Web'i başlat (http://localhost:5173)

Yeni bir PowerShell penceresinde:

```powershell
npm run dev --prefix web
```

Tarayıcıda `http://localhost:5173` aç.

## 5. Tarayıcıda dene

1. **Taslak aç:** "Müzayedeler" sekmesinde bir taslak oluştur ve aç (yoksa önce "Aday Listeleri"nden kaynak seç). Hazırlık adımlarının 4'ü de tıklanabilir olmalı.
2. **Takımlar adımına geç:** 3. adıma ("Takımlar") tıkla. İki yan yana panel, üstte bütçe bandı görünür.
3. **Takımları doldur:** Her panele ad + slogan yaz, bayrak düğmesiyle birer görsel yükle (png/jpeg/webp/gif). Bayraksız panele "Bayrak gerekli." uyarısı çıkar.
4. **Üye ekle:** "Üye ekle" ile satır ekle. Yeni üyenin altını `10` gelir. Adı boş bırak, altın kutusuna `0` yaz: iki alan da kırmızı çerçeve + mesaj göstermeli.
5. **Eşitsiz kaydet:** Toplamlar farklıyken "Kaydet"e bas. Kayıt başarılı olur ("Takımlar kaydedildi"), bant "Başlangıç bütçeleri eşit değil" + farkı gösterir. Sayfayı yenile: kayıtlar durur (sunucudan tekrar yüklenir).
6. **Üye taşı:** Bir satırdaki ok düğmesine bas. Üye diğer panele geçer, iki toplam da anında güncellenir.
7. **Eşitle:** Altınları iki toplam eşit olacak şekilde düzenle. Bant yeşile döner ("Başlangıç bütçeleri eşit"). Kaydet.
8. **Son Kontrol:** 4. adıma geç. Savaş alanı, aday listesi ve takım özetleri; sağda kontrol listesi görünür. Eksik varsa üstte hata özeti çıkar, her satır ilgili adıma götürür.
9. **Başlat pasif:** "Açık artırmayı başlat" düğmesi tıklanamaz; altında "Başlatma bu dilimde kapalı" notu ve hazırlık kilidi açıklaması vardır.
10. **Dil:** Sağ üstten Türkçe/English değiştir. Arayüz çevrilir, yazdığın takım/üye adları çevrilmez.

## 6. API ile dene (isteğe bağlı, sadece PowerShell)

Aşağıdaki 1 piksellik PNG bayrak olarak yeter:

```powershell
$png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
$draft = Invoke-RestMethod -Uri 'http://localhost:3001/auctions' -Method Post -ContentType 'application/json' -Body (@{ name = 'Rehber Deneme'; sourceListId = $null } | ConvertTo-Json)
$flag = @{ data = $png; mime = 'image/png'; name = 'bayrak.png' }
$teams = @{ teams = @(
  @{ name = 'Kuzey'; slogan = 'Birlik'; position = 0; flag = $flag; members = @(@{ name = 'Elif'; initialGold = 10; avatar = $null }) },
  @{ name = 'Guney'; slogan = 'Guc'; position = 1; flag = $flag; members = @(@{ name = 'Deniz'; initialGold = 20; avatar = $null }) }
) } | ConvertTo-Json -Depth 6
```

Eşitsiz toplamla kaydet (10'a karşı 20 — `200` dönmeli, engellenmemeli):

```powershell
Invoke-RestMethod -Uri ("http://localhost:3001/auctions/" + $draft.id + "/teams") -Method Post -ContentType 'application/json' -Body $teams | Select-Object name, position | Format-Table -AutoSize
Invoke-RestMethod -Uri ("http://localhost:3001/auctions/" + $draft.id + "/teams") | ForEach-Object { $_.name; $_.members | Select-Object name, initialGold | Format-Table -AutoSize }
```

Sıfır altın alan hatası vermeli (`400` + `fieldErrors` içinde `teams[0].members[0].initialGold`):

```powershell
$bozuk = $teams | ConvertFrom-Json
$bozuk.teams[0].members[0].initialGold = 0
try { Invoke-RestMethod -Uri ("http://localhost:3001/auctions/" + $draft.id + "/teams") -Method Post -ContentType 'application/json' -Body ($bozuk | ConvertTo-Json -Depth 6) }
catch { $_.ErrorDetails.Message }
```

Takım sayısı iki değilse reddedilir:

```powershell
try { Invoke-RestMethod -Uri ("http://localhost:3001/auctions/" + $draft.id + "/teams") -Method Post -ContentType 'application/json' -Body (@{ teams = @() } | ConvertTo-Json) }
catch { $_.ErrorDetails.Message }
```

## 7. Kapatma

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
docker compose stop db
```

## Komut yoksa ne yapmalı

- `5433`/`3001`/`5173` doluysa: `netstat -ano | Select-String '3001'` ile bak, çakışan `node` sürecini `Stop-Process -Id <PID> -Force` ile durdur.
- API `persistence failed` basıyorsa DB ayakta mı kontrol et (adım 2).
- Bayrak yüklemede `invalid image` alırsan dosya gerçekten png/jpeg/webp/gif olmalı; sunucu sihirli baytları doğrular.
- Takım adımı boş geliyorsa API'nin güncel derlemeden çalıştığını doğrula (adım 3'te `npm run build` şart).
