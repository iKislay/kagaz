import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit tests only (no Docker needed). End-to-end tests: vitest.e2e.config.ts / `pnpm test:e2e`.
export default defineConfig({
  // SWC emits decorator metadata, which NestJS dependency injection needs.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
