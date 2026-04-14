import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useListReports } from '../api/generated/reports/reports'
import { useListClients } from '../api/generated/clients/clients'
import {
  useCreateRun,
  useListRuns,
  getListRunsQueryKey,
} from '../api/generated/runs/runs'
import type { ReportMeta } from '../api/generated/models/reportMeta'
import type { Run } from '../api/generated/models/run'
import { downloadRun } from '../api/runs'
import { ParamsForm, type FieldOption } from './ParamsForm'

const ACTIVE_STATUSES: Run['status'][] = ['queued', 'running']

export function ReportsPage() {
  const reportsQuery = useListReports()
  const clientsQuery = useListClients()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const runsQuery = useListRuns({
    query: {
      refetchInterval: (query) => {
        const data = query.state.data
        if (data?.status !== 200) return false
        const hasActive = data.data.some((r) => ACTIVE_STATUSES.includes(r.status))
        return hasActive ? 1500 : false
      },
    },
  })

  const createRunMutation = useCreateRun({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() })
      },
    },
  })

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
  const runs: Run[] =
    runsQuery.data?.status === 200 ? runsQuery.data.data : []
  const clientOptions: FieldOption[] = clients.map((c) => ({
    value: c.id,
    label: `${c.fullName} — ${c.gymName}`,
  }))

  const selected = reports.find((r) => r.id === selectedId) ?? null

  const handleRun = async (values: Record<string, string>) => {
    if (!selected) return
    setSubmitError(null)
    try {
      await createRunMutation.mutateAsync({
        data: {
          reportId: selected.id,
          format: 'xlsx',
          params: values,
        },
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDownload = async (runId: string) => {
    setDownloadError(null)
    try {
      await downloadRun(runId)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section style={{ maxWidth: 720, margin: '0 auto' }}>
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
          {reports.map((r) => (
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
            disabled={createRunMutation.isPending}
            onSubmit={handleRun}
          />
          {submitError && <p style={{ color: 'tomato' }}>{submitError}</p>}
        </div>
      )}

      <hr style={{ margin: '2rem 0 1rem' }} />
      <h3>Runs</h3>
      {runs.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No runs yet. Submit one above.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #444' }}>
              <th style={{ padding: '4px 8px' }}>Created</th>
              <th style={{ padding: '4px 8px' }}>Report</th>
              <th style={{ padding: '4px 8px' }}>Status</th>
              <th style={{ padding: '4px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} style={{ borderBottom: '1px solid #333' }}>
                <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                  {new Date(run.createdAt).toLocaleTimeString()}
                </td>
                <td style={{ padding: '4px 8px' }}>{run.reportId}</td>
                <td style={{ padding: '4px 8px' }}>
                  <StatusBadge status={run.status} />
                  {run.status === 'failed' && run.errorMessage && (
                    <span
                      title={run.errorMessage}
                      style={{ opacity: 0.7, marginLeft: 8 }}
                    >
                      {run.errorMessage.slice(0, 40)}
                      {run.errorMessage.length > 40 ? '…' : ''}
                    </span>
                  )}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  {run.status === 'completed' && (
                    <button
                      type='button'
                      onClick={() => handleDownload(run.id)}
                    >
                      Download
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {downloadError && <p style={{ color: 'tomato' }}>{downloadError}</p>}
    </section>
  )
}

function StatusBadge({ status }: { status: Run['status'] }) {
  const colors: Record<Run['status'], string> = {
    queued: '#888',
    running: '#4a90e2',
    completed: '#2e7d32',
    failed: '#c62828',
  }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        color: 'white',
        background: colors[status],
      }}
    >
      {status}
    </span>
  )
}
