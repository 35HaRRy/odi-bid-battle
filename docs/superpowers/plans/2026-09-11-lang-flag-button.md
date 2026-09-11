# Lang Flag Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Header dil seçiciyi select dropdown'dan 🇹🇷/🇬🇧 segment butona çevir.

**Architecture:** Sadece sunum değişir. `App.tsx` masthead'de `select` kalkar, `role=group` segment gelir. `design.css`'e `.lang-switch` stili eklenir. `i18n.ts` ve `switchLang` akışı aynen kalır.

**Tech Stack:** React 18 + TS, Vite, Vitest, `web/src/design.css` parşömen tema.

## Global Constraints

- `web/src/i18n.ts` değişmez, yeni i18n anahtarı yok.
- Müzayede state, taslak, liste etkilenmez.
- Aktif buton `aria-pressed="true"` taşır, `min 32x32` dokunma hedefi korunur.
- `document.documentElement.lang` akışı korunur, `localStorage("obb-lang")` korunur.

---

### Task 1: App.tsx segment buton

**Files:**
- Modify: `web/src/App.tsx:1490-1502`
- Test: `web/src/i18n.test.ts`

**Interfaces:**
- Consumes: `switchLang(l: Lang)`, `lang: Lang` (mevcut, `App.tsx:1441,1470-1473`)
- Produces: `div.lang-switch` segment DOM (Task 2'nin stil hedefi)

- [ ] **Step 1: Mevcut bloğu doğrula**

Run: `npx tsc --noEmit -p web`
Expected: PASS (değişim öncesi baz yeşil)

- [ ] **Step 2: Select bloğunu segment ile değiştir**

`web/src/App.tsx:1490-1502` eski:

```tsx
<div className="header-tools">
  <label>
    {t(lang, "language")}{" "}
    <select
      aria-label={t(lang, "language")}
      value={lang}
      onChange={(e) => switchLang(e.target.value as Lang)}
    >
      <option value="tr">Türkçe</option>
      <option value="en">English</option>
    </select>
  </label>
</div>
```

Yeni:

```tsx
<div className="header-tools">
  <div className="lang-switch" role="group" aria-label={t(lang, "language")}>
    <button
      type="button"
      aria-label="Türkçe"
      title="Türkçe"
      aria-pressed={lang === "tr"}
      onClick={() => switchLang("tr")}
    >
      <span aria-hidden="true">🇹🇷</span>
    </button>
    <button
      type="button"
      aria-label="English"
      title="English"
      aria-pressed={lang === "en"}
      onClick={() => switchLang("en")}
    >
      <span aria-hidden="true">🇬🇧</span>
    </button>
  </div>
</div>
```

Not: `Lang` importu kalır (hala `switchLang("tr")` tipinde kullanılır). `t` importu kalır (aria-label için kullanılır).

- [ ] **Step 3: Typecheck geçir**

Run: `npm run typecheck -w web`
Expected: PASS, hata yok.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): replace lang select with flag segment"
```

### Task 2: design.css lang-switch stili

**Files:**
- Modify: `web/src/design.css:220-229` (header-tools bloğu yakını) ve `web/src/design.css:2538-2545` (responsive `header-tools select` kuralı)
- Test: `web/dist` build (CSS derlenir, görsel regresyon manuel)

**Interfaces:**
- Consumes: Task 1'in ürettiği `div.lang-switch > button[aria-pressed]` DOM'u
- Produces: Görsel segment görünümü (Task 3'te doğrulanır)

- [ ] **Step 1: `.header-tools select` kuralını kaldır, `.lang-switch` ekle**

`web/src/design.css:226-229` eski:

```css
.header-tools select {
    min-height: 32px;
    padding: 4px 8px
}
```

Yeni:

```css
.lang-switch {
    display: flex;
    gap: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 2px;
    background: var(--pale, transparent)
}

.lang-switch button {
    min-width: 36px;
    min-height: 32px;
    padding: 2px 8px;
    font-size: 18px;
    line-height: 1;
    border: 0;
    border-radius: 6px;
    background: transparent;
    cursor: pointer
}

.lang-switch button[aria-pressed="true"] {
    background: var(--green);
    color: #fff
}

.lang-switch button:focus-visible {
    outline: 2px solid var(--green);
    outline-offset: 2px
}
```

- [ ] **Step 2: Alttaki responsive select kuralını kaldır**

`web/src/design.css:2542-2545` eski:

```css
.header-tools select {
    min-width: 90px;
    flex-shrink: 0
}
```

Bu blok tamamen silinir (yerine bir şey eklenmez). `.header-tools { flex-shrink: 0 }` kalır.

- [ ] **Step 3: Build geçir**

Run: `npm run build -w web`
Expected: PASS, `web/dist` üretilir.

- [ ] **Step 4: Commit**

```bash
git add web/src/design.css
git commit -m "feat(web): style lang flag segment"
```

### Task 3: Doğrulama

**Files:**
- Test: `web/src/i18n.test.ts`, manuel tarayıcı kontrolü
- Modify: yok

**Interfaces:**
- Consumes: Task 1 + Task 2 çıktısı
- Produces: Çalışan dil geçişi, yeşil test/build

- [ ] **Step 1: Web testleri koştur**

Run: `npm run test -w web`
Expected: PASS (tüm vitest dosyaları yeşil, `i18n.test.ts` dahil)

- [ ] **Step 2: Ölü `select` referansı kalmadığını doğrula**

Run: `npx tsc --noEmit -p web`
Expected: PASS; ayrıca `header-tools select` metni `web/src/design.css` içinde geçmemeli.

- [ ] **Step 3: Manuel kontrol (tarayıcı)**

1. `npm run dev -w web` ile aç.
2. Header'da 🇹🇷 / 🇬🇧 segment görünür, aktif dil vurgulu.
3. 🇬🇧 bas → arayüz İngilizce; yenile → İngilizce kalır (`localStorage obb-lang=en`).
4. 🇹🇷 bas → Türkçe; Tab+Enter ile klavye çalışır.
5. Müzayede/taslak state değişmez.

- [ ] **Step 4: Commit (sadece gerekirse)**

Doğrulama sırasında kod değişirse:

```bash
git add -A
git commit -m "fix(web): verify lang flag segment"
```

Değişiklik yoksa bu step "yok" diye geçilir, boş commit atılmaz.
