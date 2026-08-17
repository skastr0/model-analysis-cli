# @skastr0/model-analysis-cli

A JSON-first CLI for interacting with AI model analysis platforms, starting with the Artificial Analysis API.

## Status

- Maturity: experimental
- Repository visibility: public
- Package channel: npm packages under the `@skastr0` scope
- Binary command: `model-analysis`
- Maintainer model: solo-maintained

Version `0.1.0` is public on npm. Future publishing, tag pushes, and GitHub release creation require explicit maintainer approval.

## Install Surface

The release package exposes `model-analysis` through a Node launcher package backed by prebuilt Bun standalone binary packages.

Install globally:

```bash
npm install -g @skastr0/model-analysis-cli
model-analysis auth status
```

Ephemeral npm runners use the same launcher package:

```bash
npx -y --package @skastr0/model-analysis-cli model-analysis --version
bunx -p @skastr0/model-analysis-cli model-analysis --version
pnpm dlx --package @skastr0/model-analysis-cli model-analysis --version
```

Supported npm runner platforms are macOS arm64, macOS x64, Linux arm64, and Linux x64. Windows is not supported by this release package yet.

For source builds:

```bash
bun install
bun run build
bun run install:local
model-analysis auth status
```

`bun run build` emits the Bun bundle at `dist/cli.js` and standalone binaries at `dist/model-analysis-<platform>-<arch>`. `bun run build:npm-cli` copies those standalone binaries into platform packages under `packages/npm/` and prepares the Node launcher package.

## What it does

- Lists, resolves, and compares LLM models with benchmark, pricing, and performance data
- Lists all 11 Artificial Analysis V2 media families across image, video, speech, and music
- Uses credential-isolated persistent caching and timestamped snapshots to survive strict provider rate limits
- Preserves agent-first ergonomics: JSON input, structured JSON output, typed errors, and Effect-based composition
- Uses a provider abstraction so new backends can be added without rewriting commands

## Artificial Analysis V2 status

The default base URL is `https://artificialanalysis.ai/api/v2`. The integration follows the current [Data API documentation](https://artificialanalysis.ai/data-api/docs) and generated [OpenAPI 3.1 contract](https://artificialanalysis.ai/api/v2/openapi); it does not use the deprecated `/api/v2/data/*` routes scheduled to retire on 2026-11-04 ([migration guide](https://artificialanalysis.ai/data-api/migrate-v2-data)).

The CLI currently integrates 25 of the 31 documented paths:

- Free and paid LLM list routes plus paid model detail
- Free and paid siblings for all 11 media families
- V2 pagination, nested performance/pricing fields, detail-only intelligence breakdowns, and Commercial provider data returned by model detail

The six specialized endpoints not yet exposed as CLI commands are model performance history, the four Commercial provider/history/measurement routes, and `POST /critpt/evaluate`. CritPt is a separately approved code-evaluation service rather than a catalog endpoint.

Tier routing is optimistic: with an unknown tier the CLI calls the standard Pro+ route first, then retries the corresponding `/free` route only after HTTP `403`. The successful response-body tier and the actual data shape (`free` or `full`) are cached separately. A known Free cache starts at `/free`; if that response reports an upgraded Pro or Commercial tier, the same refresh immediately refetches the standard route so paid access is not mislabeled as Free-shaped data. `401`, `429`, transport errors, and decode failures never trigger a Free fallback.

All routes, including `/free`, require `x-api-key`. Current limits are 100 requests per fixed 24-hour window for Free and 500 for Pro; Commercial is custom. Paid LLM catalog and detail requests explicitly use the documented `prompt_type=long` preset. The current Intelligence Index methodology is v4.1.1, while API field `intelligence_index_version` intentionally reports major.minor only (`4.1`).

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

Checks whether `ARTIFICIAL_ANALYSIS_API_KEY` is configured without making a network request.

Pass `--check` to decode only page 1 of the V2 LLM catalog without reading or writing the cache. Pro and Commercial keys use one standard-route request. A Free key normally uses one failed standard-route probe followed by one `/language/models/free?page=1` request. The result distinguishes invalid credentials (`authenticated: false`) from rate limits, outages, and schema failures (`authenticated: null`, `available: false`).

### `models list [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Returns the complete paginated LLM catalog available to the key: the reduced public shape for Free, or the full model-list shape for Pro and Commercial.

By default, this command reads from the local LLM catalog cache whenever a valid snapshot exists, even if that snapshot is older than the freshness TTL. If no valid cache exists, it fetches every V2 page, verifies that tier, page metadata, and Intelligence Index version stay consistent, writes the latest cache file, and preserves a timestamped snapshot. Pass `--refresh` to force a provider refresh.

### `models get <json> [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Accepts JSON input with exactly one selector:

```json
{ "id": "model_id" }
```

or

```json
{ "slug": "o3-mini" }
```

This command resolves identity from the catalog cache. Free returns the reduced list item. Pro and Commercial fetch the V2 model-detail route once and keep it in a separate, catalog-generation- and tier-bound detail cache; later gets reuse that detail without changing catalog freshness or snapshot history. Detail authentication and decode failures are surfaced unless `--stale-if-error` explicitly permits a compatible cached detail or catalog item. `--refresh` refreshes both the catalog generation and the requested detail.

### `models compare <json> [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Accepts one batch selector list:

```json
{ "model_ids": ["model-a", "model-b"] }
```

or

```json
{ "model_slugs": ["o3-mini", "gpt-4o"] }
```

This command resolves all models from one cached tier-appropriate catalog whenever possible. It no longer needs to call the provider for every compare operation.

### `models cache status`

Returns the local LLM catalog cache path, snapshot directory, snapshot count, freshness, age, TTL, validity, model count, subscription tier, data shape, fixed prompt preset, and `intelligence_index_version`.

### `models cache clear`

Removes the latest local LLM catalog cache for the active API base URL and credential partition. Timestamped snapshots are kept as historical intelligence.

## Cache Model

The provider cache is intentionally persistent and file based. The latest usable snapshot is stored under `~/.config/model-analysis/cache` by default. Every cache key includes the API base URL and a one-way credential partition so data from a paid key cannot leak to another key. Media keys also include the media type and rich-breakdown request shape. Successful catalog refreshes write timestamped snapshots under `snapshots/`; LLM snapshots preserve tier, data shape, prompt preset, and Intelligence Index version. The V2 integration intentionally bumps the internal LLM and media catalog schema IDs, so incompatible 0.1.0 latest-cache files are refetched rather than misdecoded. Paid model details use separate per-model caches and snapshots bound to the catalog generation and tier.

The TTL reports freshness; normal commands may still reuse a structurally valid stale cache for rate-limit safety. `--refresh` is the explicit network boundary. Stale fallback is opt-in with `--stale-if-error`; returned stale data is not rewritten with a new timestamp or recorded as a new provider snapshot.

Project-local `.taste-codec/` data is local agent/cache state and is not part of the public package or repository release surface.

### `media list <json> [--refresh] [--cache-ttl-seconds <seconds>] [--stale-if-error]`

Accepts category or genre projections where the selected media family supports them:

```json
{ "type": "text-to-image", "include_categories": true }
```

```json
{ "type": "music-instrumental", "include_genres": true }
```

Supported `type` values:

- `text-to-image`
- `image-editing`
- `text-to-speech`
- `speech-to-speech`
- `speech-to-text`
- `text-to-video`
- `image-to-video`
- `text-to-video-audio`
- `image-to-video-audio`
- `music-instrumental`
- `music-vocals`

Category projections are valid for the two image families and four video families. Genre projections are valid for the two music families. Unsupported projection/type combinations return `CommandInputError` instead of being silently ignored. For paid keys the integration fetches and caches the rich category or genre payload; omitting the projection strips that breakdown from CLI output without another provider request. Free endpoints do not provide category or genre breakdowns.

### `media cache status <json>`

Returns the local media catalog cache path, snapshot directory, snapshot count, freshness, age, TTL, validity, model count, subscription tier, and data shape for one media type.

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

`auth status` works without an API key and reports the missing configuration as structured data. Data-fetching commands require an API key because cache partitions are credential-isolated.

## Output Contract

All commands write JSON envelopes only:

```json
{ "ok": true, "command": "models list", "data": [...] }
```

or

```json
{ "ok": false, "command": "models list", "error": { "type": "ApiResponseError", "message": "..." } }
```

When the provider supplies them, API error details preserve `retry_after_seconds` and the Artificial Analysis rate-limit limit, remaining quota, reset timestamp, and serving tier.

## Attribution and upstream terms

Artificial Analysis requires attribution on every API tier when its data is displayed or shared. Credit [Artificial Analysis](https://artificialanalysis.ai/) with a visible byline or footer link. API use is also subject to the upstream [Terms of Use](https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf); redistribution or bespoke rights require a separate agreement.

## License

MIT

For security reports, see SECURITY.md in the repository. Please do not open public issues for suspected vulnerabilities.

## Release Plan

1. Publish only scoped packages under `@skastr0`; the unscoped package names are not release targets.
2. Publish platform packages before `@skastr0/model-analysis-cli`, because the launcher package declares exact-version optional dependencies.
3. Keep the executable name `model-analysis` through `bin.model-analysis`.
4. Use CI as the release gate: `bun run verify`, `bun run pack:dry-run`, and the protected `release` environment must pass on the release commit.
5. npm trusted publishing is configured for every package through `.github/workflows/npm-publish.yml`; future releases should publish from approved `v*` tags.
