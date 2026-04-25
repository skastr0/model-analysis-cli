import { Args, Command, Options } from "@effect/cli"
import { Effect, Option, Schema } from "effect"

import { loadJsonInput } from "../core/json"
import { MediaTypeSchema, type MediaModel, type ModelCacheOptions, ModelProvider } from "../core/platform"
import { executeJsonCommand } from "../core/output"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const refreshOption = Options.boolean("refresh", { ifPresent: true }).pipe(
  Options.withDescription("Bypass the local media catalog cache and fetch a fresh provider snapshot."),
)

const cacheTtlSecondsOption = Options.integer("cache-ttl-seconds").pipe(
  Options.optional,
  Options.withDescription("Freshness window used when reporting whether cached media catalog data is stale."),
)

const staleIfErrorOption = Options.boolean("stale-if-error", { ifPresent: true }).pipe(
  Options.withDescription("Return stale cached media catalog data when the provider request fails."),
)

const mediaListInputSchema = Schema.Struct({
  type: MediaTypeSchema,
  include_categories: Schema.optional(Schema.Boolean),
})

const mediaCacheInputSchema = Schema.Struct({
  type: MediaTypeSchema,
})

const stripCategories = (models: ReadonlyArray<MediaModel>): ReadonlyArray<MediaModel> =>
  models.map(({ categories: _categories, ...model }) => model)

const cacheOptions = (options: {
  readonly refresh?: boolean
  readonly cacheTtlSeconds?: Option.Option<number>
  readonly staleIfError?: boolean
}): ModelCacheOptions => ({
  ...(options.refresh !== undefined ? { refresh: options.refresh } : {}),
  ...(options.cacheTtlSeconds !== undefined && Option.isSome(options.cacheTtlSeconds)
    ? { maxAgeSeconds: options.cacheTtlSeconds.value }
    : {}),
  ...(options.staleIfError !== undefined ? { allowStaleOnError: options.staleIfError } : {}),
})

const mediaListCommand = Command.make(
  "list",
  {
    input: jsonInputArg,
    refresh: refreshOption,
    cacheTtlSeconds: cacheTtlSecondsOption,
    staleIfError: staleIfErrorOption,
  },
  ({ input, refresh, cacheTtlSeconds, staleIfError }) =>
    executeJsonCommand(
      "media list",
      Effect.gen(function* () {
        const request = yield* loadJsonInput(mediaListInputSchema, input)
        const provider = yield* ModelProvider
        const models = yield* provider.listMediaModels(
          request.type,
          cacheOptions({ refresh, cacheTtlSeconds, staleIfError }),
        )

        return request.include_categories === true ? models : stripCategories(models)
      }),
    ),
).pipe(Command.withDescription("List media models for a given media type"))

const mediaCacheStatusCommand = Command.make(
  "status",
  { input: jsonInputArg, cacheTtlSeconds: cacheTtlSecondsOption },
  ({ input, cacheTtlSeconds }) =>
    executeJsonCommand(
      "media cache status",
      Effect.gen(function* () {
        const request = yield* loadJsonInput(mediaCacheInputSchema, input)
        const provider = yield* ModelProvider

        return yield* provider.getMediaModelCacheStatus(
          request.type,
          Option.isSome(cacheTtlSeconds) ? { maxAgeSeconds: cacheTtlSeconds.value } : undefined,
        )
      }),
    ),
).pipe(Command.withDescription("Inspect the local media catalog cache for one media type"))

const mediaCacheClearCommand = Command.make("clear", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "media cache clear",
    Effect.gen(function* () {
      const request = yield* loadJsonInput(mediaCacheInputSchema, input)
      const provider = yield* ModelProvider

      return yield* provider.clearMediaModelCache(request.type)
    }),
  ),
).pipe(Command.withDescription("Clear the latest local media catalog cache for one media type"))

const mediaCacheCommand = Command.make("cache").pipe(
  Command.withDescription("Media model cache commands"),
  Command.withSubcommands([mediaCacheStatusCommand, mediaCacheClearCommand]),
)

export const mediaCommand = Command.make("media").pipe(
  Command.withDescription("Media model commands"),
  Command.withSubcommands([mediaListCommand, mediaCacheCommand]),
)
