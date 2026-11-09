import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { setAuthHandler } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { router } from './router'
import './index.css'

setAuthHandler((code) => {
  const loc = router.state.location
  if (code === 'login_required') {
    if (loc.pathname !== '/login') void router.navigate({ to: '/login', search: { redirect: loc.href }, replace: true })
  } else if (loc.pathname !== '/connect' && loc.pathname !== '/login') {
    void router.navigate({ to: '/connect', replace: true })
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <RouterProvider router={router} />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
