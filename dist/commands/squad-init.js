import { access, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { detectEnvironment } from "./squad-init/detect.js";
const SQUAD_DIR = ".squad";
const DIRECTORIES = [
    ".squad/decisions/inbox",
    ".squad/decisions/processed",
    ".squad/agents",
    ".squad/orchestration-log",
    ".squad/log",
    ".squad/casting",
    ".squad/skills",
    ".squad/identity",
];
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
const DECISIONS_SEED = "# Decisions\n";
const CEREMONIES_SEED = "# Ceremonies\n";
const SEED_FILES = [
    { path: ".squad/team.md", content: TEAM_SEED },
    { path: ".squad/routing.md", content: ROUTING_SEED },
    { path: ".squad/decisions.md", content: DECISIONS_SEED },
    { path: ".squad/ceremonies.md", content: CEREMONIES_SEED },
];
async function pathExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function ensureDirectory(path) {
    if (await pathExists(path)) {
        return false;
    }
    await mkdir(path, { recursive: true });
    return true;
}
async function ensureFile(path, content) {
    if (await pathExists(path)) {
        return false;
    }
    await writeFile(path, content, 'utf8');
    return true;
}
function formatPaths(projectRoot, paths) {
    return paths.map((entry) => `- ${relative(projectRoot, entry) || '.'}`).join('\n');
}
function formatMessage(result) {
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
function emitMessage(ctx, message) {
    console.log(message);
    if (ctx.hasUI) {
        ctx.ui.notify(message, 'info');
    }
}
export async function initializeSquadProject(projectRoot) {
    const teamPath = join(projectRoot, SQUAD_DIR, 'team.md');
    if (await pathExists(teamPath)) {
        return {
            status: 'already_initialized',
            projectRoot,
            teamPath,
        };
    }
    const createdDirectories = [];
    for (const directory of DIRECTORIES) {
        const absolutePath = join(projectRoot, directory);
        if (await ensureDirectory(absolutePath)) {
            createdDirectories.push(absolutePath);
        }
    }
    const createdFiles = [];
    for (const seedFile of SEED_FILES) {
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
export function registerSquadInitCommand(pi, coordinator) {
    pi.registerCommand("squad-init", {
        description: "Initialize .squad scaffolding for this project",
        handler: async (_args, ctx) => {
            const teamPath = join(ctx.cwd, ".squad", "team.md");
            if (await pathExists(teamPath)) {
                coordinator?.clearInitMode();
                emitMessage(ctx, "Squad is already initialized in this project. Use `/squad` to start.");
                return;
            }
            const { userName, projectName, detectedExtensions } = await detectEnvironment(ctx.cwd);
            coordinator?.setInitMode({ userName, projectName, detectedExtensions });
            const greeting = userName ? `Hey ${userName}` : "Hey";
            const message = `${greeting} — starting Squad setup. I'll ask a few questions to build your team.\n` +
                "Initialized Squad for this project.\n" +
                "Type anything to begin, or use /squad to skip setup and scaffold a default team directly.\n" +
                "Use `/squad` to start the coordinator.";
            emitMessage(ctx, message);
        },
    });
}
//# sourceMappingURL=squad-init.js.map