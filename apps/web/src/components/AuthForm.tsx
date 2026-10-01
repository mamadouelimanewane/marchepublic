'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { loginSchema, registerSchema, formatZodError } from '@marchepublic/validators'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

const input = 'mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-600'

/** Redirection post-connexion limitée aux chemins internes. */
function safeRedirect(target: string | undefined) {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : '/dashboard'
}

export function AuthForm({ mode, redirectTo, notice }: { mode: 'login' | 'register'; redirectTo?: string; notice?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = Object.fromEntries(new FormData(e.currentTarget).entries())
    const parsed = (mode === 'login' ? loginSchema : registerSchema).safeParse(form)
    if (!parsed.success) return toast.error(formatZodError(parsed.error))
    setBusy(true)
    const supabase = createSupabaseBrowserClient()
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: (parsed.data as { password: string }).password })
        if (error) throw new Error('Identifiants incorrects.')
        router.replace(safeRedirect(redirectTo))
        router.refresh()
      } else {
        const d = parsed.data as { email: string; password: string; full_name: string }
        const { data, error } = await supabase.auth.signUp({
          email: d.email, password: d.password,
          // Le rôle n'est jamais lu depuis ces métadonnées : tout compte créé ici est un soumissionnaire.
          options: { data: { full_name: d.full_name }, emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
        })
        if (error) throw new Error(error.message)
        if (data.session) { router.replace('/dashboard'); router.refresh() }
        else toast.success('Compte créé. Consultez votre boîte e-mail pour confirmer votre adresse.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur inattendue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-3xl">🇸🇳</p>
          <h1 className="mt-2 text-xl font-bold text-gray-900">{mode === 'login' ? 'Connexion' : 'Inscription soumissionnaire'}</h1>
          <p className="text-sm text-gray-500">Plateforme des marchés publics du Sénégal</p>
        </div>
        {notice && <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{notice}</p>}
        <form onSubmit={submit} className="space-y-4" noValidate>
          {mode === 'register' && (
            <label className="block text-sm font-medium text-gray-700">Nom complet ou raison sociale
              <input name="full_name" required autoComplete="name" className={input} />
            </label>
          )}
          <label className="block text-sm font-medium text-gray-700">Adresse e-mail
            <input name="email" type="email" required autoComplete="email" className={input} />
          </label>
          <label className="block text-sm font-medium text-gray-700">Mot de passe
            <input name="password" type="password" required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className={input} />
            {mode === 'register' && <span className="mt-1 block text-xs font-normal text-gray-500">10 caractères minimum, avec au moins une lettre et un chiffre.</span>}
          </label>
          <button disabled={busy} className="w-full rounded-lg bg-green-700 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50">
            {busy ? 'Veuillez patienter…' : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-500">
          {mode === 'login'
            ? <>Entreprise candidate ? <Link className="font-medium text-green-700 hover:underline" href="/register">Créer un compte</Link></>
            : <>Déjà inscrit ? <Link className="font-medium text-green-700 hover:underline" href="/login">Se connecter</Link></>}
        </p>
        {mode === 'register' && (
          <p className="mt-3 text-center text-xs text-gray-400">Les comptes des autorités contractantes, de la DCMP et de l'ARCOP sont créés par l'administrateur de la plateforme.</p>
        )}
      </div>
    </div>
  )
}
