import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { loadAppConfig } from "../core/config"
import { executeJsonCommand } from "../core/output"
import { ModelProvider } from "../core/platform"

const liveCheckOption = Options.boolean("check", { ifPresent: true }).pipe(
  Options.withDescription("Perform a live provider check. This may consume one full LLM catalog request."),
)

const getAuthStatus = (check: boolean) => Effect.gen(function* () {
  const config = yield* loadAppConfig()

  if (!config.apiKey) {
    return {
      configured: false,
      authenticated: false,
      checked: false,
      api_base_url: config.apiBaseUrl,
      status: null,
      error: "API key is not configured",
    }
  }

  if (!check) {
    return {
      configured: true,
      authenticated: null,
      checked: false,
      api_base_url: config.apiBaseUrl,
      status: null,
      note: "API key is configured. Pass --check to perform a live provider request.",
    }
  }

  const provider = yield* ModelProvider

  return yield* provider.listModels({ refresh: true, allowStaleOnError: false, forceTierCheck: true }).pipe(
    Effect.flatMap(() => provider.getModelCacheStatus()),
    Effect.map((cacheStatus) => ({
      configured: true,
      authenticated: true,
      checked: true,
      api_base_url: config.apiBaseUrl,
      status: 200,
      tier: cacheStatus.tier ?? null,
    })),
    Effect.catchTag("ApiResponseError", (error) =>
      Effect.succeed({
        configured: true,
        authenticated: false,
        checked: true,
        api_base_url: config.apiBaseUrl,
        status: error.status,
        error: error.message,
      }),
    ),
    Effect.catchTag("ApiRequestError", (error) =>
      Effect.succeed({
        configured: true,
        authenticated: false,
        checked: true,
        api_base_url: config.apiBaseUrl,
        status: null,
        error: error.message,
      }),
    ),
    Effect.catchTag("ApiDecodeError", (error) =>
      Effect.succeed({
        configured: true,
        authenticated: false,
        checked: true,
        api_base_url: config.apiBaseUrl,
        status: null,
        error: error.message,
      }),
    ),
  )
})

const authStatusCommand = Command.make("status", { check: liveCheckOption }, ({ check }) =>
  executeJsonCommand(
    "auth status",
    getAuthStatus(check),
  ),
).pipe(
  Command.withDescription("Check authentication configuration, optionally with a live provider request"),
)

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Authentication commands"),
  Command.withSubcommands([authStatusCommand]),
)
