import { RotateCw } from 'lucide-react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { errorText } from '@/lib/api'

export function ErrorView({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
      <p>{errorText(error)}</p>
      {retry && (
        <Button variant="secondary" size="sm" onClick={retry}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  )
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  return <ErrorView error={error} retry={reset} />
}
