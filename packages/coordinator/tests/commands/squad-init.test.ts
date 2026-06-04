import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initializeSquadProject,
  registerSquadInitCommand,
} from '../../src/commands/squad-init.js';

type Handler = (...args: unknown[]) => unknown;

const workspaceRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '../workspaces/squad-init-fixture',
);

const expectedDirectories = [
  '.squad/decisions/inbox',
  '.squad/decisions/processed',
  '.squad/agents',
  '.squad/orchestration-log',
  '.squad/log',
  '.squad/casting',
  '.squad/skills',
  '.squad/identity',
] as const;

function createPiStub() {
  const commands = new Map<string, { description: string; handler: Handler }>();

  return {
    commands,
    api: {
      registerCommand(name: string, command: { description: string; handler: Handler }) {
        commands.set(name, command);
      },
    },
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resetWorkspace(): Promise<void> {
  await rm(workspaceRoot, { recursive: true, force: true });
  await mkdir(workspaceRoot, { recursive: true });
}

beforeEach(async () => {
  await resetWorkspace();
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

describe('squad-init command', () => {
  it('scaffolds the expected .squad directories and seed files', async () => {
    const result = await initializeSquadProject(workspaceRoot);

    expect(result.status).toBe('initialized');

    for (const directory of expectedDirectories) {
      await expect(pathExists(join(workspaceRoot, directory))).resolves.toBe(true);
    }

    const team = await readFile(join(workspaceRoot, '.squad/team.md'), 'utf8');
    expect(team).toContain('## Members');
    for (const member of [
      'Motoko',
      'Batou',
      'Togusa',
      'Ishikawa',
      'Saito',
      'Borma',
      'Paz',
      'Aramaki',
      'Scribe',
      'Ralph',
    ]) {
      expect(team).toContain(`| ${member} |`);
    }

    const routing = await readFile(join(workspaceRoot, '.squad/routing.md'), 'utf8');
    expect(routing).toContain('| Architecture & scope | Motoko |');
    expect(routing).toContain('| Session logging | Scribe |');
    expect(routing).toContain('| Work monitoring | Ralph |');

    await expect(readFile(join(workspaceRoot, '.squad/decisions.md'), 'utf8')).resolves.toBe(
      '# Decisions\n',
    );

    const ceremonies = await readFile(join(workspaceRoot, '.squad/ceremonies.md'), 'utf8');
    expect(ceremonies).toContain('# Ceremonies');
    expect(ceremonies).toContain('## Design Review');
    expect(ceremonies).toContain('## Retrospective');
  });

  it('guards against re-initialization when team.md already exists', async () => {
    const teamPath = join(workspaceRoot, '.squad/team.md');
    await mkdir(join(workspaceRoot, '.squad'), { recursive: true });
    await writeFile(teamPath, '# Existing Team\n', 'utf8');

    const result = await initializeSquadProject(workspaceRoot);

    expect(result).toMatchObject({
      status: 'already_initialized',
      teamPath,
    });
    await expect(readFile(teamPath, 'utf8')).resolves.toBe('# Existing Team\n');
  });

  it('registers /squad-init and reports how to proceed', async () => {
    const pi = createPiStub();
    registerSquadInitCommand(pi.api as never);

    const command = pi.commands.get('squad-init');
    expect(command?.description).toBe('Initialize .squad scaffolding for this project');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await command?.handler('', {
      cwd: workspaceRoot,
      hasUI: false,
      ui: { notify: vi.fn() },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Initialized Squad for this project.'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Use `/squad` to start the coordinator.'),
    );

    logSpy.mockRestore();
  });
});
