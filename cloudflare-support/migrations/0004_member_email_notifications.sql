CREATE TABLE ticket_email_preferences (
  ticket_id TEXT PRIMARY KEY NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  email TEXT NOT NULL,
  verified_at INTEGER,
  verification_hash TEXT UNIQUE,
  verification_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ticket_email_outbox (
  message_id TEXT PRIMARY KEY NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  provider_id TEXT,
  last_error TEXT
);
CREATE INDEX ticket_email_outbox_ticket ON ticket_email_outbox(ticket_id,status);
