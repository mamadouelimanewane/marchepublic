/* Service worker : accès hors ligne aux pages PUBLIQUES uniquement.
   Sécurité : jamais de mise en cache des pages connectées (/dashboard), des API, des authentifications ni des actions serveur ;
   les données personnelles et les offres ne sont donc jamais stockées sur l'appareil par ce mécanisme. */
const VERSION = 'v1'
const STATIC = `static-${VERSION}`
const PAGES = `pages-${VERSION}`
const OFFLINE_URL = '/hors-ligne'
const PUBLIC_PAGES = [/^\/$/, /^\/avis(\/|$)/, /^\/transparence(\/|$)/, /^\/signalement$/]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(c => c.addAll([OFFLINE_URL, '/icon.svg'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![STATIC, PAGES].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/dashboard')) return   // jamais en cache

  // Ressources statiques versionnées : cache d'abord
  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg') {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(STATIC).then(c => c.put(req, copy)); return res })))
    return
  }

  if (req.mode === 'navigate') {
    const cacheable = PUBLIC_PAGES.some(re => re.test(url.pathname))
    event.respondWith(
      fetch(req).then(res => {
        if (cacheable && res.ok) { const copy = res.clone(); caches.open(PAGES).then(c => c.put(req, copy)) }
        return res
      }).catch(async () => (cacheable ? await caches.match(req) : undefined) || (await caches.match(OFFLINE_URL)))
    )
  }
})
