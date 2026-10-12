CREATE TABLE evidence_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0 AND bytes <= 419430400)
);
INSERT INTO evidence_usage (id,bytes) VALUES (1,0);
CREATE TABLE evidence_objects (
  object_key TEXT PRIMARY KEY NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 8388608),
  chunks INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE evidence_chunks (
  object_key TEXT NOT NULL REFERENCES evidence_objects(object_key) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (object_key,ordinal)
) WITHOUT ROWID;
-- Quota reservation and release happen in the same SQLite statement/transaction.
CREATE TRIGGER evidence_reserve BEFORE INSERT ON evidence_objects
BEGIN
  SELECT CASE WHEN (SELECT bytes FROM evidence_usage WHERE id=1) + NEW.size > 419430400
    THEN RAISE(ABORT,'evidence quota exceeded') END;
  UPDATE evidence_usage SET bytes=bytes+NEW.size WHERE id=1;
END;
CREATE TRIGGER evidence_release AFTER DELETE ON evidence_objects
BEGIN
  UPDATE evidence_usage SET bytes=bytes-OLD.size WHERE id=1;
END;
