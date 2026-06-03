# Release Checklist

This project is experimental and solo-maintained. The first public release target is npm package `@skastr0/model-analysis-cli` with command `model-analysis`.

## Authority

Local work may inspect, edit, build, test, package, and run dry-runs.

These actions require explicit maintainer approval before they happen:

- making the GitHub repository public
- configuring npm trusted publishing or registry access
- pushing a release tag
- dispatching or approving a publish workflow
- publishing the npm package
- creating or publishing a GitHub Release

## npm Trusted Publisher Setup

Configure npm trusted publishing for:

- package: `@skastr0/model-analysis-cli`
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
bun run pack:dry-run
bun run publish:dry-run
```

Inspect the dry-run tarball contents. The npm package should contain only the generated CLI, README, changelog, license, and package manifest.

## First Publish

1. Confirm `package.json`, `CHANGELOG.md`, and `bun ./dist/cli.js --version` are aligned for the intended version.
2. Confirm `npm view @skastr0/model-analysis-cli version --prefer-online` reports the package is not already published.
3. Make the repository public after the public-surface audit is accepted.
4. Configure npm trusted publishing for `.github/workflows/npm-publish.yml`.
5. Create and push the approved tag, such as `v0.1.0`.
6. Approve the protected GitHub Actions `release` environment.
7. Let CI run `npm publish --access public`.

Do not run a local real publish unless the maintainer explicitly approves that exact package and version as a bootstrap exception.

## Post-Publish Verification

After CI publishes:

```bash
npm view @skastr0/model-analysis-cli@0.1.0 version --prefer-online
npm view @skastr0/model-analysis-cli@0.1.0 dist --json --prefer-online
npx -y --package @skastr0/model-analysis-cli@0.1.0 model-analysis --version
bunx -p @skastr0/model-analysis-cli@0.1.0 model-analysis --version
pnpm dlx @skastr0/model-analysis-cli@0.1.0 model-analysis --version
```

If a bad version is published, publish a fixed version and deprecate the bad version. Do not assume npm unpublish is available as rollback.
