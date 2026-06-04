# @skastr0/model-analysis-cli

A JSON-first CLI for interacting with AI model analysis platforms, starting with the Artificial Analysis API.

## Status

- Maturity: experimental
- Repository visibility: public
- Package channel: npm packages under the `@skastr0` scope
- Binary command: `model-analysis`
- Maintainer model: solo-maintained

The first public package release is prepared for npm but not published yet. Real publishing, tag pushes, and GitHub release creation require explicit maintainer approval.

## Install Surface

The release package exposes `model-analysis` through a Node launcher package backed by prebuilt Bun standalone binary packages.

After the first npm publish:

```bash
npm install -g @skastr0/model-analysis-cli
model-analysis auth status
```

Ephemeral npm runners use the same launcher package:

```bash
npx -y --package @skastr0/model-analysis-cli model-analysis --version
bunx -p @skastr0/model-analysis-cli model-analysis --version
pnpm --package @skastr0/model-analysis-cli dlx model-analysis --version
```

Supported npm runner platforms are macOS arm64, macOS x64, Linux arm64, and Linux x64. Windows is not supported by this release package yet.

For source builds before the first publish:

```bash
bun install
bun run build
bun run install:local
model-analysis auth status
```

`bun run build` emits the Bun bundle at `dist/cli.js` and standalone binaries at `dist/model-analysis-<platform>-<arch>`. `bun run build:npm-cli` copies those standalone binaries into platform packages under `packages/npm/` and prepares the Node launcher package.

## What it does

- Lists and compares LLM models with benchmark, pricing, and latency data
- Lists media models across text-to-image, image-editing, text-to-speech, text-to-video, and image-to-video categories
- Uses aggressive persistent caching for every integrated Artificial Analysis data endpoint to survive strict provider rate limits
- Preserves agent-first ergonomics: JSON input, structured JSON output, typed errors, and Effect-based composition
- Uses a provider abstraction so new backends can be added without rewriting commands

## Getting Started

```bash
# Install dependencies
bun install

# Check auth and connectivity
bun run dev auth status
bun run dev auth status --check

# List LLM models
bun run dev models list

# Get one model
bun run dev models get '{"slug":"o3-mini"}'

# Compare multiple models
bun run dev models compare '{"model_slugs":["o3-mini","gpt-4o"]}'

# Inspect or clear the local LLM catalog cache
bun run dev models cache status
bun run dev models cache clear

# List media models
bun run dev media list '{"type":"text-to-image","include_categories":true}'

# Inspect or clear one local media catalog cache
bun run dev media cache status '{"type":"text-to-image"}'
bun run dev media cache clear '{"type":"text-to-image"}'

# Validate the codebase
bun run typecheck
bun run test
bun run verify
bun run pack:dry-run
```

## Provider Architecture

Provider-agnostic contracts live in `src/core/platform.ts`.

Provider-specific code lives under `src/providers/<provider>/`:

```text
src/
  cli.ts
  core/
    api.ts
    config.ts
    constants.ts
    errors.ts
    json.ts
    output.ts
    platform.ts
  providers/
    artificial-analysis/
      cache.ts
      client.ts
      index.ts
      schemas.ts
  commands/
    auth.ts
    models.ts
    media.ts
```

This split keeps commands provider-agnostic while isolating transport, auth, and response decoding per platform.

## Commands

### `auth status [--check]`

Checks whether `ARTIFICIAL_ANALYSIS_API_KEY` is configured without spending an API catalog request.

Pass `--check` to perform a live provider request. Artificial Analysis exposes the free LLM data through a full-catalog endpoint, so live checks may consume one `/data/llms/models` request.

### `models list [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Returns the full Artificial Analysis LLM model dataset.

By default, this command reads from the local LLM catalog cache whenever a valid snapshot exists, even if that snapshot is older than the freshness TTL. If no valid cache exists, it fetches the full provider catalog, writes the latest cache file, and preserves a timestamped snapshot. Pass `--refresh` to force a new provider request.

### `models get <json> [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Accepts JSON input with exactly one selector:

```json
{ "id": "model_id" }
```

or

```json
{ "slug": "o3-mini" }
```

This command resolves the model from the cached full catalog whenever possible, avoiding extra provider calls. Pass `--refresh` only when you explicitly want a new provider snapshot.

### `models compare <json> [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Accepts one batch selector list:

```json
{ "model_ids": ["model-a", "model-b"] }
```

or

```json
{ "model_slugs": ["o3-mini", "gpt-4o"] }
```

This command resolves all models from one cached full catalog whenever possible. It no longer needs to call the provider for every compare operation.

### `models cache status`

Returns the local LLM catalog cache path, snapshot directory, snapshot count, freshness, age, TTL, validity, and model count.

### `models cache clear`

Removes the latest local LLM catalog cache for the active API base URL. Timestamped snapshots are kept as historical intelligence.

## Cache Model

The provider catalog cache is intentionally persistent and file based. The latest usable provider snapshot is stored under `~/.config/model-analysis/cache` by default. LLM data is keyed by API base URL; media data is keyed by API base URL, media type, and provider category request shape. Every successful provider refresh also writes a timestamped snapshot under `snapshots/`, so downstream ranking, modelspace topology, and historical comparison work can be recalculated without re-querying the API.

The TTL controls freshness reporting, not whether valid cached data may be used. Normal commands prefer valid cached intelligence for speed and rate-limit safety; `--refresh` is the explicit network boundary. If a refresh hits a provider failure and stale data exists, commands can return stale cached data unless stale fallback is explicitly disabled.

Project-local `.taste-codec/` data is local agent/cache state and is not part of the public package or repository release surface.

### `media list <json> [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Accepts:

```json
{ "type": "text-to-image", "include_categories": true }
```

Supported `type` values:

- `text-to-image`
- `image-editing`
- `text-to-speech`
- `text-to-video`
- `image-to-video`

For category-capable media endpoints (`text-to-image`, `text-to-video`, and `image-to-video`), the provider integration fetches and caches the category-rich payload so a later `include_categories: true` projection does not require another provider call. Omit `include_categories` or set it to `false` to strip category data from the CLI output only.

### `media cache status <json>`

Returns the local media catalog cache path, snapshot directory, snapshot count, freshness, age, TTL, validity, and model count for one media type.

```json
{ "type": "text-to-image" }
```

### `media cache clear <json>`

Removes the latest local media catalog cache for one media type. Timestamped snapshots are kept as historical intelligence.

```json
{ "type": "text-to-image" }
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ARTIFICIAL_ANALYSIS_API_KEY` | Yes* | — | Artificial Analysis API key |
| `ARTIFICIAL_ANALYSIS_BASE_URL` | No | `https://artificialanalysis.ai/api/v2` | Artificial Analysis API base URL |
| `MODEL_ANALYSIS_CACHE_DIR` | No | `~/.config/model-analysis/cache` | Directory for cached provider catalog snapshots |
| `MODEL_ANALYSIS_CACHE_TTL_SECONDS` | No | `604800` | Freshness window used to report whether cached provider catalog data is stale |

`auth status` works without an API key and reports the missing configuration as structured data. Data-fetching commands require the API key only when no valid compatible cache is available or when `--refresh` is requested.

## Output Contract

All commands write JSON envelopes only:

```json
{ "ok": true, "command": "models list", "data": [...] }
```

or

```json
{ "ok": false, "command": "models list", "error": { "type": "ApiResponseError", "message": "..." } }
```

## License

MIT

For security reports, see SECURITY.md in the repository. Please do not open public issues for suspected vulnerabilities.

## Release Plan

1. Publish only scoped packages under `@skastr0`; the unscoped package names are not release targets.
2. Publish platform packages before `@skastr0/model-analysis-cli`, because the launcher package declares exact-version optional dependencies.
3. Keep the executable name `model-analysis` through `bin.model-analysis`.
4. Use CI as the release gate: `bun run verify`, `bun run pack:dry-run`, and the protected `release` environment must pass on the release commit.
5. After maintainer approval, configure npm trusted publishing for every package, create the release tag, and let CI run the real npm publish.
