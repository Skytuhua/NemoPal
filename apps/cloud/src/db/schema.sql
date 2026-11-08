CREATE TABLE IF NOT EXISTS owners (
 id uuid PRIMARY KEY, timezone text NOT NULL, reminders boolean NOT NULL DEFAULT false,
 quiet_start integer NOT NULL DEFAULT 21, quiet_end integer NOT NULL DEFAULT 9,
 attention_limit integer NOT NULL DEFAULT 3
);
ALTER TABLE owners ALTER COLUMN quiet_start SET DEFAULT 21;
ALTER TABLE owners ALTER COLUMN quiet_end SET DEFAULT 9;
ALTER TABLE owners ALTER COLUMN attention_limit SET DEFAULT 3;
-- Correct the prior baseline's exact default tuple; retain deliberately customized preferences.
UPDATE owners SET quiet_start=21,quiet_end=9,attention_limit=3
 WHERE quiet_start=22 AND quiet_end=8 AND attention_limit=6;
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
ALTER TABLE observations ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now();
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
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS repair_attempted boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS checkins (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), data jsonb NOT NULL,
 dependencies jsonb NOT NULL DEFAULT '[]', available_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS checkins_one_open ON checkins(project_id)
 WHERE data->>'state' IN ('scheduled','available','presented','snoozed');
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS authority jsonb;
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS snooze_timezone text;
CREATE TABLE IF NOT EXISTS checkin_presentations (
 presentation_id uuid PRIMARY KEY, checkin_id uuid REFERENCES checkins(id) ON DELETE SET NULL,
 owner_id uuid NOT NULL REFERENCES owners(id), authorized_at timestamptz NOT NULL
);
-- Project cleanup removes content, while account attention reservations survive their charged window.
ALTER TABLE checkin_presentations ALTER COLUMN checkin_id DROP NOT NULL;
ALTER TABLE checkin_presentations DROP CONSTRAINT IF EXISTS checkin_presentations_checkin_id_fkey;
ALTER TABLE checkin_presentations ADD CONSTRAINT checkin_presentations_checkin_id_fkey
 FOREIGN KEY(checkin_id) REFERENCES checkins(id) ON DELETE SET NULL;
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
CREATE TABLE IF NOT EXISTS generated_dependencies (
 project_id uuid NOT NULL REFERENCES projects(id), resource_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('task','task_title','workspace')),
 observation_id uuid NOT NULL, PRIMARY KEY(project_id,resource_id,kind,observation_id)
);
-- Sendblue is a transport over canonical messages/jobs, never another project store.
CREATE TABLE IF NOT EXISTS sendblue_links (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES owners(id), project_id uuid NOT NULL REFERENCES projects(id),
 account text NOT NULL, receiving_line text NOT NULL, sender text NOT NULL,
 actions text[] NOT NULL, revision integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
 expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sendblue_active_sender ON sendblue_links(account,receiving_line,sender) WHERE active;
-- Existing links have no trustworthy consent time and must be re-linked to poll.
ALTER TABLE sendblue_links ADD COLUMN IF NOT EXISTS linked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS sendblue_active_project ON sendblue_links(owner_id,project_id) WHERE active;
CREATE TABLE IF NOT EXISTS sendblue_receipts (
 account text NOT NULL, handle text NOT NULL, outbound boolean NOT NULL, status text NOT NULL,
 payload_hash text NOT NULL, link_id uuid NOT NULL REFERENCES sendblue_links(id),
 owner_message_id uuid, job_id uuid, created_at timestamptz NOT NULL,
 PRIMARY KEY(account,handle,outbound,status)
);
CREATE INDEX IF NOT EXISTS sendblue_receipts_rate ON sendblue_receipts(link_id,created_at);
CREATE TABLE IF NOT EXISTS sendblue_outbox (
 id uuid PRIMARY KEY, operation_id uuid NOT NULL UNIQUE, request_hash text NOT NULL,
 link_id uuid NOT NULL REFERENCES sendblue_links(id), authority jsonb NOT NULL,
 owner_id uuid NOT NULL REFERENCES owners(id), project_id uuid NOT NULL REFERENCES projects(id),
 account text NOT NULL, kind text NOT NULL, request_key text, input_message_id uuid, message_id uuid,
 text text, project_epoch bigint NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'pending'
 CHECK(state IN ('pending','leased','sending','accepted','delivered','failed','uncertain','cancelled')),
 generation integer NOT NULL DEFAULT 0, lease_expires_at timestamptz,
 provider_handle text, provider_status text,
 UNIQUE(link_id,input_message_id), UNIQUE(link_id,kind,request_key), UNIQUE(account,provider_handle)
);
CREATE INDEX IF NOT EXISTS sendblue_outbox_due ON sendblue_outbox(state,expires_at);
