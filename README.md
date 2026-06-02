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
