# Release Checklist

This project is experimental and solo-maintained. The first public release target is npm runner package `@skastr0/model-analysis-cli` with command `model-analysis`, backed by per-platform binary packages.

## Authority

Local work may inspect, edit, build, test, package, and run dry-runs.

These actions require explicit maintainer approval before they happen:

- making the GitHub repository public
- configuring npm trusted publishing or registry access
- pushing a release tag
- dispatching or approving a publish workflow
- publishing npm packages
- creating or publishing a GitHub Release

## Publishable Packages

Publish these packages in order:

1. `@skastr0/model-analysis-cli-darwin-arm64`
2. `@skastr0/model-analysis-cli-darwin-x64`
3. `@skastr0/model-analysis-cli-linux-arm64`
4. `@skastr0/model-analysis-cli-linux-x64`
5. `@skastr0/model-analysis-cli`

Keep the root package `@skastr0/model-analysis-cli-workspace` private. It is repository tooling, not an npm release artifact.

## npm Trusted Publisher Setup

Configure npm trusted publishing for:

- packages: every package listed above
- repository: `skastr0/model-analysis-cli`
- workflow filename: `npm-publish.yml`
- environment: `release`
- allowed action: `npm publish`

The GitHub repository must be public before npm can generate provenance for the public package through trusted publishing.

After setup, verify the trusted publisher from npmjs.com or with:

```bash
npm trust list @skastr0/model-analysis-cli
```

The npm CLI may require interactive 2FA or browser authentication for this verification step.

## Local Verification

Run these before approving a release tag or workflow dispatch:

```bash
bun install
bun run verify
bun run smoke:npm-cli
bun run pack:dry-run
bun run publish:dry-run
```

Inspect the dry-run tarball contents. Platform packages should contain only the generated binary, license, and package manifest. The launcher package should contain only `bin/model-analysis.js`, README, license, and package manifest.

## First Publish

1. Confirm root `package.json`, all `packages/npm/*/package.json`, `CHANGELOG.md`, and `bun ./dist/cli.js --version` are aligned for the intended version.
2. Confirm each publishable package version is not already published.
3. Configure npm trusted publishing for `.github/workflows/npm-publish.yml`.
4. Create and push the approved tag, such as `v0.1.0`.
5. Approve the protected GitHub Actions `release` environment.
6. Let CI run `npm publish --access public` for each package in order.

Local real publishing is a bootstrap exception for the exact package/version batch listed above. After bootstrap, use CI trusted publishing.

## Post-Publish Verification

After CI publishes:

```bash
npm view @skastr0/model-analysis-cli@0.1.0 version --prefer-online
npm view @skastr0/model-analysis-cli@0.1.0 dist --json --prefer-online
npx -y --package @skastr0/model-analysis-cli@0.1.0 model-analysis --version
bunx -p @skastr0/model-analysis-cli@0.1.0 model-analysis --version
pnpm --package @skastr0/model-analysis-cli@0.1.0 dlx model-analysis --version
```

If a bad version is published, publish a fixed version and deprecate the bad version. Do not assume npm unpublish is available as rollback.
