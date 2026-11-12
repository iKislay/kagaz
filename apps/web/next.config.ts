import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Local development: share the repo-root .env (NEXT_PUBLIC_API_URL etc.).
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // NEXT_PUBLIC_API_PROXY=1 (see src/lib/api.ts): browser /api/* is forwarded to the real API.
  async rewrites() {
    const api = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
    return process.env.NEXT_PUBLIC_API_PROXY === '1' && api
      ? [{ source: '/api/:path*', destination: `${api}/:path*` }]
      : [];
  },
  // Security headers (security review M1): no framing (clickjacking on /admin), no MIME sniffing,
  // no referrer leaks of tracking links (#t=… is a fragment, but keep paths private too).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
  // Docker image (apps/web/Dockerfile) builds a self-contained server; local dev is unchanged.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      }
    : {}),
};

export default nextConfig;
