import { AuthForm } from '@/components/AuthForm'

export const metadata = { title: 'Connexion | Marchés Publics Sénégal' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redirect?: string; error?: string }> }) {
  const { redirect, error } = await searchParams
  const notice = error === 'profil' ? 'Votre profil est introuvable ou désactivé. Contactez l\'administrateur.'
    : error === 'callback' ? 'Le lien de confirmation est invalide ou expiré.' : undefined
  return <AuthForm mode="login" redirectTo={redirect} notice={notice} />
}
