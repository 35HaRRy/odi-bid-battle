# Delete Draft Auction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Müzayedeler" listesinde Taslak müzayede onaylı kalıcı silinebilsin.

**Architecture:** `PgStore.deleteDraftAuction` draft-kontrollü hard delete (cascade ile), `DELETE /auctions/:id` 204/404/409 eşlemesi, web `api.deleteAuction` + sadece-draft Sil butonu ve onay diyaloğu.

**Tech Stack:** TypeScript, Express, pg Postgres, React 18, Vitest.

## Global Constraints

- Taslak dışı (`ongoing`/`completed`) silinemez; buton gizli, backend 409 korur.
- Onay diyaloğu zorunlu; onaysız silme yok.
- Kalıcı silme; arşiv/undo yok.
- Kullanıcı içeriği (müzayede adı) çevrilmez; yeni i18n anahtarları TR+EN.
- `auction_entries`, `auction_teams` mevcut `ON DELETE CASCADE` ile temizlenir.

---

### Task 1: Store hard delete

**Files:**
- Modify: `api/src/store.ts` (after `renameAuction`, ~line 709)
- Test: `api/test/auction-store.test.ts`

**Interfaces:**
- Consumes: `this.q.query`, `pgError`, `PersistenceError`
- Produces: `deleteDraftAuction(id: string): Promise<void>` (missing → `auction not found`; non-draft → `only drafts can be deleted`)

- [ ] **Step 1: Write the failing test**

```ts
// append inside describe("pg auction persist/rehydrate") file, new it block
it("deletes drafts and refuses non-drafts", async () => {
  const store = await PgStore.connect(DATABASE_URL);
  try {
    const d = await store.saveAuction("Silinecek", null);
    await store.deleteDraftAuction(d.id);
    await expect(store.getAuction(d.id)).rejects.toThrow("auction not found");
    await expect(store.deleteDraftAuction("missing-id")).rejects.toThrow("auction not found");
  } finally {
    await store.close();
  }
}, 30000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter odi-bid-battle-api test -- auction-store -t "deletes drafts"`
Expected: FAIL with `store.deleteDraftAuction is not a function`

- [ ] **Step 3: Write minimal implementation**

```ts
async deleteDraftAuction(id: string): Promise<void> {
  try {
    const r = await this.q.query("SELECT status FROM auctions WHERE id=$1", [id]);
    const row = r.rows[0] as unknown as { status: string } | undefined;
    if (!row) throw new Error("auction not found");
    if (row.status !== "draft") throw new Error("only drafts can be deleted");
    await this.q.query("DELETE FROM auctions WHERE id=$1", [id]);
  } catch (err) {
    if ((err as Error).message === "auction not found" || (err as Error).message === "only drafts can be deleted") throw err;
    throw pgError("failed to delete auction", err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter odi-bid-battle-api test -- auction-store`
Expected: PASS (pg running at `postgres://bidbattle:bidbattle@localhost:5433/bidbattle`; if DB down, start via `docker compose up -d db`)

- [ ] **Step 5: Commit**

```bash
rtk git add api/src/store.ts api/test/auction-store.test.ts
rtk git commit -m "feat(api): add draft-only auction delete in store"
```

### Task 2: DELETE route

**Files:**
- Modify: `api/src/server.ts` (`toHttp` ~line 14, routes after `GET /auctions/:id` ~line 257)
- Test: `api/test/auction-routes.test.ts` (create)

**Interfaces:**
- Consumes: `store.deleteDraftAuction` from Task 1
- Produces: `DELETE /auctions/:id` → 204 success; 404 `not found`; 409 `only drafts can be deleted`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "node:http";
import { buildApp } from "../src/server.js";
import { PgStore } from "../src/store.js";

describe.sequential("DELETE /auctions/:id", () => {
  let store: PgStore; let server: Server; let base: string;
  beforeEach(async () => {
    store = await PgStore.connect(process.env.DATABASE_URL ?? "postgres://bidbattle:bidbattle@localhost:5433/bidbattle");
    const app = buildApp(store);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const addr = server.address();
    if (addr && typeof addr === "object") base = `http://127.0.0.1:${addr.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await store.pool?.end();
  });
  it("deletes draft, 409 on non-draft, 404 on missing", async () => {
    const draft = await (await fetch(`${base}/auctions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "D", sourceListId: null }) })).json();
    const del = await fetch(`${base}/auctions/${draft.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await fetch(`${base}/auctions/${draft.id}`)).status).toBe(404);
    expect((await fetch(`${base}/auctions/missing`, { method: "DELETE" })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter odi-bid-battle-api test -- auction-routes`
Expected: FAIL with 404 on DELETE (route not defined)

- [ ] **Step 3: Write minimal implementation**

```ts
// in toHttp, add before `return { status: 500 ... }`:
if (msg === "only drafts can be deleted") return { status: 409, body: "only drafts can be deleted" };

// after app.get("/auctions/:id", ...) block:
app.delete("/auctions/:id", async (req, res) => {
  try {
    await store.deleteDraftAuction(req.params.id);
    res.status(204).end();
  } catch (err) {
    const h = toHttp(err);
    return res.status(h.status).json({ error: h.body });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter odi-bid-battle-api test -- auction-routes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add api/src/server.ts api/test/auction-routes.test.ts
rtk git commit -m "feat(api): add DELETE /auctions/:id for drafts"
```

### Task 3: Web client + i18n keys

**Files:**
- Modify: `web/src/api.ts` (after `renameAuction`, ~line 239)
- Modify: `web/src/i18n.ts` (tr ~line 42, en ~line 187)
- Test: `web/src/auctions.test.ts`

**Interfaces:**
- Consumes: `DELETE /auctions/:id` from Task 2
- Produces: `api.deleteAuction(id): Promise<void>`; i18n keys `delete`, `deleteDraftTitle`, `deleteDraftText`, `deleted` (TR+EN)

- [ ] **Step 1: Write the failing test**

```ts
it("has delete-draft keys and client", async () => {
  for (const k of ["delete", "deleteDraftTitle", "deleteDraftText", "deleted"]) {
    expect(t("tr", k)).not.toBe(k);
    expect(t("en", k)).not.toBe(k);
  }
  expect(typeof api.deleteAuction).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter odi-bid-battle-web test -- auctions`
Expected: FAIL (`deleteAuction` undefined / keys equal key)

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/api.ts
async deleteAuction(id: string): Promise<void> {
  await check(await fetch(`${BASE}/auctions/${id}`, { method: "DELETE" }));
},
```

```ts
// web/src/i18n.ts tr:
delete: "Sil",
deleteDraftTitle: "Taslağı sil?",
deleteDraftText: "Bu taslak kalıcı olarak silinecek. Bu işlem geri alınamaz.",
deleted: "Taslak silindi.",
// en:
delete: "Delete",
deleteDraftTitle: "Delete this draft?",
deleteDraftText: "This draft will be permanently deleted. This cannot be undone.",
deleted: "Draft deleted.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter odi-bid-battle-web test -- auctions`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add web/src/api.ts web/src/i18n.ts web/src/auctions.test.ts
rtk git commit -m "feat(web): add deleteAuction client and i18n keys"
```

### Task 4: Auctions table delete UI

**Files:**
- Modify: `web/src/App.tsx` (`AuctionWorkspace`, table ~line 1183, `ConfirmDialog` ~line 141)
- Test: `web/src/auctions.test.ts` (extend with fetch-mock delete test)

**Interfaces:**
- Consumes: `api.deleteAuction`, i18n keys from Task 3
- Produces: draft-only Sil button + confirm flow; success removes row and clears `activeId`/`obb-selected-auction` when needed

- [ ] **Step 1: Write the failing test**

```ts
it("calls DELETE /auctions/:id on deleteAuction", async () => {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  // @ts-expect-error stub
  globalThis.fetch = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(null, { status: 204 });
  };
  try {
    await api.deleteAuction("auc-1");
    expect(calls.some((c) => c.includes("DELETE") && c.includes("/auctions/auc-1"))).toBe(true);
  } finally {
    globalThis.fetch = orig;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter odi-bid-battle-web test -- auctions`
Expected: FAIL before Task 3; after Task 3 passes — this step locks client contract before UI wiring

- [ ] **Step 3: Write minimal implementation**

```tsx
// AuctionWorkspace state (near useState block):
const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

async function confirmDeleteDraft() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  setPendingDeleteId(null);
  try {
    await api.deleteAuction(id);
    setAuctions((ls) => ls.filter((x) => x.id !== id));
    if (activeId === id) {
      setActiveId(null);
      localStorage.removeItem("obb-selected-auction");
      onBackToAuctions();
    }
    onError(null);
  } catch {
    onError(t(lang, "persistFail"));
  }
}

// table record-actions (after open/resume button):
{a.status === "draft" && (
  <button className="secondary small-btn" onClick={() => setPendingDeleteId(a.id)}>
    {t(lang, "delete")}
  </button>
)}

// below table (before closing section):
{pendingDeleteId && (
  <ConfirmDialog
    lang={lang}
    title={t(lang, "deleteDraftTitle")}
    body={t(lang, "deleteDraftText")}
    confirmLabel={t(lang, "delete")}
    danger
    onCancel={() => setPendingDeleteId(null)}
    onConfirm={confirmDeleteDraft}
  />
)}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter odi-bid-battle-web test -- auctions`
Expected: PASS
Run: `pnpm --filter odi-bid-battle-web typecheck`
Expected: PASS with no errors

- [ ] **Step 5: Commit**

```bash
rtk git add web/src/App.tsx web/src/auctions.test.ts
rtk git commit -m "feat(web): delete draft auction with confirm"
```
