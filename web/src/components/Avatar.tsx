import { Hash, Users, Video } from 'lucide-react'
import { initials } from '@/lib/format'
import type { ChatKind } from '@/lib/types'
import { cn } from '@/lib/utils'

const HUES = [293, 250, 200, 160, 40, 10, 330]

function hue(s: string) {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return HUES[Math.abs(h) % HUES.length]
}

export function Avatar({ name, kind = 'chat', className }: { name: string; kind?: ChatKind; className?: string }) {
  const group = name.includes(',')
  const Icon = kind === 'channel' ? Hash : kind === 'meeting' ? Video : group ? Users : null
  return (
    <span
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white', className)}
      style={{ background: `oklch(0.45 0.12 ${hue(name)})` }}
      aria-hidden
    >
      {Icon ? <Icon className="size-[45%]" /> : initials(name)}
    </span>
  )
}
