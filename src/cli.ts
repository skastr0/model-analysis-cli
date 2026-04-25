#!/usr/bin/env bun

import * as Cause from "effect/Cause"
import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

import { authCommand } from "./commands/auth"
import { mediaCommand } from "./commands/media"
import { modelsCommand } from "./commands/models"
import { CLI_NAME, CLI_VERSION } from "./core/constants"
import { writeCauseEnvelope, writeFailureEnvelope, setExitCode } from "./core/output"
import { AppLayer } from "./providers/artificial-analysis"

export const rootCommand = Command.make(CLI_NAME).pipe(
  Command.withDescription("JSON-first CLI for AI model analysis providers"),
  Command.withSubcommands([
    authCommand,
    modelsCommand,
    mediaCommand,
  ]),
)

const cli = Command.run(rootCommand, {
  name: CLI_NAME,
  version: CLI_VERSION,
})

const runtimeLayer = Layer.mergeAll(
  BunContext.layer,
  AppLayer.pipe(Layer.provide(BunContext.layer)),
)

export const runCli = (args: ReadonlyArray<string>) =>
  Effect.suspend(() => cli(args)).pipe(
    Effect.catchAll((error) =>
      setExitCode(1).pipe(Effect.zipRight(writeFailureEnvelope(undefined, error))),
    ),
    Effect.catchAllCause((cause) =>
      setExitCode(1).pipe(Effect.zipRight(writeCauseEnvelope(undefined, cause))),
    ),
    Effect.provide(runtimeLayer),
  )

runCli(Bun.argv).pipe(BunRuntime.runMain)
