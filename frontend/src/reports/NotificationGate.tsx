import { useState } from 'react'

import { Button } from '@/components/ui/button'

export function NotificationGate() {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const [perm, setPerm] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied',
  )

  if (!supported) return null
  if (perm !== 'default') return null

  return (
    <Button
      type='button'
      size='sm'
      variant='outline'
      onClick={async () => {
        const res = await Notification.requestPermission()
        setPerm(res)
      }}
    >
      Enable notifications
    </Button>
  )
}
