import { expect } from "bun:test"
import { Effect } from "effect"
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

export interface CliResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface RunCliOptions {
  readonly stdinText?: string
}

// Resolve project root relative to this test helper
const PROJECT_ROOT = resolve(dirname(import.meta.filename), "../..")

export const runCli = (
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
  options?: RunCliOptions,
): Effect.Effect<CliResult, never, never> =>
  Effect.promise(
    () =>
      new Promise((complete, reject) => {
        const processEnv = Object.fromEntries(
          Object.entries({
            ...process.env,
            MODEL_ANALYSIS_CACHE_DIR:
              env.MODEL_ANALYSIS_CACHE_DIR ?? mkdtempSync(join(tmpdir(), "model-analysis-test-")),
            ...env,
          }).filter((entry): entry is [string, string] => entry[1] !== undefined),
        )

        const subprocess = spawn("bun", ["run", "./src/cli.ts", ...args], {
          cwd: PROJECT_ROOT,
          env: processEnv,
          stdio: ["pipe", "pipe", "pipe"],
        })

        let stdout = ""
        let stderr = ""

        subprocess.stdout.on("data", (data) => {
          stdout += data
        })

        subprocess.stderr.on("data", (data) => {
          stderr += data
        })

        subprocess.on("close", (code) => {
          complete({
            stdout,
            stderr,
            exitCode: code ?? -1,
          })
        })

        subprocess.on("error", (error) => {
          reject(error)
        })

        if (options?.stdinText !== undefined) {
          subprocess.stdin.write(options.stdinText)
          subprocess.stdin.end()
        }
      }),
  )

export const expectJson = <T>(text: string): T => {
  expect(text.trim().length).toBeGreaterThan(0)
  return JSON.parse(text) as T
}
