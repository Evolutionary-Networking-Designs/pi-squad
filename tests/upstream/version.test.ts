import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { checkCompatibility } from '../../src/upstream/version.js';

type PackageSquadMeta = {
  version: string;
  minVersion: string;
  maxVersion: string;
  commit?: string;
};

function readSquadMeta(): PackageSquadMeta {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw) as { squad: PackageSquadMeta };
  return pkg.squad;
}

describe('checkCompatibility', () => {
  const meta = readSquadMeta();

  it('accepts a Squad version within the supported bounds', () => {
    const result = checkCompatibility('0.9.4', meta);

    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects a Squad version below minVersion', () => {
    const result = checkCompatibility('0.8.0', meta);

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain(meta.minVersion);
  });

  it('rejects a Squad version above maxVersion', () => {
    const result = checkCompatibility('0.11.0', meta);

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain(meta.maxVersion);
  });

  it('accepts the exact minimum boundary', () => {
    const result = checkCompatibility(meta.minVersion, meta);

    expect(result.compatible).toBe(true);
  });

  it('accepts the 0.10.x upper compatibility boundary', () => {
    const result = checkCompatibility('0.10.0', meta);

    expect(result.compatible).toBe(true);
  });

  it('handles invalid semver strings without throwing', () => {
    expect(() => checkCompatibility('not-a-version', meta)).not.toThrow();

    const result = checkCompatibility('not-a-version', meta);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('not valid semver');
  });
});
