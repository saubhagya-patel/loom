import './ui/tokens.css'
import './App.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'

/**
 * Every route is lazy, and that is the point rather than a nicety.
 *
 * The standalone tools exist for someone on an Android phone who has never heard of Loom. If
 * `/tools/heic-viewer` pulled the auth stack, the upload engine and the Drive client along
 * with it, they would download the entire product to look at one photo. Importing a shared
 * helper from the wrong module quietly undoes this, which is why the phase plan checks it.
 */
const router = createBrowserRouter([
  {
    path: '/',
    lazy: async () => ({ Component: (await import('./App.tsx')).default }),
  },
  {
    path: '/tools/heic-viewer',
    lazy: async () => ({ Component: (await import('./tools/HeicViewer.tsx')).HeicViewer }),
  },
  {
    path: '/tools/heic-to-zip',
    lazy: async () => ({ Component: (await import('./tools/HeicToZip.tsx')).HeicToZip }),
  },
  {
    path: '*',
    lazy: async () => ({ Component: (await import('./tools/NotFound.tsx')).NotFound }),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
