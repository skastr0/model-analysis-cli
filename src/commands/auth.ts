import { Command, Options } from "@effect/cli"
import { Effect } from "effect"

import { loadAppConfig } from "../core/config"
import { executeJsonCommand } from "../core/output"
import { ModelProvider } from "../core/platform"

const liveCheckOption = Options.boolean("check", { ifPresent: true }).pipe(
  Options.withDescription("Perform a one-page live provider check; Free keys may use one paid probe plus one /free request."),
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

  return yield* provider.checkAccess().pipe(
    Effect.map((access) => ({
      configured: true,
      authenticated: true,
      available: true,
      checked: true,
      api_base_url: config.apiBaseUrl,
      status: 200,
      tier: access.tier,
      data_shape: access.data_shape,
    })),
    Effect.catchTag("ApiResponseError", (error) =>
      Effect.succeed({
        configured: true,
        authenticated: error.status === 401 ? false : error.status === 403 ? true : null,
        available: false,
        checked: true,
        api_base_url: config.apiBaseUrl,
        status: error.status,
        error: error.message,
      }),
    ),
    Effect.catchTag("ApiRequestError", (error) =>
      Effect.succeed({
        configured: true,
        authenticated: null,
        available: false,
        checked: true,
        api_base_url: config.apiBaseUrl,
        status: null,
        error: error.message,
      }),
    ),
    Effect.catchTag("ApiDecodeError", (error) =>
      Effect.succeed({
        configured: true,
        authenticated: null,
        available: false,
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
