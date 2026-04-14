CREATE TYPE visit_activity AS ENUM ('strength', 'cardio', 'yoga', 'crossfit', 'boxing');

CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  duration_min INT NOT NULL CHECK (duration_min > 0 AND duration_min < 300),
  activity visit_activity NOT NULL
);

CREATE INDEX idx_visits_client_started ON visits(client_id, started_at);
CREATE INDEX idx_visits_started ON visits(started_at);
