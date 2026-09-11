# Team Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two-team preparation in auction drafts with member management, gold budgeting, validation, and review step.

**Architecture:** Add dedicated `auction_teams` and `auction_team_members` tables with foreign keys to auctions, a database trigger to enforce balance equality, domain validation functions, store methods, API endpoints, and React preparation step 2/3 components.

**Tech Stack:** TypeScript, Node.js, Express, PostgreSQL, React, Vite, Vitest

## Global Constraints

- Exactly two teams per auction (Panel 1 and Panel 2)
- Each team has a name, slogan, flag image, and at least one member
- Each member has a name, optional avatar, and positive integer initial gold defaulting to 10
- Team initial gold is calculated from member initial gold, not entered separately
- Both teams must have equal total initial gold at start
- Zero or negative initial gold is rejected at validation with field-level errors
- Teams and members belong to their auction, not a shared reusable catalog
- Reopening or cloning an auction reuses its preparation information

---

### Task 1: Database Schema & Migration

**Files:**
- Modify: `db/schema.sql`
- Test: `api/test/auction-store.test.ts`

**Interfaces:**
- Consumes: Existing `auctions` table
- Produces: `auction_teams` and `auction_team_members` tables, plus `check_team_balance` trigger

- [ ] **Step 1: Write SQL migration / schema additions**

```sql
CREATE TABLE IF NOT EXISTS auction_teams (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0 AND char_length(btrim(name)) <= 200),
  slogan TEXT CHECK (char_length(btrim(slogan)) <= 500),
  flag_image BYTEA NOT NULL,
  flag_mime TEXT NOT NULL,
  flag_name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auction_team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES auction_teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) <= 200),
  avatar_image BYTEA,
  avatar_mime TEXT,
  avatar_name TEXT,
  initial_gold INTEGER NOT NULL CHECK (initial_gold > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION validate_team_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1 FROM auction_team_members m1
      JOIN auction_teams t1 ON m1.team_id = t1.id
      WHERE t1.auction_id = (SELECT auction_id FROM auction_teams WHERE id = NEW.team_id)
      GROUP BY t1.id
      HAVING SUM(m1.initial_gold) <> COALESCE((
        SELECT COALESCE(SUM(m2.initial_gold), 0)
        FROM auction_team_members m2
        JOIN auction_teams t2 ON m2.team_id = t2.id
        WHERE t2.auction_id = (SELECT auction_id FROM auction_teams WHERE id = NEW.team_id) AND t2.id <> t1.id
      ), 0)
    ) THEN
      RAISE EXCEPTION 'team balance constraint: both teams must have equal total gold';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_team_balance ON auction_team_members;
CREATE TRIGGER check_team_balance
  AFTER INSERT OR UPDATE ON auction_team_members
  FOR EACH ROW
  EXECUTE FUNCTION validate_team_balance();
```

- [ ] **Step 2: Run test to verify schema applies correctly**

Run: `npm test` inside `api` directory
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add db/schema.sql
git commit -m "feat: add auction teams and members schema with balance trigger"
```

---

### Task 2: Domain Layer & Unit Tests

**Files:**
- Modify: `api/src/domain.ts`
- Test: `api/test/auction-domain.test.ts`

**Interfaces:**
- Consumes: Existing domain types (`AuctionDraft`)
- Produces: `AuctionTeam`, `AuctionTeamMember`, `createAuctionTeam`, `addTeamMember`, `transferMember`, `calculateTeamTotal`, `validateTeamBalance`, `validateAuctionPreparation`

- [ ] **Step 1: Write failing tests in `api/test/auction-domain.test.ts`**

```typescript
import {
  createAuctionTeam,
  addTeamMember,
  transferMember,
  calculateTeamTotal,
  validateTeamBalance,
  validateAuctionPreparation,
  type AuctionTeam,
} from "../src/domain.js";

describe("auction teams domain", () => {
  it("creates a team and calculates total gold", () => {
    const team = createAuctionTeam("a-1", "Kuzey", 0, {
      flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" },
    });
    addTeamMember(team, "Elif", 10);
    addTeamMember(team, "Deniz", 15);
    expect(team.name).toBe("Kuzey");
    expect(calculateTeamTotal(team.members)).toBe(25);
  });

  it("validates team balance", () => {
    const t1 = createAuctionTeam("a-1", "T1", 0, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    const t2 = createAuctionTeam("a-1", "T2", 1, { flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" } });
    addTeamMember(t1, "A", 10);
    addTeamMember(t2, "B", 20);
    expect(validateTeamBalance(t1, t2).valid).toBe(false);
    
    addTeamMember(t1, "C", 10);
    expect(validateTeamBalance(t1, t2).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest api/test/auction-domain.test.ts`
Expected: FAIL (functions not defined)

- [ ] **Step 3: Implement domain logic in `api/src/domain.ts`**

Add interfaces and functions for teams, members, transfers, and preparation validation.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest api/test/auction-domain.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/domain.ts api/test/auction-domain.test.ts
git commit -m "feat: add auction team domain logic and unit tests"
```

---

### Task 3: Store Layer & Integration Tests

**Files:**
- Modify: `api/src/store.ts`
- Test: `api/test/auction-store.test.ts`

**Interfaces:**
- Consumes: Domain team types
- Produces: `saveAuctionTeams`, `getAuctionTeams` methods on `PgStore`

- [ ] **Step 1: Write failing store test in `api/test/auction-store.test.ts`**

```typescript
it("saves and loads auction teams atomically", async () => {
  const auction = await store.saveAuction("Test", null);
  const team = createAuctionTeam(auction.id, "Team 1", 0, {
    flag: { buffer: Buffer.from("f"), mime: "image/png", name: "f.png" },
  });
  addTeamMember(team, "M1", 10);
  await store.saveAuctionTeams(auction.id, [team]);
  const loaded = await store.getAuctionTeams(auction.id);
  expect(loaded).toHaveLength(1);
  expect(loaded[0].name).toBe("Team 1");
  expect(loaded[0].members).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest api/test/auction-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement store methods in `api/src/store.ts`**

Add `saveAuctionTeams` and `getAuctionTeams`.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest api/test/auction-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/store.ts api/test/auction-store.test.ts
git commit -m "feat: add store methods for auction teams persistence"
```

---

### Task 4: API Routes & Server Integration

**Files:**
- Modify: `api/src/battlefield-routes.ts`, `api/src/server.ts`
- Test: `api/test/auction-routes.test.ts` (or equivalent test file)

**Interfaces:**
- Consumes: Store team methods
- Produces: `GET /auctions/:id/teams`, `POST /auctions/:id/teams`

- [ ] **Step 1: Add team routes to `api/src/battlefield-routes.ts`**

Implement GET and POST endpoints with proper error handling (400, 404, 409, 500).

- [ ] **Step 2: Run existing backend tests**

Run: `npm test` in `api` directory
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add api/src/battlefield-routes.ts api/src/server.ts
git commit -m "feat: add API endpoints for auction teams"
```

---

### Task 5: Web API Client & i18n

**Files:**
- Modify: `web/src/api.ts`, `web/src/i18n.ts`, `web/src/i18n.test.ts`
- Test: `web/src/i18n.test.ts`

**Interfaces:**
- Consumes: API endpoints
- Produces: `api.getAuctionTeams`, `api.saveAuctionTeams`, plus i18n keys for teams and review steps.

- [ ] **Step 1: Update `web/src/api.ts` and `web/src/i18n.ts`**

Add frontend API methods and TR/EN translation keys.

- [ ] **Step 2: Run i18n tests**

Run: `npx vitest web/src/i18n.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts web/src/i18n.ts web/src/i18n.test.ts
git commit -m "feat: add frontend API methods and i18n for teams"
```

---

### Task 6: Web Components (`DraftTeams` & `DraftReview`)

**Files:**
- Create: `web/src/draft-teams.tsx`, `web/src/draft-review.tsx`
- Modify: `web/src/App.tsx`, `web/src/design.css`
- Test: `web/src/auctions.test.ts`

**Interfaces:**
- Consumes: Team API methods and i18n keys
- Produces: Step 2 (`DraftTeams`) and Step 3 (`DraftReview`) in auction preparation workflow.

- [ ] **Step 1: Create `web/src/draft-teams.tsx` and `web/src/draft-review.tsx`**

Implement team preparation panels, member management, transfer controls, balance banner, and review checklist.

- [ ] **Step 2: Update `web/src/App.tsx` and `web/src/design.css`**

Integrate steps 2 and 3 into `AuctionWorkspace` and add corresponding CSS rules.

- [ ] **Step 3: Run full web test suite**

Run: `npx vitest web/src`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/draft-teams.tsx web/src/draft-review.tsx web/src/App.tsx web/src/design.css web/src/auctions.test.ts
git commit -m "feat: add draft teams and review components with UI styling"
```

---

### Task 7: Final Verification & Typechecking

**Files:**
- Verify: Full codebase

- [ ] **Step 1: Run typechecking and tests across api and web**

Run: `npm run build` or `npx tsc --noEmit` in both directories, plus full test run.
Expected: PASS with zero errors.

- [ ] **Step 2: Commit any final adjustments**

```bash
git commit -m "chore: final verification and typechecking for team preparation slice"
```
