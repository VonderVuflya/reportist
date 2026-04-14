CREATE TYPE run_status AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL,
  format TEXT NOT NULL,
  params JSONB NOT NULL,
  status run_status NOT NULL DEFAULT 'queued',
  result_key TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_user_created ON runs(user_id, created_at DESC);
