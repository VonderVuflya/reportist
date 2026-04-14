import type { GymActivityData } from './index.ts'

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', 'Helvetica Neue', sans-serif; color: #1a1a1a; font-size: 10.5pt; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4pt; color: #0f172a; }
  h2 { font-size: 13pt; margin: 16pt 0 6pt; color: #0f172a; border-bottom: 1pt solid #e2e8f0; padding-bottom: 3pt; }
  .meta { color: #475569; margin-bottom: 14pt; font-size: 10pt; }
  .meta .gym { font-size: 12pt; color: #0f172a; font-weight: 600; }
  .metrics { display: flex; gap: 8pt; margin-bottom: 10pt; }
  .metric { flex: 1; border: 1pt solid #e2e8f0; border-radius: 6pt; padding: 8pt 10pt; background: #f8fafc; }
  .metric .label { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.5pt; margin-bottom: 2pt; }
  .metric .value { font-size: 18pt; font-weight: 700; color: #0f172a; line-height: 1; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th { text-align: left; border-bottom: 1pt solid #94a3b8; padding: 5pt 8pt; background: #f1f5f9; font-weight: 600; color: #0f172a; }
  td { border-bottom: 0.5pt solid #e2e8f0; padding: 5pt 8pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .chart { display: block; margin: 4pt 0 8pt; }
  .chart .axis { stroke: #94a3b8; stroke-width: 0.6; }
  .chart .bar { fill: #2563eb; }
  .chart .grid { stroke: #e2e8f0; stroke-width: 0.4; }
  .chart text { font-size: 7pt; fill: #64748b; font-family: inherit; }
  .empty { color: #94a3b8; font-style: italic; padding: 8pt 0; }
`

type DailyPoint = { day: string; count: number }

function DailyChart({ daily }: { daily: DailyPoint[] }) {
  if (daily.length === 0) {
    return <p class='empty'>No visits in selected period.</p>
  }
  const width = 560
  const height = 140
  const pad = { top: 10, right: 10, bottom: 24, left: 32 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const maxCount = Math.max(...daily.map(d => d.count), 1)
  const barW = innerW / daily.length

  const gridSteps = 4
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const y = pad.top + (innerH * i) / gridSteps
    const value = Math.round(maxCount * (1 - i / gridSteps))
    return { y, value }
  })

  return (
    <svg class='chart' width={width} height={height}>
      {gridLines.map(g => (
        <>
          <line
            class='grid'
            x1={pad.left}
            y1={g.y}
            x2={pad.left + innerW}
            y2={g.y}
          />
          <text x={pad.left - 4} y={g.y + 3} text-anchor='end'>
            {g.value}
          </text>
        </>
      ))}
      <line
        class='axis'
        x1={pad.left}
        y1={pad.top + innerH}
        x2={pad.left + innerW}
        y2={pad.top + innerH}
      />
      {daily.map((d, i) => {
        const h = (d.count / maxCount) * innerH
        const x = pad.left + i * barW + 1
        const y = pad.top + innerH - h
        return (
          <rect
            class='bar'
            x={x}
            y={y}
            width={Math.max(1, barW - 2)}
            height={h}
          />
        )
      })}
      <text x={pad.left} y={height - 6}>
        {daily[0]?.day}
      </text>
      <text
        x={pad.left + innerW}
        y={height - 6}
        text-anchor='end'
      >
        {daily[daily.length - 1]?.day}
      </text>
    </svg>
  )
}

export function GymActivityTemplate({ data }: { data: GymActivityData }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Gym activity summary</h1>
      <div class='meta'>
        <div class='gym'>
          {data.gym.name} — {data.gym.city}
        </div>
        <div>
          Period: {data.period.from} → {data.period.to}
        </div>
      </div>

      <section class='metrics'>
        <div class='metric'>
          <div class='label'>Total visits</div>
          <div class='value'>{data.totals.visits.toLocaleString('en-US')}</div>
        </div>
        <div class='metric'>
          <div class='label'>Unique visitors</div>
          <div class='value'>
            {data.totals.uniqueClients.toLocaleString('en-US')}
          </div>
        </div>
        <div class='metric'>
          <div class='label'>Total hours</div>
          <div class='value'>{Math.round(data.totals.totalHours)}</div>
        </div>
        <div class='metric'>
          <div class='label'>Avg session</div>
          <div class='value'>{Math.round(data.totals.avgDuration)} min</div>
        </div>
      </section>

      <h2>Daily visits</h2>
      <DailyChart daily={data.daily} />

      <h2>By activity</h2>
      <table>
        <thead>
          <tr>
            <th>Activity</th>
            <th class='num'>Visits</th>
            <th class='num'>Hours</th>
          </tr>
        </thead>
        <tbody>
          {data.byActivity.map(a => (
            <tr>
              <td>{a.activity}</td>
              <td class='num'>{a.count}</td>
              <td class='num'>{Math.round(a.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Top 5 clients</h2>
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th class='num'>Visits</th>
            <th class='num'>Hours</th>
          </tr>
        </thead>
        <tbody>
          {data.topClients.map(c => (
            <tr>
              <td>{c.fullName}</td>
              <td class='num'>{c.visits}</td>
              <td class='num'>{Math.round(c.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
