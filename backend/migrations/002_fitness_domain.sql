CREATE TABLE gyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  opened_at DATE NOT NULL
);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id),
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  birth_date DATE NOT NULL,
  joined_at DATE NOT NULL
);

CREATE TABLE measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  weight_kg NUMERIC(5,2) NOT NULL,
  body_fat_pct NUMERIC(4,2) NOT NULL,
  muscle_mass_kg NUMERIC(5,2) NOT NULL,
  water_pct NUMERIC(4,2) NOT NULL,
  visceral_fat NUMERIC(4,2) NOT NULL,
  basal_metabolic_rate INT NOT NULL,
  chest_cm NUMERIC(5,2),
  waist_cm NUMERIC(5,2),
  hips_cm NUMERIC(5,2)
);

CREATE INDEX idx_clients_gym ON clients(gym_id);
CREATE INDEX idx_measurements_client_date ON measurements(client_id, measured_at);
