import { faker } from '@faker-js/faker';

import { sql, closeDb } from '../src/db/client.ts';

const GYMS = [
  { name: 'Atlas Moscow', city: 'Москва', opened_at: '2019-03-15' },
  { name: 'Neva Strength', city: 'Санкт-Петербург', opened_at: '2020-09-01' },
  { name: 'Kazan Forge', city: 'Казань', opened_at: '2021-06-10' },
];

const CLIENTS_PER_GYM = 30;
const MONTHS = 12;
const PERIOD_END = new Date('2026-03-15T10:00:00Z');

faker.seed(42);

function pickGender(): 'male' | 'female' {
  return faker.datatype.boolean() ? 'male' : 'female';
}

function randRange(min: number, max: number): number {
  return min + faker.number.float({ min: 0, max: 1 }) * (max - min);
}

function round(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

type ClientProfile = {
  gender: 'male' | 'female';
  baseWeight: number;
  baseBodyFat: number;
  baseMuscle: number;
  baseWater: number;
  baseVisceral: number;
  baseBmr: number;
  baseChest: number;
  baseWaist: number;
  baseHips: number;
  weightDelta: number;
  fatDelta: number;
  muscleDelta: number;
};

function buildProfile(gender: 'male' | 'female'): ClientProfile {
  const isMale = gender === 'male';
  return {
    gender,
    baseWeight: randRange(isMale ? 72 : 55, isMale ? 105 : 82),
    baseBodyFat: randRange(isMale ? 15 : 22, isMale ? 32 : 38),
    baseMuscle: randRange(isMale ? 32 : 22, isMale ? 44 : 30),
    baseWater: randRange(45, 60),
    baseVisceral: randRange(4, 14),
    baseBmr: Math.round(randRange(isMale ? 1550 : 1250, isMale ? 2100 : 1700)),
    baseChest: randRange(isMale ? 92 : 82, isMale ? 118 : 104),
    baseWaist: randRange(isMale ? 78 : 66, isMale ? 108 : 94),
    baseHips: randRange(isMale ? 92 : 92, isMale ? 112 : 114),
    weightDelta: randRange(-6, 2),
    fatDelta: randRange(-5, 1),
    muscleDelta: randRange(-1, 3),
  };
}

function monthlyDate(offset: number): Date {
  const d = new Date(PERIOD_END);
  d.setUTCMonth(d.getUTCMonth() - (MONTHS - 1 - offset));
  return d;
}

type Activity = 'strength' | 'cardio' | 'yoga' | 'crossfit' | 'boxing';
const ACTIVITIES: Activity[] = ['strength', 'cardio', 'yoga', 'crossfit', 'boxing'];
const VISITS_PER_CLIENT_MONTH = 6;

async function main() {
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM gyms
  `;
  if ((rows[0]?.count ?? 0) > 0 && !process.env.SEED_FORCE) {
    console.log('[seed] gyms already populated, skipping (set SEED_FORCE=1 to override)');
    return;
  }

  console.log('[seed] truncating existing data');
  await sql`TRUNCATE visits, measurements, clients, gyms RESTART IDENTITY CASCADE`;

  console.log('[seed] inserting gyms');
  const gymRows = await sql<{ id: string; name: string }[]>`
    INSERT INTO gyms ${sql(GYMS, 'name', 'city', 'opened_at')}
    RETURNING id, name
  `;

  console.log(`[seed] inserting ${gymRows.length * CLIENTS_PER_GYM} clients`);
  const clientPayload: Array<{
    gym_id: string;
    full_name: string;
    gender: 'male' | 'female';
    birth_date: string;
    joined_at: string;
  }> = [];

  for (const gym of gymRows) {
    for (let i = 0; i < CLIENTS_PER_GYM; i++) {
      const gender = pickGender();
      clientPayload.push({
        gym_id: gym.id,
        full_name: faker.person.fullName({ sex: gender }),
        gender,
        birth_date: faker.date
          .between({ from: '1965-01-01', to: '2005-12-31' })
          .toISOString()
          .slice(0, 10),
        joined_at: faker.date
          .between({ from: '2023-01-01', to: '2025-06-01' })
          .toISOString()
          .slice(0, 10),
      });
    }
  }

  const clientRows = await sql<{ id: string; gender: 'male' | 'female' }[]>`
    INSERT INTO clients ${sql(clientPayload, 'gym_id', 'full_name', 'gender', 'birth_date', 'joined_at')}
    RETURNING id, gender
  `;

  console.log(`[seed] inserting ${clientRows.length * MONTHS} measurements`);
  const measurementPayload: Array<Record<string, string | number>> = [];

  for (const client of clientRows) {
    const profile = buildProfile(client.gender);
    for (let m = 0; m < MONTHS; m++) {
      const progress = m / (MONTHS - 1);
      const noise = () => randRange(-0.4, 0.4);
      const weight = profile.baseWeight + profile.weightDelta * progress + noise();
      const fat = profile.baseBodyFat + profile.fatDelta * progress + noise();
      const muscle = profile.baseMuscle + profile.muscleDelta * progress + noise() * 0.5;
      const water = profile.baseWater + noise() * 0.6;
      const visceral = Math.max(1, profile.baseVisceral + progress * -1 + noise() * 0.2);
      const bmr = Math.round(profile.baseBmr + muscle * 2 - fat * 1.5);
      const chest = profile.baseChest + noise();
      const waist = profile.baseWaist - progress * 3 + noise();
      const hips = profile.baseHips - progress * 1.5 + noise();

      measurementPayload.push({
        client_id: client.id,
        measured_at: monthlyDate(m).toISOString(),
        weight_kg: round(weight),
        body_fat_pct: round(fat),
        muscle_mass_kg: round(muscle),
        water_pct: round(water),
        visceral_fat: round(visceral),
        basal_metabolic_rate: bmr,
        chest_cm: round(chest),
        waist_cm: round(waist),
        hips_cm: round(hips),
      });
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < measurementPayload.length; i += CHUNK) {
    const chunk = measurementPayload.slice(i, i + CHUNK);
    await sql`
      INSERT INTO measurements ${sql(
        chunk,
        'client_id',
        'measured_at',
        'weight_kg',
        'body_fat_pct',
        'muscle_mass_kg',
        'water_pct',
        'visceral_fat',
        'basal_metabolic_rate',
        'chest_cm',
        'waist_cm',
        'hips_cm',
      )}
    `;
  }

  console.log(
    `[seed] inserting ~${clientRows.length * MONTHS * VISITS_PER_CLIENT_MONTH} visits`,
  );
  const visitPayload: Array<{
    client_id: string;
    started_at: string;
    duration_min: number;
    activity: Activity;
  }> = [];

  for (const client of clientRows) {
    for (let m = 0; m < MONTHS; m++) {
      const monthDate = monthlyDate(m);
      const year = monthDate.getUTCFullYear();
      const month = monthDate.getUTCMonth();
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const count = Math.max(
        1,
        Math.round(VISITS_PER_CLIENT_MONTH + randRange(-2, 2)),
      );
      for (let v = 0; v < count; v++) {
        const day = 1 + Math.floor(faker.number.float({ min: 0, max: daysInMonth - 0.001 }));
        const hour = 7 + Math.floor(faker.number.float({ min: 0, max: 14 }));
        const minute = Math.floor(faker.number.float({ min: 0, max: 60 }));
        const startedAt = new Date(Date.UTC(year, month, day, hour, minute));
        const duration = Math.round(randRange(35, 95));
        const activity = ACTIVITIES[Math.floor(faker.number.float({ min: 0, max: ACTIVITIES.length - 0.001 }))]!;
        visitPayload.push({
          client_id: client.id,
          started_at: startedAt.toISOString(),
          duration_min: duration,
          activity,
        });
      }
    }
  }

  for (let i = 0; i < visitPayload.length; i += CHUNK) {
    const chunk = visitPayload.slice(i, i + CHUNK);
    await sql`
      INSERT INTO visits ${sql(chunk, 'client_id', 'started_at', 'duration_min', 'activity')}
    `;
  }

  console.log('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
