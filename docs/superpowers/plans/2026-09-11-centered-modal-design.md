# Centered Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tum ekleme, duzenleme ve onay pencereleri ekranin tam ortasinda acilir.

**Architecture:** `web/src/modal.tsx` ortak Modal bileseni + `web/src/app.css` overlay stilleri; mevcut `dialog` kullanimlari Modal icine tasinir, sayfa ici `create-row` formlari tetikleyici dugme + modal olur.

**Tech Stack:** React + TypeScript (web workspace), mevcut `dialog` ogesi, `app.css`.

## Global Constraints

- Mevcut i18n anahtarlarini yeniden kullan; yeni anahtar ekleme.
- `design.css` minified satirina dokunma; yeni stil `app.css` icine yaz.
- Odak yonetimi: acilista ilk alana odaklan, Escape ile kapat, kapaninca tetikleyiciye don.
- Basarili kayitta kapat; hatada girdileri koru, hatayi modal icinde goster.

---

### Task 1: Ortak Modal bileseni + merkezi stil

**Files:**
- Create: `web/src/modal.tsx`
- Modify: `web/src/app.css`

**Interfaces:**
- Consumes: React `useEffect`, `useRef`.
- Produces: `Modal({ titleId, onClose, children })` — fixed overlay, viewport merkezli kutu.

- [ ] **Step 1: Stil ekle**

```css
.modal-overlay{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;background:#2d2118aa;overflow-y:auto}
.modal-box{width:min(540px,100%);max-height:calc(100vh - 40px);overflow-y:auto}
.modal-box dialog{display:block;position:static;width:100%;max-height:none;margin:0}
```

Run: `npm run typecheck -w web` (beklenen: henuz degisiklik yok, PASS)

- [ ] **Step 2: Modal bilesenini yaz**

```tsx
import { useEffect, useRef, type ReactNode } from "react";
export function Modal({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);
  useEffect(() => {
    prevFocus.current = document.activeElement;
    const el = boxRef.current?.querySelector<HTMLElement>("input,textarea,select,button");
    el?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/modal.tsx web/src/app.css
git commit -m "feat(web): add centered modal shell"
```

### Task 2: Duzenleme ve onay diyaloglarini ortala

**Files:**
- Modify: `web/src/App.tsx:72-176` (`CandidateEditDialog`, `ConfirmDialog`)
- Modify: `web/src/battlefields.tsx:35-135` (`BattlefieldEditor`)

**Interfaces:**
- Consumes: `Modal` from Task 1.
- Produces: ayni prop sozlesmesi, sadece ortalanmis gorsel davranis.

- [ ] **Step 1: App.tsx diyaloglarini Modal ile sar**

`dialog open` yerine `Modal` + ic `dialog` (acik, overlay icinde statik) kullan.

- [ ] **Step 2: BattlefieldEditor ayni sarmalama**

Inline `style` kutusu korunur, dis overlay merkezler.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx web/src/battlefields.tsx
git commit -m "feat(web): center edit and confirm dialogs"
```

### Task 3: Ekleme formlarini modala tasi

**Files:**
- Modify: `web/src/App.tsx:373-480` (Catalog), `web/src/App.tsx:571-580,594-605,672-685,749-771` (Lists), `web/src/App.tsx:914-926,1160-1187` (AuctionWorkspace)

**Interfaces:**
- Consumes: `Modal`.
- Produces: sayfada tetikleyici dugme, form modal icinde; basarida kapat + alanlari sifirla.

- [ ] **Step 1: Catalog ekleme -> "Yeni aday" dugmesi + modal**
- [ ] **Step 2: Liste olusturma + "olustur ve ekle" ayri modallar**
- [ ] **Step 3: Taslak olusturma -> "Taslak olustur" dugmesi + modal**
- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): move create forms into centered modal"
```

### Task 4: Tarayici confirm kutusunu kaldir

**Files:**
- Modify: `web/src/battlefields.tsx:198-212`

**Interfaces:**
- Consumes: `ConfirmDialog` (App) veya yerel onay.

- [ ] **Step 1: Arsivleme icin `pendingArchive` state + ConfirmDialog kullan**

```tsx
const [pendingArchive, setPendingArchive] = useState<BattlefieldSummary | null>(null);
```

- [ ] **Step 2: Commit**

```bash
git add web/src/battlefields.tsx
git commit -m "feat(web): use centered confirm for battlefield archive"
```

### Task 5: Dogrulama

- [ ] **Step 1:** `npm run typecheck -w web` PASS
- [ ] **Step 2:** `npm run test -w web` PASS
- [ ] **Step 3:** Manuel: desktop + mobil, kaydirilmis sayfada merkez, uzun form ici kaydirma, Escape/overlay kapatma, odak donusu.
