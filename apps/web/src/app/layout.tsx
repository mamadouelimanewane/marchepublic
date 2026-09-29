import type { Metadata } from 'next'
import './tailwind.generated.css'
import { Toaster } from 'sonner'

export const metadata: Metadata = {
  title: 'Marchés Publics Sénégal | Plateforme de Gestion',
  description: 'Plateforme Intégrée de Pilotage du Cycle des Marchés Publics - République du Sénégal',
  keywords: 'marchés publics, sénégal, DCMP, ARCOP, appel d\'offres, procurement',
}

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
      </body>
    </html>
  )
}
