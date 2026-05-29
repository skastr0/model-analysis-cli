# model-analysis-cli Agent Guide

## Project Intent

`model-analysis-cli` is a JSON-first CLI for collecting and comparing AI model intelligence, starting with the Artificial Analysis API. Agents are primary users: commands should accept structured JSON input, return deterministic JSON envelopes, and keep provider-specific transport details behind provider modules.

## Stack

- Runtime: Bun.
- CLI framework: `@effect/cli`.
- Effects and services: `effect`, `@effect/platform`, `@effect/platform-bun`.
- Tests: Bun test.
- Build: `bun scripts/build.ts`, which emits `dist/cli.js` for npm and standalone `dist/model-analysis-<platform>-<arch>` binaries.

## Command Contract

- Complex inputs are JSON objects, accepted inline, from stdin, or from `@file` paths where the command supports JSON input.
- Flags are execution controls only, such as `--refresh`, `--cache-ttl-seconds`, and `--stale-if-error`.
- Success writes one JSON envelope to stdout.
- Failure writes one JSON envelope to stderr and exits non-zero.
- `auth status` is the credential-free readiness command; `auth status --check` is the live provider boundary.

## Development

Use Bun for dependency, test, and build operations:

```sh
bun install
bun run typecheck
bun run test
bun run build
bun run verify
```

Before release-surface changes, also inspect the npm package through the package script:

```sh
bun run pack:dry-run
```

## Code Guidelines

- Keep provider-agnostic contracts in `src/core/platform.ts`.
- Keep Artificial Analysis auth, HTTP wiring, response schemas, and caching in `src/providers/artificial-analysis/`.
- Keep JSON loading, output envelopes, config, errors, and transport helpers in `src/core/`.
- Register user-facing commands under `src/commands/` and wire them from `src/cli.ts`.
- Prefer typed Effect errors over thrown `Error` values for recoverable failures.
- Do not write unstructured text to stdout from commands.
- Keep generated local caches out of source control, including `.taste-codec/`.

## Release Boundaries

- The npm package name is `@skastr0/model-analysis-cli`.
- The executable name is `model-analysis`.
- Publishing, tag pushes, GitHub Release creation, and repository visibility changes require explicit maintainer approval.
