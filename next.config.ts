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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.facebook.com https://connect.facebook.net https://snap.licdn.com https://www.googleadservices.com https://analytics.tiktok.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.asaas.com https://www.facebook.com https://connect.facebook.net https://*.facebook.net https://*.facebook.com https://analytics.tiktok.com",
      "frame-ancestors 'self'",
    ].join('; '),
  },
  ...commonSecurityHeaders,
];

const embeddableFormHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.facebook.com https://connect.facebook.net https://snap.licdn.com https://www.googleadservices.com https://analytics.tiktok.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https: blob:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.asaas.com https://www.facebook.com https://connect.facebook.net https://*.facebook.net https://*.facebook.com https://analytics.tiktok.com",
      'frame-ancestors *',
    ].join('; '),
  },
  ...commonSecurityHeaders,
];

const nextConfig: NextConfig = {
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
