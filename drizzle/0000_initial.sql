CREATE TABLE records (kind TEXT NOT NULL, id TEXT NOT NULL, trip_id TEXT, revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind,id));
--> statement-breakpoint
CREATE INDEX records_trip ON records(kind,trip_id,updated_at);
--> statement-breakpoint
CREATE INDEX records_updated ON records(kind,updated_at);
