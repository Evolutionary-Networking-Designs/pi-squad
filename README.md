# @pi-squad/coordinator

Multi-team coordinator for Pi agents. Embeds Squad's multi-agent coordination into the Pi CLI runtime.

## Install

```bash
npm install @pi-squad/coordinator
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

## Credits

`@pi-squad/coordinator` is built on the shoulders of three open-source projects:

- **[Pi](https://github.com/earendil-works/pi)** — the CLI runtime this extension runs inside. © 2025 Mario Zechner. MIT License.

- **[Squad](https://github.com/bradygaster/squad)** — the multi-agent coordination layer. Squad source is vendored at `squad/` and loaded at runtime. © 2026 Brady Gaster and contributors. MIT License.

- **[rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)** — questionnaire schema and UX pattern used by the built-in `ask_user_question` tool. © 2026 juicesharp. Install `@juicesharp/rpiv-ask-user-question` for the full tabbed TUI with previews and localization. MIT License.
