# Changelog

All notable changes to this project will be documented in this file.

This project follows Semantic Versioning for its declared public package and CLI surface.

## [Unreleased]

### Changed
- Hardened the Artificial Analysis V2 integration against the live OpenAPI contract, including pagination consistency, current modality types, and paid detail-only fields.
- Preserved Intelligence Index version and Free/full response shape metadata in catalog caches and snapshots; V2 catalog caches intentionally use new internal schema IDs and replace incompatible 0.1.0 cache files on the next fetch.
- Separated paid model-detail caching from catalog freshness and invalidated details across catalog generations or tier changes.
- Added explicit Free-to-paid upgrade detection, all 11 media route checks, and `include_genres` projections.
- Made `auth status --check` a non-caching, one-page readiness probe and distinguished invalid credentials from provider unavailability.
- Prevented stale-on-error results from being rewritten as fresh snapshots.
- Updated provider, tier, rate-limit, attribution, cache-isolation, and endpoint-coverage documentation.

## [0.1.0] - 2026-06-03

### Added
- Initial experimental release surface for the `model-analysis` CLI.
- npm package metadata, release workflow, and first-publish validation checklist.
- Node launcher and per-platform npm packages for `npx`, `bunx`, and `pnpm dlx` execution without requiring Bun on the user's PATH.
