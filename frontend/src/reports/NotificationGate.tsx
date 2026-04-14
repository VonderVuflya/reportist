import { useState } from 'react'

export function NotificationGate() {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [perm, setPerm] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied',
  )

  if (!supported) return null
  if (perm !== 'default') return null

  return (
    <button
      type='button'
      onClick={async () => {
        const res = await Notification.requestPermission()
        setPerm(res)
      }}
    >
      Enable notifications
    </button>
  )
}
