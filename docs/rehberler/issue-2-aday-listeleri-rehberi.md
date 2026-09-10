# Issue #2 Dilimi — Tarayıcıda Deneme Rehberi

Bu dilimde neler var: aday kataloğu (ad + görsel) ve aday listeleri
(adlı, sıralı, taslak). Görseller Local Postgres'te `bytea` kopya olarak
durur. Aynı aday bir listede iki kez olamaz (409 + uyarı). Arayüz TR
varsayılan + EN destekler, kullanıcı adları çevrilmez. Kayıt hatası
banner gösterir, sahte-kaydedilmiş gibi davranmaz.

Diğer menüler (Müzayedeler, Savaş Alanları) bu dilimde pasif.

## 1. Hazırlık

```powershell
docker --version
node --version
```

## 2. Veritabanını başlat

```powershell
docker compose up -d db
docker exec odi-bid-battle-db-1 psql -U bidbattle -d bidbattle -c '\dt'
```

`candidates`, `candidate_lists`, `list_entries` görünmeli.

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

1. **Katalog:** Ad yaz + görsel seç + Oluştur. Liste altında küçük
   görselle görünmeli.
2. **Listeler:** Yeni Liste kaydet, listeyi seç, "Mevcut aday ekle"den
   aday ekle. Aynı adayı tekrar ekle → "Aynı aday listede iki kez
   olamaz" hatası (409).
3. **Sırala:** Yukarı/Aşağı düğmeleri sırayı değiştirir. Sayfayı
   yenile, sıra korunur (PG'den okunur).
4. **Yeni aday oluştur ve ekle:** Liste içinden ad + görsel ver,
   hem kataloğa hem listeye eklenir.
5. **Arşivle:** Katalogda Arşivle → aday katalogdan kaybolur ama
   listedeki kaydı kalır.
6. **Dil:** Sağ üstten Türkçe/English değiştir. Arayüz değişir,
   aday adları değişmez. Tercih `localStorage`da saklanır.
7. **Restart:** API penceresini kapatıp tekrar başlat, sayfayı
   yenile. Liste + görseller durur (uygulama kopyası).

## 6. Kapatma

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
docker compose stop db
```

## Komut yoksa ne yapmalı

- `5433` doluysa: `docker ps --format 'table {{.Names}}\t{{.Ports}}'`
  ile bak, çakışan servisi durdur.
- API `persistence failed` basıyorsa DB ayakta mı kontrol et
  (adım 2). Hata bilerek gösterilir, sahte kayıt yapılmaz.
