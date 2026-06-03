# Changelog

All notable changes to `@pi-squad/coordinator` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.1] — 2026-06-03

### Security
- **Pre-push OSS boundary guard hook** — New `.githooks/pre-push` hook prevents accidental commits of restricted terms to the public repo. Contributors configure their own `~/.githooks/.boundary-terms` file for custom policy. See `.githooks/.boundary-terms.example` for setup. (closes #1)

### Added
- **Comprehensive test suite** — `tests/` directory now wired into vitest with 69 tests across 16 files (expanded from 23 tests in v0.1.0). Full coverage of sanitizer, routing, recovery, and scribe systems.

### Fixed
- **Squad template path resolution** — Correctly resolves Squad `.squad/` paths in both community (flat) and sovereign (monorepo) layouts, ensuring template discovery works across deployment variants
- **Regex backtracking in sanitizer** — Fixed unbounded regex in `RE_BASE64_KEY` that could cause performance issues on large payloads
- **npm package repository URL format** — Corrected package.json URL to valid npm format for proper package registry resolution

### Changed
- **Build configuration** — `tsconfig.json` now inlined in community repo (was referencing sovereign monorepo path)
- **CI improvements** — Added npm stage publish workflow (OIDC trusted publishing with beta tag); `package-lock.json` included for deterministic `npm ci` builds

---

## [0.1.0] — 2026-06-03

### Added
- **Coordinator runtime** — `before_agent_start` hook injects Squad coordinator system prompt into every Pi agent session
- **`/squad` command** — manual coordinator invocation for ad-hoc routing
- **`/squad-init` command** — guided first-run wizard that scaffolds `.squad/` interactively, with detection of git user, Pi extensions, and project signals
- **Built-in `ask_user_question` tool** — questionnaire TUI used by `/squad-init` when the full `@juicesharp/rpiv-ask-user-question` package is not installed
- **Composite prompt** — merges root and local team context, routing rules, and session decisions into a coherent coordinator prompt
- **Context recovery** — checkpoint-based recovery with `latest.json` for crash resilience
- **Work monitor (Ralph)** — built-in backlog keep-alive that surfaces stale work items
- **Scribe drop-box** — drop-box pattern for async session logging and decisions inbox
- **Prompt injection sanitization** — `.squad/` content is sanitized at prompt assembly time; `"prompt"` source type strips role-boundary markers
- **GuardChecker hardening** — coordinator routing directives validated against strict schema constraints; lifecycle logs redact raw user-controlled content
- **ESM-only, strict TypeScript** — no CommonJS, no `any`, Node.js ≥20
- **MIT license** with full attribution for Pi, Squad, and rpiv-ask-user-question
- Error boundary with 10-second timeout protects Pi agent sessions from coordinator failures
- `AGENTS.md` — AI/contributor orientation doc for cold-start agents
- npm publish readiness: package.json fields (files, engines, keywords, repository, license)

### Technical
- Squad vendored at `squad/` (v0.9.4) — upstream sync via `npm run sync-squad`
- Version compatibility checked at startup with semver bounds (`minVersion: "0.9.0"`, `maxVersion: "0.10.x"`)
- Context backends: SQLite-vec (default) and pgvector (optional)

### Changed
- Removed unused `auth/adapter.ts` — Pi handles auth natively via `/login`

---

*See [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for full design specification.*
