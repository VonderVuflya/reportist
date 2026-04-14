import { z } from '@hono/zod-openapi'

import { renderXlsx } from '../../renderers/xlsx.ts'
import { ReportError, type ReportDefinition } from '../types.ts'

const paramsSchema = z
  .object({
    clientId: z.uuid().openapi({
      description: 'Client to analyse',
      example: '00000000-0000-0000-0000-000000000000',
    }),
    from: z.iso.date().openapi({
      description: 'Period start (YYYY-MM-DD)',
      example: '2025-04-01',
    }),
    to: z.iso.date().openapi({
      description: 'Period end (YYYY-MM-DD)',
      example: '2026-03-31',
    }),
  })
  .openapi('BodyCompositionDynamicsParams')

type Params = z.infer<typeof paramsSchema>

type MeasurementRow = {
  measured_at: string
  weight_kg: string
  body_fat_pct: string
  muscle_mass_kg: string
  water_pct: string
  visceral_fat: string
  basal_metabolic_rate: number
  chest_cm: string | null
  waist_cm: string | null
  hips_cm: string | null
}

type Data = {
  client: { fullName: string; gym: string; city: string }
  period: { from: string; to: string }
  measurements: MeasurementRow[]
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: string | number | null): number | null {
  if (v === null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const definition: ReportDefinition<Params, Data> = {
  id: 'body-composition-dynamics',
  name: 'Body composition dynamics',
  description:
    'Динамика состава тела клиента за период: вес, % жира, мышечная масса, вода, обхваты.',
  paramsSchema,
  supportedFormats: ['xlsx'],

  async fetch(params, ctx) {
    const clients = await ctx.db<
      { full_name: string; gym_name: string; city: string }[]
    >`
      SELECT c.full_name, g.name AS gym_name, g.city
      FROM clients c
      JOIN gyms g ON g.id = c.gym_id
      WHERE c.id = ${params.clientId}
    `
    const client = clients[0]
    if (!client) {
      throw new ReportError(
        'unprocessable',
        `Client ${params.clientId} not found`
      )
    }

    const measurements = await ctx.db<MeasurementRow[]>`
      SELECT measured_at, weight_kg, body_fat_pct, muscle_mass_kg, water_pct,
             visceral_fat, basal_metabolic_rate, chest_cm, waist_cm, hips_cm
      FROM measurements
      WHERE client_id = ${params.clientId}
        AND measured_at >= ${params.from}::date
        AND measured_at < (${params.to}::date + INTERVAL '1 day')
      ORDER BY measured_at ASC
    `

    return {
      client: {
        fullName: client.full_name,
        gym: client.gym_name,
        city: client.city,
      },
      period: { from: params.from, to: params.to },
      measurements,
    }
  },

  renderers: {
    xlsx: data =>
      renderXlsx(wb => {
        const sheet = wb.addWorksheet('Body composition')
        sheet.addRow(['Клиент', data.client.fullName])
        sheet.addRow(['Зал', `${data.client.gym} (${data.client.city})`])
        sheet.addRow(['Период', `${data.period.from} — ${data.period.to}`])
        sheet.addRow([])

        const header = sheet.addRow([
          'Дата',
          'Вес (кг)',
          '% жира',
          'Мышцы (кг)',
          '% воды',
          'Висцер. жир',
          'BMR (ккал)',
          'Грудь (см)',
          'Талия (см)',
          'Бёдра (см)',
        ])
        header.font = { bold: true }

        for (const m of data.measurements) {
          sheet.addRow([
            new Date(m.measured_at).toISOString().slice(0, 10),
            num(m.weight_kg),
            num(m.body_fat_pct),
            num(m.muscle_mass_kg),
            num(m.water_pct),
            num(m.visceral_fat),
            m.basal_metabolic_rate,
            num(m.chest_cm),
            num(m.waist_cm),
            num(m.hips_cm),
          ])
        }

        if (data.measurements.length > 0) {
          const first = data.measurements[0]!
          const last = data.measurements[data.measurements.length - 1]!
          const weights = data.measurements.map(m => Number(m.weight_kg))
          const fats = data.measurements.map(m => Number(m.body_fat_pct))
          const muscles = data.measurements.map(m => Number(m.muscle_mass_kg))
          const min = (xs: number[]) => Math.min(...xs)
          const max = (xs: number[]) => Math.max(...xs)
          const avg = (xs: number[]) =>
            round(xs.reduce((a, b) => a + b, 0) / xs.length)

          sheet.addRow([])
          sheet.addRow(['min', min(weights), min(fats), min(muscles)])
          sheet.addRow(['max', max(weights), max(fats), max(muscles)])
          sheet.addRow(['avg', avg(weights), avg(fats), avg(muscles)])
          sheet.addRow([
            'Δ (last − first)',
            round(Number(last.weight_kg) - Number(first.weight_kg)),
            round(Number(last.body_fat_pct) - Number(first.body_fat_pct)),
            round(Number(last.muscle_mass_kg) - Number(first.muscle_mass_kg)),
          ])
        }

        sheet.columns.forEach(c => {
          c.width = 14
        })
      }),
  },
}

export default definition
