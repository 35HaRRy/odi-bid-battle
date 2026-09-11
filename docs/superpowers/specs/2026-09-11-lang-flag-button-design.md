# Dil Seçimi: Dropdown → Bayraklı Segment Buton

Tarih: 2026-09-11
Durum: onaylı tasarım (Yaklaşım A)
Kapsam: `web/src/App.tsx` masthead, `web/src/design.css`

## Amaç

Header'daki `select` dil seçici kaldırılır. Yerine iki bayraklı segment buton gelir: 🇹🇷 / 🇬🇧. Sadece ikon görünür.

## Kararlar

- Davranış: ikili segment (tek toggle değil, menü değil).
- Gösterim: sadece bayrak emoji, metin yok.
- Erişilebilirlik: `role="group"`, `aria-label`, her butonda `aria-pressed`, `aria-label` + `title` (Türkçe / English).

## Mimari

Sadece sunum katmanı değişir. `i18n.ts` (`getLang`, `setLang`, `t`, `Lang`) aynen kalır. `switchLang` aynen kalır.

## Bileşen

Mevcut (`App.tsx` ~1490-1501):

- `label` + `select` + 2x `option` kaldırılır.

Yeni:

- `div.lang-switch[role=group][aria-label=Dil / Language]`
- 2x `button[type=button]`:
  - TR: `🇹🇷`, `aria-label="Türkçe"`, `title="Türkçe"`, `aria-pressed={lang === "tr"}`
  - EN: `🇬🇧`, `aria-label="English"`, `title="English"`, `aria-pressed={lang === "en"}`
- `onClick` → `switchLang("tr" | "en")`.
- Aktif buton tıklanabilir kalır (idempotent), görsel vurgu alır.

## Stil (`design.css`)

- `.lang-switch`: flex, gap 4px, parşömen temaya uygun kenarlık.
- Butonlar: min 32x32 dokunma hedefi, emoji 18px.
- Aktif: `aria-pressed="true"` vurgulu (yeşil alt çizgi / dolgu).
- `:focus-visible` halka korunur.
- Mevcut `.header-tools select` kuralı kaldırılır / ölü bırakılmaz.
- Mobil kırılımda masthead taşması yok.

## Veri akışı

`click` → `switchLang` → `setL` + `localStorage("obb-lang")` → re-render → `document.documentElement.lang` güncellenir. Müzayede state, taslak, liste etkilenmez.

## Hata yönetimi

Senkron local işlem. Hata yolu yok. Mevcut `persistFail` akışı değişmez.

## Test

- Manuel: TR→EN→TR geçiş, metinler değişir; yenilemede dil kalır; `localStorage obb-lang` doğrulanır; klavye Tab+Enter çalışır; ekran okuyucu etiketi okunur.
- Otomatik: mevcut `web/src/i18n.test.ts` etkilenmez. Yeni anahtar yok.
- Kapsam dışı: 3. dil, menü/popover, emoji yerine SVG bayrak.

## Dosyalar

- Değişir: `web/src/App.tsx`, `web/src/design.css`.
- Değişmez: `web/src/i18n.ts`.
