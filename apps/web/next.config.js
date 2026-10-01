const isDev = process.env.NODE_ENV !== 'production'

// Origines Supabase autorisées pour les connexions du navigateur (API, stockage, temps réel).
// En développement, la pile locale `supabase start` écoute sur 127.0.0.1:54321.
const connectSrc = [
  "'self'",
  'https://*.supabase.co',
  'wss://*.supabase.co',
  ...(isDev ? ['http://127.0.0.1:54321', 'http://localhost:54321', 'ws://127.0.0.1:54321', 'ws://localhost:54321'] : []),
].join(' ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Les paquets du monorepo sont en TypeScript source.
  transpilePackages: ['@marchepublic/workflow', '@marchepublic/validators', '@marchepublic/ui', '@marchepublic/db'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
  // Faible débit : compression activée
  compress: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            // blob: : aperture locale des plis déchiffrés (PDF) dans le navigateur de la commission.
            value: `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; frame-src 'self' blob:; object-src 'self' blob:; connect-src ${connectSrc}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
