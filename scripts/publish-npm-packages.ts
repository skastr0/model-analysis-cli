#!/usr/bin/env bun

import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

const REPO_ROOT = resolve(import.meta.dir, "..")
const dryRun = process.argv.includes("--dry-run")

const packageDirs = [
  "packages/npm/model-analysis-cli-darwin-arm64",
  "packages/npm/model-analysis-cli-darwin-x64",
  "packages/npm/model-analysis-cli-linux-arm64",
  "packages/npm/model-analysis-cli-linux-x64",
  "packages/npm/model-analysis-cli",
] as const

const run = async (
  label: string,
  command: ReadonlyArray<string>,
  options: { readonly allowFailure?: boolean } = {},
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> => {
  console.log(`\n${label}`)
  const proc = Bun.spawn(command, {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (stdout.length > 0) {
    process.stdout.write(stdout)
  }
  if (stderr.length > 0) {
    process.stderr.write(stderr)
  }
  if (exitCode !== 0 && options.allowFailure !== true) {
    console.error(`${label} failed with exit code ${exitCode}`)
    process.exit(exitCode)
  }
  return { exitCode, stdout, stderr }
}

const readPackage = async (
  packageDir: string,
): Promise<{ readonly name: string; readonly version: string }> => {
  const packageJsonPath = join(REPO_ROOT, packageDir, "package.json")
  const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    readonly name?: unknown
    readonly version?: unknown
  }

  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error(`${packageJsonPath} must define string name and version`)
  }

  return { name: parsed.name, version: parsed.version }
}

for (const packageDir of packageDirs) {
  const { name, version } = await readPackage(packageDir)

  if (!dryRun) {
    const published = await run(
      `Checking ${name}@${version}`,
      ["npm", "view", `${name}@${version}`, "version", "--prefer-online"],
      { allowFailure: true },
    )
    if (published.exitCode === 0) {
      console.log(`Skipping ${name}@${version}; already published`)
      continue
    }
  }

  const command = ["npm", "publish", `./${packageDir}`, "--access", "public"]
  if (dryRun) {
    command.push("--dry-run")
  }

  const published = await run(
    `${dryRun ? "Dry-run publishing" : "Publishing"} ${name}@${version}`,
    command,
    { allowFailure: true },
  )

  if (published.exitCode === 0) {
    continue
  }

  const output = `${published.stdout}\n${published.stderr}`
  if (
    output.includes("previously published versions") ||
    output.includes("cannot publish over existing version")
  ) {
    console.log(`Skipping ${name}@${version}; registry reports it is already published`)
    continue
  }

  process.exit(published.exitCode)
}
