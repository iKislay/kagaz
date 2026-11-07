import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md invariant 3 / FR-PAY-01: `orders/` must never depend on a payment provider
 * implementation (demo or live). It may not import anything from payments/ except the
 * provider-independent interface, and no gateway SDK at all.
 */
const here = dirname(fileURLToPath(import.meta.url));
const ordersDir = resolve(here, '../orders');
const paymentsDir = here;

const ALLOWED_PAYMENTS_IMPORTS = new Set(['payment-provider.ts']);
const GATEWAY_PATTERN = /razorpay|cashfree|stripe|paytm|phonepe|demo-mock|demo-gateway/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(re)) specs.push((m[1] ?? m[2])!);
  return specs;
}

describe('payment provider boundary', () => {
  const files = walk(ordersDir);

  it('finds the orders module', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('orders/** imports nothing from provider implementations', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        const where = `${relative(ordersDir, file)} → ${spec}`;
        if (GATEWAY_PATTERN.test(spec)) {
          violations.push(where);
          continue;
        }
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
        const rel = relative(paymentsDir, target);
        if (!rel.startsWith('..') && !ALLOWED_PAYMENTS_IMPORTS.has(rel)) violations.push(where);
      }
    }
    expect(violations).toEqual([]);
  });

  it('the checker catches a forbidden import', () => {
    const specs = importsOf(
      "import { DemoMockProvider } from '../payments/demo-mock.provider.js';\nimport x from 'razorpay';",
    );
    expect(specs.filter((s) => GATEWAY_PATTERN.test(s))).toHaveLength(2);
  });
});
