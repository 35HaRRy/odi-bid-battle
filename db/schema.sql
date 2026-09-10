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
