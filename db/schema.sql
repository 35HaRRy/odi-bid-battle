BEGIN;

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  image BYTEA NOT NULL,
  image_mime TEXT NOT NULL,
  image_name TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS candidate_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 0 AND 200),
  is_draft BOOLEAN NOT NULL DEFAULT TRUE,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS list_entries (
  list_id TEXT NOT NULL REFERENCES candidate_lists(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (list_id, candidate_id),
  UNIQUE (list_id, position)
);
CREATE INDEX IF NOT EXISTS idx_entries_list ON list_entries(list_id, position);
CREATE TABLE IF NOT EXISTS battlefields (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  geography TEXT NOT NULL CHECK (char_length(btrim(geography)) > 0),
  history TEXT NOT NULL CHECK (char_length(btrim(history)) > 0),
  image BYTEA NOT NULL CHECK (octet_length(image) > 0),
  image_mime TEXT NOT NULL,
  image_name TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 0 AND 200),
  source_list_id TEXT REFERENCES candidate_lists(id) ON DELETE SET NULL,
  follows_source BOOLEAN NOT NULL DEFAULT TRUE,
  battlefield_id TEXT,
  preparation JSONB NOT NULL DEFAULT '{}',
  simulation_prompt_template TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ongoing','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS simulation_prompt_template TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS auction_entries (
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (auction_id, candidate_id),
  UNIQUE (auction_id, position)
);
CREATE INDEX IF NOT EXISTS idx_auction_entries_auction ON auction_entries(auction_id, position);

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

-- Equal budgets are a readiness rule checked in review, not a storage rule:
-- drafts must remain saveable while temporarily unequal.
DROP TRIGGER IF EXISTS check_team_balance ON auction_team_members;
DROP FUNCTION IF EXISTS validate_team_balance();

-- Staged team images: each file is uploaded on its own so the combined
-- team payload never has to carry every flag/avatar in a single request.
-- Rows are draft-scoped, expire after 24h, and are consumed atomically by
-- the team save (unused rows are pruned opportunistically).
CREATE TABLE IF NOT EXISTS auction_team_image_uploads (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  image BYTEA NOT NULL CHECK (octet_length(image) > 0),
  image_mime TEXT NOT NULL,
  image_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_image_uploads_auction ON auction_team_image_uploads(auction_id, created_at);

-- Upgrade existing databases without discarding legacy selections or image data.
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_image BYTEA;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_mime TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_name TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS battlefield_geography TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS battlefield_history TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS battlefield_image BYTEA;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS battlefield_image_mime TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS battlefield_image_name TEXT;
DO $$
DECLARE
  missing_ids TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auctions_battlefield_id_fkey'
      AND conrelid = 'auctions'::regclass
  ) THEN
    SELECT string_agg(DISTINCT quote_literal(a.battlefield_id), ', ' ORDER BY quote_literal(a.battlefield_id))
      INTO missing_ids
      FROM auctions a
      WHERE a.battlefield_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM battlefields b WHERE b.id = a.battlefield_id);
    IF missing_ids IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot migrate: missing battlefield IDs: %', missing_ids;
    END IF;
    ALTER TABLE auctions ADD CONSTRAINT auctions_battlefield_id_fkey
      FOREIGN KEY (battlefield_id) REFERENCES battlefields(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_auctions_battlefield ON auctions(battlefield_id);

-- Live bidding rounds (issue #8): alternating rounds with member
-- contributions and strictly increasing confirmed bids. Confirming a bid
-- deducts no gold; only a confirmed sale (later slice) deducts.
-- Balances seed from member initial gold; acquired rows are written by sales.
CREATE TABLE IF NOT EXISTS auction_live_state (
  auction_id TEXT PRIMARY KEY REFERENCES auctions(id) ON DELETE CASCADE,
  cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  active_candidate_id TEXT,
  turn INTEGER NOT NULL DEFAULT 0 CHECK (turn IN (0, 1)),
  special_pass BOOLEAN NOT NULL DEFAULT FALSE,
  latest_team INTEGER CHECK (latest_team IN (0, 1)),
  latest_amount INTEGER CHECK (latest_amount IS NULL OR latest_amount > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auction_live_balances (
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES auction_team_members(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  PRIMARY KEY (auction_id, member_id)
);
CREATE TABLE IF NOT EXISTS auction_live_contributions (
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES auction_team_members(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (auction_id, member_id)
);
CREATE TABLE IF NOT EXISTS auction_live_latest (
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES auction_team_members(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (auction_id, member_id)
);
CREATE TABLE IF NOT EXISTS auction_live_skipped (
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (auction_id, candidate_id)
);
CREATE TABLE IF NOT EXISTS auction_live_acquired (
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  team_position INTEGER NOT NULL CHECK (team_position IN (0, 1)),
  price INTEGER NOT NULL CHECK (price > 0),
  PRIMARY KEY (auction_id, candidate_id)
);

-- Undo history (issue #11): strict reverse-order snapshots of the latest
-- confirmed live action. Each entry stores the full pre-action live state so
-- undo restores round, drafts, balances, acquisitions, skips, and status
-- together without touching preparation tables.
CREATE TABLE IF NOT EXISTS auction_live_history (
  id SERIAL PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_history_auction ON auction_live_history(auction_id, id);

COMMIT;
