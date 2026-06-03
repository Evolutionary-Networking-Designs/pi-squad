import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { initializeSquadProject } from './squad-init.js';

const commandsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(commandsDir, '..', '..');
const testRoot = join(packageRoot, '.test-work', 'squad-init');
const vendoredTemplateDirs = ['templates', '.squad-templates'] as const;

async function readVendoredTemplate(name: string): Promise<string> {
  const squadRoot = join(packageRoot, '..', '..', 'squad');

  for (const templateDir of vendoredTemplateDirs) {
    const candidate = join(squadRoot, templateDir, name);

    try {
      return await readFile(candidate, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`Missing vendored Squad template: ${name}`);
}

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe('initializeSquadProject', () => {
  it('seeds ceremonies and casting files from vendored Squad templates', async () => {
    const projectRoot = join(testRoot, 'project');
    await mkdir(projectRoot, { recursive: true });

    const result = await initializeSquadProject(projectRoot);

    expect(result.status).toBe('initialized');
    expect(await readFile(join(projectRoot, '.squad', 'ceremonies.md'), 'utf8')).toBe(
      await readVendoredTemplate('ceremonies.md'),
    );
    expect(await readFile(join(projectRoot, '.squad', 'casting', 'policy.json'), 'utf8')).toBe(
      await readVendoredTemplate('casting-policy.json'),
    );
    expect(await readFile(join(projectRoot, '.squad', 'casting', 'registry.json'), 'utf8')).toBe(
      await readVendoredTemplate('casting-registry.json'),
    );
    expect(await readFile(join(projectRoot, '.squad', 'casting', 'history.json'), 'utf8')).toBe(
      await readVendoredTemplate('casting-history.json'),
    );
  });
});
