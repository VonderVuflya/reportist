import { useCallback, useState } from 'react'
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
import type { RunFormat } from '../api/generated/models/runFormat'
import { downloadRun } from '../api/runs'

import { ParamsForm, type FieldOption } from './ParamsForm'
import { NotificationGate } from './NotificationGate'
import { notifyIfHidden, useRunSSE, type RunUpdate } from './sse'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

const ACTIVE_STATUSES: Run['status'][] = ['queued', 'running']

type ListRunsCache = {
  status: number
  data: Run[]
  headers?: Headers
}

function RunSubscriber({
  runId,
  onUpdate,
}: {
  runId: string
  onUpdate: (update: RunUpdate) => void
}) {
  useRunSSE(runId, onUpdate)
  return null
}

export function ReportsPage() {
  const reportsQuery = useListReports()
  const clientsQuery = useListClients()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [format, setFormat] = useState<RunFormat | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const runsQuery = useListRuns({
    query: {
      refetchInterval: query => {
        const data = query.state.data
        if (data?.status !== 200) return false
        const hasActive = data.data.some(r =>
          ACTIVE_STATUSES.includes(r.status),
        )
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

  const handleSSEUpdate = useCallback(
    (update: RunUpdate) => {
      let previous: Run | undefined
      queryClient.setQueryData<ListRunsCache>(
        getListRunsQueryKey(),
        prev => {
          if (!prev || prev.status !== 200) return prev
          const nextData = prev.data.map(r => {
            if (r.id !== update.id) return r
            previous = r
            return {
              ...r,
              status: update.status,
              resultKey: update.resultKey ?? r.resultKey,
              errorMessage: update.errorMessage ?? r.errorMessage,
            }
          })
          return { ...prev, data: nextData }
        },
      )

      const isTerminal =
        update.status === 'completed' || update.status === 'failed'
      if (!isTerminal) return
      if (previous && !ACTIVE_STATUSES.includes(previous.status)) return

      const reportName =
        reportsQuery.data?.status === 200
          ? (reportsQuery.data.data.find(r => r.id === previous?.reportId)
              ?.name ?? 'Report')
          : 'Report'
      if (update.status === 'completed') {
        notifyIfHidden(`${reportName} ready`, 'Click to download the file')
      } else {
        notifyIfHidden(
          `${reportName} failed`,
          update.errorMessage ?? 'Unknown error',
        )
      }
    },
    [queryClient, reportsQuery.data],
  )

  if (reportsQuery.isPending) {
    return (
      <p className='text-sm text-muted-foreground'>Loading reports…</p>
    )
  }
  if (reportsQuery.error) {
    return (
      <p className='text-sm text-destructive'>
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
  const clientOptions: FieldOption[] = clients.map(c => ({
    value: c.id,
    label: `${c.fullName} — ${c.gymName}`,
  }))
  const gymOptions: FieldOption[] = [
    ...new Map(clients.map(c => [c.gymId, c.gymName])).entries(),
  ].map(([id, name]) => ({ value: id, label: name }))

  const selected = reports.find(r => r.id === selectedId) ?? null
  const effectiveFormat: RunFormat | null =
    selected && selected.supportedFormats.length > 0
      ? format && selected.supportedFormats.includes(format)
        ? format
        : (selected.supportedFormats[0] as RunFormat)
      : null

  const handleSelectReport = (id: string) => {
    setSelectedId(id)
    setFormat(null)
    setSubmitError(null)
  }

  const handleRun = async (values: Record<string, string>) => {
    if (!selected || !effectiveFormat) return
    setSubmitError(null)
    try {
      await createRunMutation.mutateAsync({
        data: {
          reportId: selected.id,
          format: effectiveFormat,
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
    <div className='flex flex-col gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
          <CardDescription>
            Pick a report, fill its parameters, and queue a run.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex flex-col gap-6'>
          {reports.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              No reports registered yet.
            </p>
          ) : (
            <div className='flex flex-wrap gap-2'>
              {reports.map(r => {
                const isSelected = selectedId === r.id
                return (
                  <Button
                    key={r.id}
                    type='button'
                    variant={isSelected ? 'default' : 'outline'}
                    onClick={() => handleSelectReport(r.id)}
                  >
                    {r.name}
                  </Button>
                )
              })}
            </div>
          )}

          {selected && (
            <div className='flex flex-col gap-4 border-t pt-6'>
              <div>
                <h3 className='text-base font-semibold'>{selected.name}</h3>
                <p className='text-sm text-muted-foreground'>
                  {selected.description}
                </p>
              </div>

              {selected.supportedFormats.length > 1 && (
                <div className='flex flex-col gap-2'>
                  <Label>Format</Label>
                  <RadioGroup
                    value={effectiveFormat ?? undefined}
                    onValueChange={v => setFormat(v as RunFormat)}
                    className='flex gap-6'
                  >
                    {selected.supportedFormats.map(f => (
                      <div key={f} className='flex items-center gap-2'>
                        <RadioGroupItem value={f} id={`format-${f}`} />
                        <Label htmlFor={`format-${f}`} className='uppercase'>
                          {f}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}

              <ParamsForm
                schema={selected.paramsSchema ?? {}}
                fieldOptions={{
                  clientId: clientOptions,
                  gymId: gymOptions,
                }}
                disabled={createRunMutation.isPending}
                onSubmit={handleRun}
              />
              {submitError && (
                <p className='text-sm text-destructive'>{submitError}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {runs
        .filter(r => ACTIVE_STATUSES.includes(r.status))
        .map(r => (
          <RunSubscriber
            key={r.id}
            runId={r.id}
            onUpdate={handleSSEUpdate}
          />
        ))}

      <Card>
        <CardHeader className='flex flex-row items-center justify-between gap-4'>
          <div>
            <CardTitle>Runs</CardTitle>
            <CardDescription>
              Your 50 most recent report runs.
            </CardDescription>
          </div>
          <NotificationGate />
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              No runs yet. Submit one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(run => (
                  <TableRow key={run.id}>
                    <TableCell className='whitespace-nowrap tabular-nums text-muted-foreground'>
                      {new Date(run.createdAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {run.reportId}
                    </TableCell>
                    <TableCell className='uppercase text-xs text-muted-foreground'>
                      {run.format}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <StatusBadge status={run.status} />
                        {run.status === 'failed' && run.errorMessage && (
                          <span
                            className='truncate max-w-56 text-xs text-muted-foreground'
                            title={run.errorMessage}
                          >
                            {run.errorMessage}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='text-right'>
                      {run.status === 'completed' && (
                        <Button
                          type='button'
                          size='sm'
                          variant='outline'
                          onClick={() => handleDownload(run.id)}
                        >
                          Download
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {downloadError && (
            <p className='mt-3 text-sm text-destructive'>{downloadError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const STATUS_STYLES: Record<Run['status'], string> = {
  queued: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-destructive/15 text-destructive',
}

function StatusBadge({ status }: { status: Run['status'] }) {
  return (
    <Badge
      variant='secondary'
      className={cn('capitalize', STATUS_STYLES[status])}
    >
      {status}
    </Badge>
  )
}
