import { z } from '@hono/zod-openapi'

import { renderPdf } from '../../renderers/pdf.ts'
import { renderXlsx } from '../../renderers/xlsx.ts'
import { ReportError, type ReportDefinition } from '../types.ts'
import { GymActivityTemplate } from './template.tsx'

const paramsSchema = z
  .object({
    gymId: z.uuid().openapi({
      description: 'Gym to aggregate',
      example: '00000000-0000-0000-0000-000000000000',
    }),
    from: z.iso.date().openapi({
      description: 'Period start (YYYY-MM-DD)',
      example: '2025-10-01',
    }),
    to: z.iso.date().openapi({
      description: 'Period end (YYYY-MM-DD)',
      example: '2026-03-31',
    }),
  })
  .openapi('GymActivitySummaryParams')

type Params = z.infer<typeof paramsSchema>

export type GymActivityData = {
  gym: { name: string; city: string }
  period: { from: string; to: string }
  totals: {
    visits: number
    uniqueClients: number
    totalHours: number
    avgDuration: number
  }
  daily: { day: string; count: number; avgDuration: number }[]
  byActivity: { activity: string; count: number; hours: number }[]
  topClients: {
    clientId: string
    fullName: string
    visits: number
    hours: number
  }[]
}

const definition: ReportDefinition<Params, GymActivityData> = {
  id: 'gym-activity-summary',
  name: 'Gym activity summary',
  description:
    'Сводка активности зала за период: визиты, уникальные клиенты, разбивка по типам тренировок и топ клиентов.',
  paramsSchema,
  supportedFormats: ['xlsx', 'pdf'],

  async fetch(params, ctx) {
    const gyms = await ctx.db<{ name: string; city: string }[]>`
      SELECT name, city FROM gyms WHERE id = ${params.gymId}
    `
    const gym = gyms[0]
    if (!gym) {
      throw new ReportError('unprocessable', `Gym ${params.gymId} not found`)
    }

    const totalsRows = await ctx.db<
      {
        visits: string
        unique_clients: string
        total_hours: string
        avg_duration: string
      }[]
    >`
      SELECT
        COUNT(*)::text AS visits,
        COUNT(DISTINCT v.client_id)::text AS unique_clients,
        COALESCE(SUM(v.duration_min)::numeric / 60, 0)::text AS total_hours,
        COALESCE(AVG(v.duration_min), 0)::text AS avg_duration
      FROM visits v
      JOIN clients c ON c.id = v.client_id
      WHERE c.gym_id = ${params.gymId}
        AND v.started_at >= ${params.from}::date
        AND v.started_at < (${params.to}::date + INTERVAL '1 day')
    `
    const totalsRow = totalsRows[0]

    const dailyRows = await ctx.db<
      { day: Date; count: string; avg_duration: string }[]
    >`
      SELECT
        date_trunc('day', v.started_at) AS day,
        COUNT(*)::text AS count,
        COALESCE(AVG(v.duration_min), 0)::text AS avg_duration
      FROM visits v
      JOIN clients c ON c.id = v.client_id
      WHERE c.gym_id = ${params.gymId}
        AND v.started_at >= ${params.from}::date
        AND v.started_at < (${params.to}::date + INTERVAL '1 day')
      GROUP BY day
      ORDER BY day
    `

    const activityRows = await ctx.db<
      { activity: string; count: string; hours: string }[]
    >`
      SELECT
        v.activity::text AS activity,
        COUNT(*)::text AS count,
        COALESCE(SUM(v.duration_min)::numeric / 60, 0)::text AS hours
      FROM visits v
      JOIN clients c ON c.id = v.client_id
      WHERE c.gym_id = ${params.gymId}
        AND v.started_at >= ${params.from}::date
        AND v.started_at < (${params.to}::date + INTERVAL '1 day')
      GROUP BY v.activity
      ORDER BY count DESC
    `

    const topRows = await ctx.db<
      {
        client_id: string
        full_name: string
        visits: string
        hours: string
      }[]
    >`
      SELECT
        c.id AS client_id,
        c.full_name,
        COUNT(*)::text AS visits,
        COALESCE(SUM(v.duration_min)::numeric / 60, 0)::text AS hours
      FROM visits v
      JOIN clients c ON c.id = v.client_id
      WHERE c.gym_id = ${params.gymId}
        AND v.started_at >= ${params.from}::date
        AND v.started_at < (${params.to}::date + INTERVAL '1 day')
      GROUP BY c.id, c.full_name
      ORDER BY visits DESC
      LIMIT 5
    `

    return {
      gym: { name: gym.name, city: gym.city },
      period: { from: params.from, to: params.to },
      totals: {
        visits: Number(totalsRow?.visits ?? 0),
        uniqueClients: Number(totalsRow?.unique_clients ?? 0),
        totalHours: Number(totalsRow?.total_hours ?? 0),
        avgDuration: Number(totalsRow?.avg_duration ?? 0),
      },
      daily: dailyRows.map(d => ({
        day: new Date(d.day).toISOString().slice(0, 10),
        count: Number(d.count),
        avgDuration: Number(d.avg_duration),
      })),
      byActivity: activityRows.map(a => ({
        activity: a.activity,
        count: Number(a.count),
        hours: Number(a.hours),
      })),
      topClients: topRows.map(t => ({
        clientId: t.client_id,
        fullName: t.full_name,
        visits: Number(t.visits),
        hours: Number(t.hours),
      })),
    }
  },

  renderers: {
    xlsx: data =>
      renderXlsx(wb => {
        const summary = wb.addWorksheet('Summary')
        summary.addRow(['Gym', `${data.gym.name} (${data.gym.city})`])
        summary.addRow(['Period', `${data.period.from} — ${data.period.to}`])
        summary.addRow([])
        summary.addRow(['Total visits', data.totals.visits])
        summary.addRow(['Unique visitors', data.totals.uniqueClients])
        summary.addRow(['Total hours', Math.round(data.totals.totalHours)])
        summary.addRow([
          'Avg session (min)',
          Math.round(data.totals.avgDuration),
        ])
        summary.addRow([])
        const actHead = summary.addRow(['Activity', 'Visits', 'Hours'])
        actHead.font = { bold: true }
        for (const a of data.byActivity) {
          summary.addRow([a.activity, a.count, Math.round(a.hours)])
        }
        summary.columns.forEach(c => {
          c.width = 22
        })

        const daily = wb.addWorksheet('Daily')
        const dailyHead = daily.addRow([
          'Date',
          'Visits',
          'Avg duration (min)',
        ])
        dailyHead.font = { bold: true }
        for (const d of data.daily) {
          daily.addRow([d.day, d.count, Math.round(d.avgDuration)])
        }
        daily.columns.forEach(c => {
          c.width = 20
        })

        const top = wb.addWorksheet('Top clients')
        const topHead = top.addRow(['Client', 'Visits', 'Hours'])
        topHead.font = { bold: true }
        for (const t of data.topClients) {
          top.addRow([t.fullName, t.visits, Math.round(t.hours)])
        }
        top.columns.forEach(c => {
          c.width = 28
        })
      }),

    pdf: data => renderPdf(GymActivityTemplate({ data }).toString()),
  },
}

export default definition
