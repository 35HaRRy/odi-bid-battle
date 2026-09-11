# Team Preparation — Design (Issue #6)

Date: 2026-09-10. Status: Approved for implementation.

## Scope

Implement two-team preparation in auction drafts with member management, gold budgeting, and validation. This is slice #6 of the complete auction system.

**Included:**
- Team definitions (name, slogan, flag image)
- Member management (name, avatar, initial gold)
- Cross-team member transfer
- Real-time balance validation
- Preparation lock enforcement
- Review step with checklist

**Deferred to later:**
- Starting auction with validation (issue #3)
- Live auction with teams (issue #3)
- Final presentation (issue #3)

## Behavior

- Exactly two teams in side-by-side panels (Panel 1 and Panel 2)
- Each team has: name, slogan, flag image, and at least one member
- Each member has: name, optional avatar, positive integer initial gold (default 10)
- Teams are editable until starting the auction
- Member transfer moves a member from one team to the other with a directional button
- Total team gold is calculated from members, not entered separately
- Equality is required for all saved teams; temporary inequality is permitted while editing
- Zero gold is rejected with field-level validation
- Teams and members belong to the auction, not a shared catalog
- Creating a new draft from a previous auction reuses its team preparation information

## Data Model

**New tables:**

`sql
CREATE TABLE IF NOT EXISTS auction_teams (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0 AND char_length(btrim(name)) <= 200),
  slogan TEXT CHECK (char_length(btrim(slogan)) <= 500),
  flag_image BYTEA NOT NULL,
  flag_mime TEXT NOT NULL,
  flag_name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position IN (0, 1)), -- 0 = Panel 1, 1 = Panel 2
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
`

**Validation constraint:** Trigger on uction_team_members that checks total gold of both teams in the auction must be equal. Rejects INSERT/UPDATE with 	eam balance constraint: X vs Y error.

## API Contract

**GET** /auctions/:id/teams - Retrieve all teams for an auction
- Response: AuctionTeam[] (normalized for frontend)

**POST** /auctions/:id/teams - Save teams (full replace)
- Request body: { teams: AuctionTeam[] }
- Response: AuctionTeam[] (updated)

**Note:** Teams are persisted atomically per auction. The API replaces all existing teams with the submitted array. This simplifies implementation (no merge logic needed).

## Domain Layer (pi/src/domain.ts)

Add these interfaces and functions:

`	ypescript
export interface AuctionTeam {
  id: string;
  auctionId: string;
  name: string;
  slogan: string | null;
  flag: { buffer: Buffer; mime: string; name: string };
  position: 0 | 1;
  members: AuctionTeamMember[];
  createdAt: string;
}

export interface AuctionTeamMember {
  id: string;
  teamId: string;
  name: string;
  avatar: { buffer: Buffer | null; mime: string | null; name: string | null };
  initialGold: number;
  createdAt: string;
}

export function createAuctionTeam(
  auctionId: string,
  name: string,
  position: 0 | 1,
  opts: { slogan?: string; flag: ImageInput } = {}
): AuctionTeam { ... }

export function addTeamMember(
  team: AuctionTeam,
  name: string,
  initialGold: number,
  opts: { avatar?: ImageInput } = {}
): AuctionTeamMember { ... }

export function transferMember(
  members: AuctionTeamMember[],
  memberId: string,
  toPosition: 0 | 1
): AuctionTeamMember[] { ... }

export function calculateTeamTotal(members: AuctionTeamMember[]): number { ... }

export function validateTeamBalance(
  team1: AuctionTeam,
  team2: AuctionTeam
): { valid: boolean; error?: string } { ... }

export function validateAuctionPreparation(
  auction: AuctionDraft,
  teams: AuctionTeam[]
): { valid: boolean; errors: string[] } { ... }
`

## Store Layer (pi/src/store.ts)

Add to PgStore:

`	ypescript
async function writeTeamRecord(client: PoolClient, team: AuctionTeam): Promise<void>
async function writeTeamMembers(client: PoolClient, team: AuctionTeam): Promise<void>
async function saveAuctionTeams(auctionId: string, teams: AuctionTeam[]): Promise<void>
async function getAuctionTeams(auctionId: string): Promise<AuctionTeam[]>
`

**Implementation details:**
- saveAuctionTeams uses transaction to write teams and members atomically
- getAuctionTeams uses LEFT JOIN LATERAL to fetch members per team
- Flag and avatar images are resolved from DB rows (optionally merged with uploaded images)
- Error handling: PersistenceError with pgError() wrapper

## API Routes (pi/src/battlefield-routes.ts)

Add endpoints:

`	ypescript
app.get("/auctions/:id/teams", async (req, res) => { ... });
app.post("/auctions/:id/teams", async (req, res) => { ... });
`

**Validation:**
- GET: 404 if auction not found, 500 on persistence failure
- POST: 400 if body not an array, 409 on DB constraint violation, 500 on other errors

## Frontend Components

### web/src/draft-teams.tsx (new file)

Main team preparation component with two panels:

`	ypescript
interface DraftTeamsProps {
  lang: Lang;
  auction: Auction;
  onAuctionChange: (updated: Auction) => void;
  onBack: () => void;
  onNext: () => void;
}

export function DraftTeams({ lang, auction, onAuctionChange, onBack, onNext }: DraftTeamsProps)
`

**Features:**
- Two side-by-side team panels (Panel 1 / Panel 2)
- Team header with flag upload, name input, slogan input
- Member list with: avatar, name input, initial gold input, transfer button
- "Add Member" button below each member list
- Real-time balance banner showing totals and difference
- Inline validation with error text below invalid fields
- Save and Next buttons at bottom

**State management:**
- 	eams: Array of Team objects
- error: String for user-facing error messages
- Transfers happen on button click; save happens on Save button

**Interaction flow:**
1. Load teams on mount (pi.getAuctionTeams)
2. User edits fields ? real-time validation runs
3. If balance changes, update balance banner
4. Click "Add Member" ? push new empty member (gold=10)
5. Click "?" or "?" ? move member to other team, validate balance, save
6. Click "Save" ? persist changes, show error if invalid
7. Click "Next" ? go to review step

### web/src/draft-review.tsx (new file, simplified)

Review step with team summaries and checklist:

`	ypescript
interface DraftReviewProps {
  lang: Lang;
  auction: Auction;
  onAuctionChange: (updated: Auction) => void;
  onBack: () => void;
  onNext: () => void;
}

export function DraftReview({ lang, auction, onAuctionChange, onBack, onNext }: DraftReviewProps)
`

**Features:**
- Four-section review (battlefield, list, teams, checklist)
- Checklist items: team names, slogans, flags, member counts, gold validation, balance equality
- Edit buttons next to each section
- Preparation lock notice
- Start button (disabled if validation fails)

**Implementation:** Copy design from prototype eviewView() function, adapt to React.

### Integration into web/src/App.tsx

Add draft steps 2 and 3:

`	ypescript
{draftStep === 0 ? (
  <BattlefieldPreparation ... />
) : draftStep === 1 ? (
  <DraftList ... />
) : draftStep === 2 ? (
  <DraftTeams ... />
) : draftStep === 3 ? (
  <DraftReview ... />
) : null}
`

Update Steps component to enable all 4 steps (currently steps 2 and 3 are disabled).

### web/src/api.ts additions

`	ypescript
export async function getAuctionTeams(auctionId: string): Promise<AuctionTeam[]> { ... }
export async function saveAuctionTeams(auctionId: string, teams: AuctionTeam[]): Promise<AuctionTeam[]> { ... }
`

Convert images to base64 URLs for React <img> src attributes.

### web/src/design.css additions

Add styles for:
- .balance-banner - shows total gold for both teams
- .team-pane - panel for each team
- .team-head - team header with flag and name fields
- .member-columns - header row for member table
- .member-row - individual member row
- .member-actions - button group for member row

Match prototype CSS classes and tokens.

## i18n Keys

Add to web/src/i18n.ts:

`	ypescript
tr: {
  balanced: "Dengeli",
  unbalanced: "Dengesiz",
  difference: "Fark",
  gold: "altin",
  teamName: "Takim Adi",
  slogan: "Slogan",
  memberName: "Üye Adi",
  initialGold: "Baslangiç Altini",
  actions: "Eylemler",
  optional: "Opsiyonel",
  addMember: "Üye Ekle",
  moveMember: "Üye Tasi",
  requiredName: "Gerekli alan",
  invalidGold: "Geçersiz altin",
},

en: {
  balanced: "Balanced",
  unbalanced: "Unbalanced",
  difference: "Difference",
  gold: "gold",
  teamName: "Team Name",
  slogan: "Slogan",
  memberName: "Member Name",
  initialGold: "Initial Gold",
  actions: "Actions",
  optional: "Optional",
  addMember: "Add Member",
  moveMember: "Move Member",
  requiredName: "Required field",
  invalidGold: "Invalid gold",
}
`

## Testing

### Domain tests (pi/test/auction-domain.test.ts)

- createAuctionTeam creates team with correct fields
- ddTeamMember creates member with default gold (10)
- 	ransferMember moves member and updates position
- alidateTeamBalance returns { valid: false } when totals differ
- alidateAuctionPreparation returns errors for missing names, zero gold, unequal totals
- Invalid gold throws error, invalid names throw error
- Slogan can be empty or up to 500 chars

### Store tests (pi/test/auction-store.test.ts)

- saveAuctionTeams writes teams and members atomically in transaction
- getAuctionTeams returns members in position order
- Persistence errors propagate as PersistenceError
- Member totals are correctly calculated

### API tests (pi/test/auction-routes.test.ts)

- GET /auctions/:id/teams returns teams (404 if auction missing, 500 on DB error)
- POST /auctions/:id/teams validates teams array, returns updated teams (400/409/500)

### Web tests (web/src/draft-teams.test.ts)

- Component renders two panels
- Balance banner shows correct totals
- Transfer button moves member to other team
- Add member button appends empty member (gold=10)
- Invalid gold shows red border and error text
- Save button shows error banner if totals unequal

## Self-Review

**Placeholders scan:**
- None - all fields specified

**Internal consistency:**
- Team position (0/1) matches Panel 1/Panel 2 terminology
- Equal totals check runs after member updates
- Validation requires both teams have flags

**Scope check:**
- Teams and members belong to auction only (no shared catalog)
- Preparation lock enforced by existing attlefield-lock check (status !== 'draft')
- Starting validation deferred to issue #3
- Live auction deferred to issue #3

**Ambiguity check:**
- Team positions: 0 = Panel 1 first, 1 = Panel 2 second (explicit in UI)
- Member default gold: 10 (explicit, matches prototype)
- Transfer button direction: outward arrow from Panel 1 to Panel 2, inward arrow from Panel 2 to Panel 1 (explicit in UI)
- Slogan max length: 500 chars (matches existing slogan fields in other entities)

**Architecture:**
- Separates teams into dedicated tables with FK to auctions
- Trigger enforces balance constraint at DB level
- Domain functions provide pure validation logic
- Store layer handles atomic writes
- API layer is thin with error handling
- Frontend uses React state with real-time validation
