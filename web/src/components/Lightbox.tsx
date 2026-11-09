// Full screen image view, copied from mastermem's MediaLightbox (web/src/components/dash/FileMedia.tsx):
// the image centered, Download and Close top right, a click beside the image or Escape closes.
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Download, X } from 'lucide-react'

export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  const btn = 'grid size-10 cursor-pointer place-items-center rounded-full bg-white/10 text-white/85 hover:bg-white/20 hover:text-white'
  return (
    <DialogPrimitive.Root open={!!src} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onClick={(e) => e.target === e.currentTarget && onClose()}
          className="fixed inset-0 z-50 grid place-items-center p-4 pt-16 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] motion-reduce:animate-none"
        >
          <DialogPrimitive.Title className="sr-only">Image</DialogPrimitive.Title>
          {src && <img src={src} alt="" className="max-h-[calc(100dvh-6rem)] max-w-full rounded-lg object-contain shadow-2xl" />}
          <div className="fixed top-3 right-3 flex gap-2">
            {src && (
              <a href={src} download aria-label="Download" className={btn}>
                <Download className="size-5" />
              </a>
            )}
            <DialogPrimitive.Close aria-label="Close" className={btn}>
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
