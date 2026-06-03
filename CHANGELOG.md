# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - 2026-06-03

### Added
- `before_agent_start` hook injects Squad coordinator system prompt into every Pi agent session
- Squad v0.9.4 vendored and version-stamped at runtime from `squad/VERSION`
- Error boundary with 10-second timeout protects Pi agent sessions from coordinator failures
- `/squad` command for manual coordinator invocation
- Context pressure monitoring and recovery
- `AGENTS.md` — AI/contributor orientation doc for cold-start agents
- npm publish readiness: package.json fields (files, engines, keywords, repository, license)

### Changed
- Removed unused `auth/adapter.ts` — Pi handles auth natively via `/login`

[0.1.0]: https://github.com/KieraKujisawa/pi-squad/releases/tag/v0.1.0
