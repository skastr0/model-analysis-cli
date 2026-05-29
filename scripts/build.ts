#!/usr/bin/env bun

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const version = packageJson.version;
const distDir = "dist";
const binaryName = "model-analysis";
const cliEntry = "src/cli.ts";
const cliBundle = join(distDir, "cli.js");
const buildDefines = {
  APP_VERSION: `'${version}'`,
};

const targets = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
];

console.log("Cleaning dist directory...");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

let failed = false;

console.log(`\nBuilding ${binaryName} v${version} package CLI...\n`);

const cliBuild = await Bun.build({
  target: "bun",
  entrypoints: [cliEntry],
  outdir: distDir,
  format: "esm",
  define: buildDefines,
  minify: true,
});

if (!cliBuild.success) {
  failed = true;
  console.error("  ✗ Failed to build package CLI");
  for (const log of cliBuild.logs) {
    console.error(log);
  }
} else {
  const bundle = readFileSync(cliBundle, "utf8");
  if (!bundle.startsWith("#!")) {
    writeFileSync(cliBundle, `#!/usr/bin/env bun\n${bundle}`);
  }
  chmodSync(cliBundle, 0o755);
  console.log(`  ✓ ${cliBundle}`);
}

console.log(`\nBuilding ${binaryName} v${version} standalone binaries...\n`);

for (const { platform, arch } of targets) {
  const outfile = join(distDir, `${binaryName}-${platform}-${arch}`);

  console.log(`Building ${platform}-${arch}...`);

  try {
    const buildResult = await Bun.build({
      target: "bun",
      compile: {
        target: `bun-${platform}-${arch}`,
        outfile,
      },
      entrypoints: [cliEntry],
      define: buildDefines,
      minify: true,
    });

    if (!buildResult.success) {
      failed = true;
      console.error(`  ✗ Failed to build ${platform}-${arch}`);
      for (const log of buildResult.logs) {
        console.error(log);
      }
      continue;
    }

    chmodSync(outfile, 0o755);

    // Sign binary on macOS
    if (platform === "darwin" && process.platform === "darwin") {
      await Bun.$`codesign --remove-signature ${outfile}`.nothrow().quiet();
      await Bun.$`codesign --sign - --force ${outfile}`.quiet();
    }

    console.log(`  ✓ ${outfile}`);
  } catch (error) {
    failed = true;
    console.error(`  ✗ Error building ${platform}-${arch}:`, error);
  }
}

if (failed) {
  console.error("\nBuild failed.");
  process.exit(1);
}

console.log(`
Build complete! Binaries in ${distDir}/

To install locally:
  bun run install:local
`);
