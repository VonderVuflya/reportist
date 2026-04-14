import { useEffect, useRef } from 'react'

import { baseUrl } from '../api/fetcher'
import type { Run } from '../api/generated/models/run'

export type RunUpdate = {
  id: string
  status: Run['status']
  resultKey?: string | null
  errorMessage?: string | null
}

export function useRunSSE(
  runId: string | null,
  onUpdate: (update: RunUpdate) => void,
) {
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => {
    onUpdateRef.current = onUpdate
  })

  useEffect(() => {
    if (!runId) return
    const url = `${baseUrl}/api/runs/${runId}/sse`
    const es = new EventSource(url, { withCredentials: true })

    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as RunUpdate
        onUpdateRef.current(data)
        if (data.status === 'completed' || data.status === 'failed') {
          es.close()
        }
      } catch {
        // ignore malformed payloads
      }
    }

    es.addEventListener('run', handler as EventListener)
    return () => {
      es.removeEventListener('run', handler as EventListener)
      es.close()
    }
  }, [runId])
}

export function notifyIfHidden(title: string, body: string) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return
  try {
    new Notification(title, { body })
  } catch {
    // browser refused (e.g. focus policy); no-op
  }
}
