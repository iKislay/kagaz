import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Server-side external packages (not bundled by webpack/turbopack)
  serverExternalPackages: ['mongoose', 'formidable'],

  // Empty turbopack config silences the "webpack config with no turbopack config" warning
  turbopack: {},

  // Allow ngrok domains to make API calls in development (bypasses Next.js 15 CSRF protection)
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok.io', '*.ngrok.app'],
}

export default nextConfig
