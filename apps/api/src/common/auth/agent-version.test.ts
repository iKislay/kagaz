import { describe, expect, it } from 'vitest';
import { compareVersions, isUpgradeRequired } from './agent-version.guard.js';

describe('agent versions (P4.4)', () => {
  it('compares dotted numeric versions', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.3', '0.3.0')).toBe(0);
    expect(compareVersions('v1.2.0-beta+5', '1.2.0')).toBe(0);
    expect(compareVersions('0.2.9', '0.3.0')).toBe(-1);
  });

  it('requires an upgrade only for a known version below the minimum', () => {
    expect(isUpgradeRequired('0.2.0', '0.3.0')).toBe(true);
    expect(isUpgradeRequired('0.3.0', '0.3.0')).toBe(false);
    expect(isUpgradeRequired(null, '0.3.0')).toBe(false);
    expect(isUpgradeRequired('0.1.0', undefined)).toBe(false);
  });
});
