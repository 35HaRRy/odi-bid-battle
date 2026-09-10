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
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ongoing','completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
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

-- Upgrade existing databases without discarding legacy selections or image data.
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_image BYTEA;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_mime TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS background_name TEXT;
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

COMMIT;
