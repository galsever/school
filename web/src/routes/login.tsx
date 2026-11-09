import { useEffect, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, ApiError, errorText } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { cn } from '@/lib/utils'

/** App password (only when the server runs with APP_AUTH=password; behind the Pocket ID gate it never shows). */
export function LoginPage() {
  const { redirect } = useSearch({ from: '/login' })
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = () => {
    const to = redirect && redirect.startsWith('/') && !redirect.startsWith('/login') ? redirect : '/'
    void navigate({ href: to, replace: true })
  }

  useEffect(() => {
    api
      .me()
      .then((r) => r?.authenticated && go())
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      await queryClient.invalidateQueries()
      go()
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'bad_password' ? 'Wrong password' : errorText(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-2">
        <div className="flex gap-2">
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            aria-invalid={!!error}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cn('h-11', error && 'border-destructive')}
          />
          <Button type="submit" size="icon" className="size-11 shrink-0" disabled={busy || !password} aria-label="Sign in">
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          </Button>
        </div>
        <p className="h-5 text-center text-sm text-destructive">{error}</p>
      </form>
    </div>
  )
}
