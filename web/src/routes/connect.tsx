import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { api, errorText } from '@/lib/api'
import { queryClient } from '@/lib/query'
import type { DeviceLogin } from '@/lib/types'

/** Microsoft sign-in: device code, entered on microsoft.com in any browser. */
export function ConnectPage() {
  const navigate = useNavigate()
  const [device, setDevice] = useState<DeviceLogin | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .msStatus()
      .then((s) => (s.connected ? void navigate({ to: '/chats', replace: true }) : setDevice(s.device)))
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pending = device?.state === 'pending' && (device.expiresAt ?? 0) * 1000 > Date.now()

  useEffect(() => {
    if (!pending) return
    const t = setInterval(async () => {
      try {
        const d = await api.msDeviceState()
        setDevice(d)
        if (d.state === 'done') {
          await queryClient.invalidateQueries()
          void navigate({ to: '/chats', replace: true })
        }
      } catch {
        /* keep polling */
      }
    }, 2000)
    return () => clearInterval(t)
  }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true)
    try {
      setDevice(await api.msDevice())
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-6 text-center">
        {pending && device?.userCode ? (
          <>
            <button
              className="flex items-center gap-3 rounded-xl bg-card px-5 py-4 font-mono text-3xl tracking-widest"
              onClick={() => void navigator.clipboard.writeText(device.userCode!).then(() => toast('Copied'))}
            >
              {device.userCode}
              <Copy className="size-4 text-muted-foreground" />
            </button>
            <Button asChild className="w-full">
              <a href={device.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> microsoft.com/devicelogin
              </a>
            </Button>
            <Loader2 className="animate-spin text-muted-foreground" />
          </>
        ) : (
          <>
            {device?.state === 'failed' && <p className="text-sm text-destructive">Sign-in failed</p>}
            <Button className="w-full" onClick={start} disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Sign in with Microsoft
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
