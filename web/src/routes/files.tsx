import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Download, ExternalLink, File, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Presentation } from 'lucide-react'
import { ErrorView } from '@/components/ErrorView'
import { Skeleton } from '@/components/ui/skeleton'
import { shortTime } from '@/lib/format'
import { q } from '@/lib/query'
import type { DriveItem } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICONS: [RegExp, typeof File][] = [
  [/\.(pdf|docx?|odt|rtf|txt|md)$/i, FileText],
  [/\.(pptx?|ppsx?|odp|key)$/i, Presentation],
  [/\.(xlsx?|ods|csv)$/i, FileSpreadsheet],
  [/\.(png|jpe?g|gif|webp|heic|bmp)$/i, FileImage],
  [/\.(mp4|mov|webm|mkv|avi)$/i, FileVideo],
]

const iconFor = (name: string) => ICONS.find(([re]) => re.test(name))?.[1] ?? File

function size(n: number | null) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

const viewUrl = (drive: string, id: string, download = false) =>
  `/api/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(id)}/view${download ? '?download=true' : ''}`

/** Files tab of a channel: its SharePoint folder, browsable, files open in the browser. */
export function ChannelFiles({ teamId, channelId }: { teamId: string; channelId: string }) {
  const root = useQuery(q.channelFiles(teamId, channelId))
  const [path, setPath] = useState<{ id: string; name: string }[]>([])
  const drive = root.data?.drive ?? ''
  const current = path[path.length - 1]
  const sub = useQuery({ ...q.folder(drive, current?.id ?? ''), enabled: !!current && !!drive })
  const list = current ? sub : root

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto px-3 text-sm md:px-6">
        <button className="shrink-0 rounded px-1.5 py-0.5 hover:bg-white/10" onClick={() => setPath([])}>
          {root.data?.name || 'Files'}
        </button>
        {path.map((p, i) => (
          <span key={p.id} className="flex shrink-0 items-center gap-1">
            <ChevronRight className="size-4 text-muted-foreground" />
            <button className="rounded px-1.5 py-0.5 hover:bg-white/10" onClick={() => setPath(path.slice(0, i + 1))}>
              {p.name}
            </button>
          </span>
        ))}
        <span className="flex-1" />
        {!current && root.data?.webUrl && (
          <a
            href={root.data.webUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            aria-label="Open in SharePoint"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 md:px-4">
        {list.isError && <ErrorView error={list.error} retry={() => void list.refetch()} />}
        {list.isPending && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mx-2 mb-2 h-10 rounded-lg" />)}
        {list.data && !list.data.items.length && <p className="p-10 text-center text-muted-foreground">Empty</p>}
        {list.data?.items.map((it) => (
          <Row key={it.id} it={it} drive={drive} open={() => setPath([...path, { id: it.id, name: it.name }])} />
        ))}
      </div>
    </div>
  )
}

function Row({ it, drive, open }: { it: DriveItem; drive: string; open: () => void }) {
  const Icon = it.folder ? Folder : iconFor(it.name)
  const body = (
    <>
      <Icon className={cn('size-5 shrink-0', it.folder ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">{it.name}</span>
      <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:block">
        {it.folder ? (it.count != null ? `${it.count}` : '') : size(it.size)}
      </span>
      <span className="w-12 shrink-0 text-right text-xs text-muted-foreground">{shortTime(it.modified)}</span>
    </>
  )
  const cls = 'flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left'
  return (
    <div className="group flex items-center rounded-lg text-sm transition-colors hover:bg-white/5">
      {it.folder ? (
        <button className={cls} onClick={open}>
          {body}
        </button>
      ) : (
        <a className={cls} href={viewUrl(drive, it.id)} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      )}
      {!it.folder && (
        <a
          href={viewUrl(drive, it.id, true)}
          className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-foreground"
          aria-label="Download"
        >
          <Download className="size-4" />
        </a>
      )}
    </div>
  )
}
