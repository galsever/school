import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { q, queryClient } from '@/lib/query'

export function SettingsPage() {
  const ms = useQuery(q.ms())
  const navigate = useNavigate()
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'denied' : Notification.permission)

  const signOut = async () => {
    try {
      await api.msLogout()
      queryClient.clear()
      void navigate({ to: '/connect' })
    } catch (e) {
      toast.error(errorText(e))
    }
  }

  return (
    <div className="mx-auto max-w-xl p-3 md:p-6">
      <h1 className="mb-4 px-1 text-xl font-semibold">Settings</h1>
      {ms.data?.connected && (
        <section className="flex items-center gap-3 rounded-xl bg-card p-4">
          <Avatar name={ms.data.me.name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{ms.data.me.name}</span>
            <span className="block truncate text-sm text-muted-foreground">{ms.data.me.mail}</span>
          </span>
          <Button variant="secondary" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </section>
      )}
      <section className="mt-3 flex items-center gap-3 rounded-xl bg-card p-4">
        <span className="flex-1 font-medium">Notifications</span>
        {perm === 'granted' ? (
          <span className="text-sm text-muted-foreground">On</span>
        ) : (
          <Button
            size="sm"
            disabled={perm === 'denied'}
            onClick={() => void Notification.requestPermission().then(setPerm)}
          >
            {perm === 'denied' ? 'Blocked' : 'Turn on'}
          </Button>
        )}
      </section>
    </div>
  )
}
