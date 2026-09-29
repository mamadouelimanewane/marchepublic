import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'

const inter = Inter({ subsets: ['latin'] })

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
      <body className={inter.className}>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
