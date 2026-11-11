import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Local development: share the repo-root .env (NEXT_PUBLIC_* site settings).
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * kaggaz.app is a static site: `next build` writes plain HTML/CSS/JS to `out/`, served by any
 * static host (Cloudflare Pages, see docs/runbooks/LANDING_SITE.md). NEXT_PUBLIC_* settings are
 * baked in at build time — change them and rebuild. Security headers live in public/_headers.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default nextConfig;
