-- The owner's records: which assets were used, which x402 payments went through, and who —
-- visitor first, then their Mind once they connect one. See worker/records.js.
--
-- A VISITOR is the stable HMAC of the browser's `guestId` (worker/analytics.js guestHashFor),
-- never the raw id. A Mind is its real mindId. Times are epoch milliseconds.

CREATE TABLE visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE minds (
  mind_id TEXT PRIMARY KEY,
  name TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  -- Approved connect handshakes, not page loads.
  connections INTEGER NOT NULL DEFAULT 0
);

-- Which visitors are which Minds. Many-to-many on purpose: one Mind from two browsers is two
-- visitors, and one browser can connect two Minds in turn.
CREATE TABLE visitor_minds (
  visitor_id TEXT NOT NULL,
  mind_id TEXT NOT NULL,
  first_linked_at INTEGER NOT NULL,
  last_linked_at INTEGER NOT NULL,
  PRIMARY KEY (visitor_id, mind_id)
);
CREATE INDEX visitor_minds_mind ON visitor_minds (mind_id);

-- One row per approved connect handshake.
CREATE TABLE mind_connections (
  connection_id TEXT PRIMARY KEY,
  mind_id TEXT NOT NULL,
  visitor_id TEXT,
  approved_at INTEGER NOT NULL
);
CREATE INDEX mind_connections_mind ON mind_connections (mind_id, approved_at);

-- One row per asset per use. `stage`: 'cast' (the piece was cast — read by the Casting
-- Director, which is where x402 is paid), 'screenplay' (written into a film), 'rewrite' (the
-- same cast, rewritten with a note). A screenplay's rows share a `submission_id`.
--
-- `mind_id` is the Mind known at the time, and is filled in for a visitor's earlier guest rows
-- the moment that visitor connects (worker/records.js linkVisitor).
CREATE TABLE asset_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  stage TEXT NOT NULL,
  asset_key TEXT NOT NULL,
  chain TEXT,
  contract TEXT,
  token_id TEXT,
  name TEXT,
  collection TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  submission_id TEXT,
  visitor_id TEXT,
  mind_id TEXT
);
CREATE INDEX asset_inputs_at ON asset_inputs (at);
CREATE INDEX asset_inputs_asset ON asset_inputs (asset_key, at);
CREATE INDEX asset_inputs_visitor ON asset_inputs (visitor_id, at);
CREATE INDEX asset_inputs_mind ON asset_inputs (mind_id, at);

-- One row per x402 transaction. Reported by the browser (the only party the casting server
-- tells) and then checked on Base: nothing here is trusted until `status` is 'verified'.
--   pending   — reported, receipt not seen yet (the */5 cron keeps checking)
--   verified  — succeeded, and moved the x402 token
--   reverted  — mined, but failed
--   not_x402  — succeeded, but moved no x402 token
--   not_found — no receipt after every check
-- `role` is the casting stream's own label: the first hash is the creator's, the second the
-- owner's (src/components/canvas/AgentThought.jsx).
CREATE TABLE x402_payments (
  tx_hash TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  role TEXT,
  asset_key TEXT,
  visitor_id TEXT,
  mind_id TEXT,
  reported_at INTEGER NOT NULL,
  from_address TEXT,
  to_address TEXT,
  amount_raw TEXT,
  amount REAL,
  transfers INTEGER,
  block_number INTEGER,
  paid_at INTEGER,
  checked_at INTEGER,
  check_attempts INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX x402_payments_reported ON x402_payments (reported_at);
CREATE INDEX x402_payments_asset ON x402_payments (asset_key);
CREATE INDEX x402_payments_visitor ON x402_payments (visitor_id);
CREATE INDEX x402_payments_mind ON x402_payments (mind_id);
CREATE INDEX x402_payments_status ON x402_payments (status, reported_at);
