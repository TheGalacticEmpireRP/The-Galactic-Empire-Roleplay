CREATE TABLE staff_login_credentials (
  email TEXT PRIMARY KEY NOT NULL REFERENCES staff(email) ON DELETE CASCADE,
  identity_id TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  credential_version TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX staff_sessions_email ON staff_sessions(email,issued_at);
CREATE INDEX staff_sessions_expiry ON staff_sessions(expires_at);
