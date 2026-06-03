import { describe, expect, it } from 'vitest';

import { checkCompatibility, type SquadVersionMeta } from './version.js';

describe('checkCompatibility', () => {
  const meta: SquadVersionMeta = {
    version: '0.9.4',
    minVersion: '0.9.0',
    maxVersion: '0.10.x',
  };

  it('returns compatible for versions within range', () => {
    const result = checkCompatibility('0.9.5', meta);
    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns incompatible when below minimum', () => {
    const result = checkCompatibility('0.8.9', meta);
    expect(result.compatible).toBe(false);
  });

  it('returns incompatible when above maximum', () => {
    const result = checkCompatibility('0.11.0', meta);
    expect(result.compatible).toBe(false);
  });

  it('accepts version at minimum boundary', () => {
    const result = checkCompatibility('0.9.0', meta);
    expect(result.compatible).toBe(true);
  });

  it('handles invalid semver gracefully', () => {
    expect(() => checkCompatibility('definitely-not-semver', meta)).not.toThrow();
    const result = checkCompatibility('definitely-not-semver', meta);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('not valid semver');
  });
});
