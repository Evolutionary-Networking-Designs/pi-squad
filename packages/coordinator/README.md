# @pi-squad/coordinator

Multi-team coordinator for Pi agents. Embeds Squad's multi-agent coordination into the Pi CLI runtime.

## Install

```bash
npm install @pi-squad/coordinator
```

## Setup

After installing the package, you need to:

### 1. Enable the extension in Pi

Add `@pi-squad/coordinator` to your Pi configuration.

Edit `~/.pi/config.json` (create if it doesn't exist):

```json
{
  "extensions": ["@pi-squad/coordinator"]
}
```

For more details on Pi configuration, see the [Pi CLI documentation](https://github.com/earendil-works/pi).

### 2. Create your `.squad/` directory

The coordinator requires a `.squad/` folder with at least two files: `team.md` (your team roster) and `routing.md` (dispatch rules).

Create the folder in your project root:

```bash
mkdir -p .squad
```

**Minimum `team.md`** — Define your team members:

```markdown
# Team

## Members
- **coordinator** — orchestrator
```

**Minimum `routing.md`** — Define dispatch rules:

```markdown
# Routing

## Rules
- Default: coordinator
```

### 3. Initialize with `/squad-init` (optional)

If starting fresh, you can scaffold `.squad/` interactively using Pi's `/squad-init` command:

```bash
pi
# Inside Pi REPL:
> /squad-init
```

This guided wizard will detect your git user, installed Pi extensions, and project signals to set up a sensible initial configuration.

### 4. Verify it works

Start Pi normally. The coordinator system prompt will be injected automatically at the beginning of each agent session. No additional commands are needed — it's automatic.

```bash
pi
```

## Usage

This package is a Pi CLI extension. It hooks the `before_agent_start` event to inject the Squad coordinator system prompt, and registers a `/squad` command for manual coordinator invocation.

## Development

```bash
npm run build   # tsc → dist/
npm run dev     # tsc --watch
npm test        # vitest run
```

See the root [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for the full design specification.

## Security

This repo includes a pre-push git hook that scans `src/` for restricted terms before each push.
Enable it with:

```bash
git config core.hooksPath .githooks
```

Add your restricted terms to `.githooks/.boundary-terms` (one term per line, `#` for comments).
This file is gitignored — terms stay local to your checkout.

## Credits

`@pi-squad/coordinator` is built on the shoulders of three open-source projects:

- **[Pi](https://github.com/earendil-works/pi)** — the CLI runtime this extension runs inside. © 2025 Mario Zechner. MIT License.

- **[Squad](https://github.com/bradygaster/squad)** — the multi-agent coordination layer. Squad source is vendored at `squad/` and loaded at runtime. © 2026 Brady Gaster and contributors. MIT License.

- **[rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)** — questionnaire schema and UX pattern used by the built-in `ask_user_question` tool. © 2026 juicesharp. Install `@juicesharp/rpiv-ask-user-question` for the full tabbed TUI with previews and localization. MIT License.
