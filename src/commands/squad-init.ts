import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';

import type { Coordinator } from '../coordinator/coordinator.js';
import { detectEnvironment } from './squad-init/detect.js';

const SQUAD_DIR = '.squad';
const DIRECTORIES = [
  '.squad/decisions/inbox',
  '.squad/decisions/processed',
  '.squad/agents',
  '.squad/orchestration-log',
  '.squad/log',
  '.squad/casting',
  '.squad/skills',
  '.squad/identity',
] as const;

const TEAM_SEED = `# Squad Team

> Initialized by @pi-squad/coordinator

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Motoko | Lead / Architect | — | ✅ Active |
| Batou | Builder / Implementer | — | ✅ Active |
| Togusa | Testing / Verification | — | ✅ Active |
| Ishikawa | Research / Debugging | — | ✅ Active |
| Saito | Review / Quality | — | ✅ Active |
| Borma | Docs / Developer Experience | — | ✅ Active |
| Paz | Retrieval / Ingestion | — | ✅ Active |
| Aramaki | Operations / Priorities | — | ✅ Active |
| Scribe | Session Logger | — | 📋 Silent |
| Ralph | Work Monitor | — | 🔄 Monitor |
`;

const ROUTING_SEED = `# Work Routing

How to decide who handles what.

## Routing Table

| Work Type | Route To | Examples |
|-----------|----------|----------|
| Architecture & scope | Motoko | System design, decomposition, trade-offs |
| Implementation | Batou | Features, refactors, bug fixes |
| Testing & verification | Togusa | Tests, repros, regressions |
| Research & debugging | Ishikawa | Investigation, tracing, root-cause analysis |
| Code review & quality | Saito | Reviews, acceptance checks, safety passes |
| Docs & developer UX | Borma | Documentation, onboarding, contributor ergonomics |
| Retrieval & ingestion | Paz | Context systems, indexing, embeddings, ingestion |
| Operations & escalation | Aramaki | Priorities, unblockers, project coordination |
| Session logging | Scribe | Automatic — never needs routing |
| Work monitoring | Ralph | Automatic — never needs routing |

## Rules

1. Route architecture and cross-cutting work to Motoko.
2. Route implementation to Batou unless another specialty is primary.
3. Route tests and verification to Togusa.
4. Route investigations and root-cause analysis to Ishikawa.
5. Route review and quality gates to Saito.
6. Route docs and developer experience to Borma.
7. Route retrieval, ingestion, and context systems to Paz.
8. Route operations, priorities, and escalation to Aramaki.
9. Scribe records substantial work automatically.
10. Ralph monitors work health automatically.
`;

const DECISIONS_SEED = '# Decisions\n';
const CEREMONIES_SEED = '# Ceremonies\n';
const CASTING_POLICY_SEED = `{
  "casting_policy_version": "1.1",
  "allowlist_universes": [
    "The Usual Suspects",
    "Reservoir Dogs",
    "Alien",
    "Ocean's Eleven",
    "Arrested Development",
    "Star Wars",
    "The Matrix",
    "Firefly",
    "The Goonies",
    "The Simpsons",
    "Breaking Bad",
    "Lost",
    "Marvel Cinematic Universe",
    "DC Universe",
    "Futurama"
  ],
  "universe_capacity": {
    "The Usual Suspects": 6,
    "Reservoir Dogs": 8,
    "Alien": 8,
    "Ocean's Eleven": 14,
    "Arrested Development": 15,
    "Star Wars": 12,
    "The Matrix": 10,
    "Firefly": 10,
    "The Goonies": 8,
    "The Simpsons": 20,
    "Breaking Bad": 12,
    "Lost": 18,
    "Marvel Cinematic Universe": 25,
    "DC Universe": 18,
    "Futurama": 12
  }
}
`;
const CASTING_REGISTRY_SEED = `{
  "agents": {}
}
`;
const CASTING_HISTORY_SEED = `{
  "universe_usage_history": [],
  "assignment_cast_snapshots": {}
}
`;
const SQUAD_TEMPLATE_DIRECTORIES = ['templates', '.squad-templates'] as const;

interface SeedFile {
  path: string;
  content: string;
}

export type SquadInitResult =
  | {
      readonly status: 'already_initialized';
      readonly projectRoot: string;
      readonly teamPath: string;
    }
  | {
      readonly status: 'initialized';
      readonly projectRoot: string;
      readonly createdDirectories: readonly string[];
      readonly createdFiles: readonly string[];
    };

function packageRootFromThisFile(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return join(dirname(thisFile), '..', '..');
}

function resolveSquadDirectoryCandidates(): string[] {
  const packageRoot = packageRootFromThisFile();
  return [join(packageRoot, 'squad'), join(packageRoot, '..', '..', 'squad')];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadSquadTemplate(name: string, fallback: string): Promise<string> {
  for (const squadDir of resolveSquadDirectoryCandidates()) {
    for (const templateDir of SQUAD_TEMPLATE_DIRECTORIES) {
      const templatePath = join(squadDir, templateDir, name);
      if (await pathExists(templatePath)) {
        return readFile(templatePath, 'utf8');
      }
    }
  }

  return fallback;
}

async function ensureDirectory(path: string): Promise<boolean> {
  if (await pathExists(path)) {
    return false;
  }

  await mkdir(path, { recursive: true });
  return true;
}

async function ensureFile(path: string, content: string): Promise<boolean> {
  if (await pathExists(path)) {
    return false;
  }

  await writeFile(path, content, 'utf8');
  return true;
}

function formatPaths(projectRoot: string, paths: readonly string[]): string {
  return paths.map((entry) => `- ${relative(projectRoot, entry) || '.'}`).join('\n');
}

function formatMessage(result: SquadInitResult): string {
  if (result.status === 'already_initialized') {
    return 'Squad is already initialized in this project. Use `/squad` to start.';
  }

  return [
    'Initialized Squad for this project.',
    '',
    'Created directories:',
    formatPaths(result.projectRoot, result.createdDirectories),
    '',
    'Created files:',
    formatPaths(result.projectRoot, result.createdFiles),
    '',
    'Next steps:',
    '- Review `.squad/team.md` and `.squad/routing.md` to tailor the roster.',
    '- Use `/squad` to start the coordinator.',
  ].join('\n');
}

function emitMessage(ctx: ExtensionCommandContext, message: string): void {
  console.log(message);

  if (ctx.hasUI) {
    ctx.ui.notify(message, 'info');
  }
}

export async function initializeSquadProject(projectRoot: string): Promise<SquadInitResult> {
  const teamPath = join(projectRoot, SQUAD_DIR, 'team.md');
  if (await pathExists(teamPath)) {
    return {
      status: 'already_initialized',
      projectRoot,
      teamPath,
    };
  }

  const createdDirectories: string[] = [];
  for (const directory of DIRECTORIES) {
    const absolutePath = join(projectRoot, directory);
    if (await ensureDirectory(absolutePath)) {
      createdDirectories.push(absolutePath);
    }
  }

  const [ceremonies, castingPolicy, castingRegistry, castingHistory] = await Promise.all([
    loadSquadTemplate('ceremonies.md', CEREMONIES_SEED),
    loadSquadTemplate('casting-policy.json', CASTING_POLICY_SEED),
    loadSquadTemplate('casting-registry.json', CASTING_REGISTRY_SEED),
    loadSquadTemplate('casting-history.json', CASTING_HISTORY_SEED),
  ]);

  const seedFiles: SeedFile[] = [
    { path: '.squad/team.md', content: TEAM_SEED },
    { path: '.squad/routing.md', content: ROUTING_SEED },
    { path: '.squad/decisions.md', content: DECISIONS_SEED },
    { path: '.squad/ceremonies.md', content: ceremonies },
    { path: '.squad/casting/policy.json', content: castingPolicy },
    { path: '.squad/casting/registry.json', content: castingRegistry },
    { path: '.squad/casting/history.json', content: castingHistory },
  ];

  const createdFiles: string[] = [];
  for (const seedFile of seedFiles) {
    const absolutePath = join(projectRoot, seedFile.path);
    if (await ensureFile(absolutePath, seedFile.content)) {
      createdFiles.push(absolutePath);
    }
  }

  return {
    status: 'initialized',
    projectRoot,
    createdDirectories,
    createdFiles,
  };
}

export function registerSquadInitCommand(pi: ExtensionAPI, coordinator?: Coordinator): void {
  pi.registerCommand('squad-init', {
    description: 'Initialize .squad scaffolding for this project',
    handler: async (_args, ctx) => {
      const teamPath = join(ctx.cwd, '.squad', 'team.md');
      if (await pathExists(teamPath)) {
        coordinator?.clearInitMode();
        emitMessage(ctx, 'Squad is already initialized in this project. Use `/squad` to start.');
        return;
      }

      const { userName, projectName, detectedExtensions } = await detectEnvironment(ctx.cwd);
      coordinator?.setInitMode({ userName, projectName, detectedExtensions });

      const greeting = userName ? `Hey ${userName}` : 'Hey';
      const message =
        `${greeting} — starting Squad setup. I'll ask a few questions to build your team.\n` +
        'Initialized Squad for this project.\n' +
        'Type anything to begin, or use /squad to skip setup and scaffold a default team directly.\n' +
        'Use `/squad` to start the coordinator.';
      emitMessage(ctx, message);
    },
  });
}
