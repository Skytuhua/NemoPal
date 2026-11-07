CREATE TABLE IF NOT EXISTS owners (
 id uuid PRIMARY KEY, timezone text NOT NULL, reminders boolean NOT NULL DEFAULT false,
 quiet_start integer NOT NULL DEFAULT 22, quiet_end integer NOT NULL DEFAULT 8,
 attention_limit integer NOT NULL DEFAULT 6
);
CREATE TABLE IF NOT EXISTS credentials (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), device_id uuid,
 kind text NOT NULL CHECK (kind IN ('pairing','access')), secret_hash text UNIQUE NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS projects (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), data jsonb,
 revision bigint NOT NULL, epoch bigint NOT NULL, deleted boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS source_bindings (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), binding_id uuid NOT NULL REFERENCES source_bindings(id),
 source_item text NOT NULL, source_revision text NOT NULL, data jsonb,
 UNIQUE(binding_id,source_item,source_revision)
);
CREATE TABLE IF NOT EXISTS messages (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
 id uuid NOT NULL, project_id uuid NOT NULL REFERENCES projects(id), data jsonb NOT NULL,
 PRIMARY KEY(project_id,id)
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), data jsonb NOT NULL,
 run_after timestamptz NOT NULL, lease_expires_at timestamptz, generation integer NOT NULL DEFAULT 0,
 state text NOT NULL, stale_count integer NOT NULL DEFAULT 0, tool_receipts jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,run_after);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS authority jsonb;
CREATE TABLE IF NOT EXISTS checkins (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), data jsonb NOT NULL,
 dependencies jsonb NOT NULL DEFAULT '[]', available_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS checkins_one_open ON checkins(project_id)
 WHERE data->>'state' IN ('scheduled','available','presented','snoozed');
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS authority jsonb;
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS snooze_timezone text;
CREATE TABLE IF NOT EXISTS checkin_presentations (
 presentation_id uuid PRIMARY KEY, checkin_id uuid NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES owners(id), authorized_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS command_receipts (
 actor_id uuid NOT NULL, operation_id uuid NOT NULL, project_id uuid REFERENCES projects(id),
 request_hash text NOT NULL, response jsonb, PRIMARY KEY(actor_id,operation_id)
);
CREATE TABLE IF NOT EXISTS events (
 seq bigserial PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), project_id uuid NOT NULL REFERENCES projects(id),
 data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_usage (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), calls integer NOT NULL DEFAULT 0,
 reserved_tokens bigint NOT NULL DEFAULT 0, call_limit integer NOT NULL, token_limit bigint NOT NULL,
 configuration_hash text NOT NULL
);
