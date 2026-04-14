import { useState } from 'react'
import { useListReports } from '../api/generated/reports/reports'
import { useListClients } from '../api/generated/clients/clients'
import { createRun, triggerDownload } from '../api/runs'
import type { ReportMeta } from '../api/generated/models/reportMeta'
import { ParamsForm, type FieldOption } from './ParamsForm'

export function ReportsPage() {
  const reportsQuery = useListReports()
  const clientsQuery = useListClients()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (reportsQuery.isPending) return <p>Loading reports…</p>
  if (reportsQuery.error) {
    return (
      <p style={{ color: 'tomato' }}>
        Failed to load reports: {String(reportsQuery.error)}
      </p>
    )
  }

  const reports: ReportMeta[] =
    reportsQuery.data?.status === 200 ? reportsQuery.data.data : []
  const clients =
    clientsQuery.data?.status === 200 ? clientsQuery.data.data : []
  const clientOptions: FieldOption[] = clients.map(c => ({
    value: c.id,
    label: `${c.fullName} — ${c.gymName}`,
  }))

  const selected = reports.find(r => r.id === selectedId) ?? null

  const handleRun = async (values: Record<string, string>) => {
    if (!selected) return
    setRunning(true)
    setError(null)
    try {
      const result = await createRun({
        reportId: selected.id,
        format: 'xlsx',
        params: values,
      })
      triggerDownload(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section style={{ maxWidth: 640, margin: '0 auto' }}>
      <h2>Reports</h2>
      {reports.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No reports registered yet.</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {reports.map(r => (
            <li key={r.id}>
              <button
                type='button'
                onClick={() => setSelectedId(r.id)}
                style={{
                  fontWeight: selectedId === r.id ? 600 : 400,
                  outline:
                    selectedId === r.id ? '2px solid currentColor' : 'none',
                }}
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 4 }}>{selected.name}</h3>
          <p style={{ opacity: 0.8, marginTop: 0 }}>{selected.description}</p>
          <ParamsForm
            schema={selected.paramsSchema ?? {}}
            fieldOptions={{ clientId: clientOptions }}
            disabled={running}
            onSubmit={handleRun}
          />
          {error && <p style={{ color: 'tomato' }}>{error}</p>}
        </div>
      )}
    </section>
  )
}
