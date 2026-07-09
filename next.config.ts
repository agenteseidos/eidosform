import type { NextConfig } from "next";

const commonSecurityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const protectedAppHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://*.googletagmanager.com https://www.google-analytics.com https://ssl.google-analytics.com https://www.facebook.com https://connect.facebook.net https://snap.licdn.com https://www.googleadservices.com https://www.google.com https://analytics.tiktok.com https://*.doubleclick.net https://assets.calendly.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.asaas.com https://www.facebook.com https://connect.facebook.net https://*.facebook.net https://*.facebook.com https://analytics.tiktok.com https://*.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.google.com https://*.googleadservices.com https://www.google.com/pagead https://*.doubleclick.net https://viacep.com.br https://calendly.com https://*.calendly.com",
      "frame-src 'self' https:",
      "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
  },
  ...commonSecurityHeaders,
];

// A2 (auditoria 2026-06-10): a CSP do player público é gerada por request no
// middleware (nonce + strict-dynamic) — ver buildFormPlayerCsp em middleware.ts.
// Definir uma segunda CSP estática aqui faria o browser aplicar a interseção
// das duas, quebrando o nonce. Apenas os headers comuns ficam aqui.
const embeddableFormHeaders = [
  ...commonSecurityHeaders,
];

const nextConfig: NextConfig = {
  // next/image bloqueia host remoto por padrão — sem isto, imagens servidas do
  // Supabase Storage (welcome image, anexos) quebram no <Image> (400 no /_next/image).
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/f/:slug',
        headers: embeddableFormHeaders,
      },
      {
        source: '/((?!f/).*)',
        headers: protectedAppHeaders,
      },
    ];
  },
};

export default nextConfig;
