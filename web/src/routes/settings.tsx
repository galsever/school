import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { absencesApi, absencesQ, type UntisLoginInput } from '@/lib/absences'
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
      <UntisCard />
    </div>
  )
}

const UNTIS_FIELDS: { key: keyof UntisLoginInput; label: string; type?: string }[] = [
  { key: 'server', label: 'Server (name.webuntis.com)' },
  { key: 'school', label: 'School (login name)' },
  { key: 'user', label: 'User' },
  { key: 'password', label: 'Password', type: 'password' },
  { key: 'place', label: 'Place on the letter' },
]

/** WebUntis login for the Absences page; the server checks it once at WebUntis before storing it. */
function UntisCard() {
  const qc = useQueryClient()
  const login = useQuery(absencesQ.login())
  const [form, setForm] = useState<UntisLoginInput | null>(null)
  const [saving, setSaving] = useState(false)
  if (!login.data) return null
  const { configured, ...stored } = login.data

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      await absencesApi.saveLogin(form)
      setForm(null)
      await qc.invalidateQueries({ queryKey: ['absences'] })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-3 rounded-xl bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">WebUntis</span>
          {configured && <span className="block truncate text-sm text-muted-foreground">{stored.user}</span>}
        </span>
        {!form && (
          <Button variant={configured ? 'secondary' : 'default'} size="sm" onClick={() => setForm({ ...stored, password: '' })}>
            {configured ? 'Edit' : 'Connect'}
          </Button>
        )}
      </div>
      {form && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {UNTIS_FIELDS.map((f) => (
            <Input
              key={f.key}
              type={f.type}
              aria-label={f.label}
              placeholder={f.key === 'password' && configured ? 'Password (unchanged)' : f.label}
              autoComplete={f.key === 'password' ? 'new-password' : 'off'}
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              Save
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
