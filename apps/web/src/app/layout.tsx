import type { Metadata, Viewport } from 'next'
import './tailwind.generated.css'
import { Toaster } from 'sonner'
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister'

export const metadata: Metadata = {
  title: 'Marchés Publics Sénégal | Plateforme de Gestion',
  description: 'Plateforme Intégrée de Pilotage du Cycle des Marchés Publics - République du Sénégal',
  keywords: 'marchés publics, sénégal, DCMP, ARCOP, appel d\'offres, procurement',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
}

export const viewport: Viewport = { themeColor: '#14532d', width: 'device-width', initialScale: 1 }

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="font-sans">
        {children}
        <Toaster position="top-right" richColors />
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
