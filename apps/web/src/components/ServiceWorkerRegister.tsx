'use client'

import { useEffect } from 'react'

/** Enregistre le service worker (accès hors ligne aux pages publiques) en production uniquement. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* non bloquant */ })
    }
  }, [])
  return null
}
