import { Args, Command, Options } from "@effect/cli"
import { Effect, Option, Schema } from "effect"

import { CommandInputError, ModelsNotFoundError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { type LlmModel, type ModelCacheOptions, ModelProvider } from "../core/platform"
import { executeJsonCommand } from "../core/output"

const DEFAULT_COMPARE_CONCURRENCY = 5

const toUndefined = <A>(value: Option.Option<A>) =>
  Option.isSome(value) ? value.value : undefined

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const compareConcurrencyOption = Options.integer("concurrency").pipe(
  Options.optional,
  Options.withDescription(
    `Maximum concurrent model resolutions to run in parallel (default: ${DEFAULT_COMPARE_CONCURRENCY})`,
  ),
)

const refreshOption = Options.boolean("refresh", { ifPresent: true }).pipe(
  Options.withDescription("Bypass the local LLM catalog cache and fetch a fresh provider snapshot."),
)

const cacheTtlSecondsOption = Options.integer("cache-ttl-seconds").pipe(
  Options.optional,
  Options.withDescription("Freshness window used when reporting whether cached LLM catalog data is stale."),
)

const staleIfErrorOption = Options.boolean("stale-if-error", { ifPresent: true }).pipe(
  Options.withDescription("Return stale cached LLM catalog data when the provider request fails."),
)

const getModelInputSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
})

type GetModelInput = typeof getModelInputSchema.Type

const compareModelsInputSchema = Schema.Struct({
  model_ids: Schema.optional(Schema.Array(Schema.String)),
  model_slugs: Schema.optional(Schema.Array(Schema.String)),
})

type CompareModelsInput = typeof compareModelsInputSchema.Type

const validateGetModelInput = (input: GetModelInput) =>
  Effect.gen(function* () {
    const selectors = [input.id, input.slug].filter((value) => value !== undefined)

    if (selectors.length !== 1) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "input",
          message: "provide exactly one of id or slug",
        }),
      )
    }

    const identifier = selectors[0]?.trim() ?? ""

    if (identifier.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: input.id !== undefined ? "id" : "slug",
          message: "model identifier must not be empty",
        }),
      )
    }
  })

const requestedIdentifiers = (input: CompareModelsInput) => input.model_ids ?? input.model_slugs ?? []

const validateCompareModelsInput = (input: CompareModelsInput) =>
  Effect.gen(function* () {
    const selectorGroups = [input.model_ids, input.model_slugs].filter(
      (value) => value !== undefined,
    )

    if (selectorGroups.length !== 1) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "input",
          message: "provide exactly one of model_ids or model_slugs",
        }),
      )
    }

    const identifiers = requestedIdentifiers(input)

    if (identifiers.length === 0) {
      return yield* Effect.fail(
        new CommandInputError({
          field: input.model_ids !== undefined ? "model_ids" : "model_slugs",
          message: "at least one model identifier is required",
        }),
      )
    }

    const firstEmpty = identifiers.find((identifier) => identifier.trim().length === 0)

    if (firstEmpty !== undefined) {
      return yield* Effect.fail(
        new CommandInputError({
          field: input.model_ids !== undefined ? "model_ids" : "model_slugs",
          message: "model identifiers must not be empty",
        }),
      )
    }
  })

const validateConcurrency = (concurrency: number) =>
  concurrency > 0
    ? Effect.succeed(undefined)
    : Effect.fail(
        new CommandInputError({
          field: "concurrency",
          message: "concurrency must be a positive integer",
        }),
      )

const indexModels = (models: ReadonlyArray<LlmModel>) => {
  const index = new Map<string, LlmModel>()

  for (const model of models) {
    index.set(model.id, model)
    index.set(model.slug, model)
  }

  return index
}

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

const modelsListCommand = Command.make(
  "list",
  {
    refresh: refreshOption,
    cacheTtlSeconds: cacheTtlSecondsOption,
    staleIfError: staleIfErrorOption,
  },
  ({ refresh, cacheTtlSeconds, staleIfError }) =>
    executeJsonCommand(
      "models list",
      Effect.flatMap(ModelProvider, (provider) =>
        provider.listModels(cacheOptions({ refresh, cacheTtlSeconds, staleIfError })),
      ),
    ),
).pipe(Command.withDescription("List all LLM models from the active provider"))

const modelsGetCommand = Command.make(
  "get",
  {
    input: jsonInputArg,
    refresh: refreshOption,
    cacheTtlSeconds: cacheTtlSecondsOption,
    staleIfError: staleIfErrorOption,
  },
  ({ input, refresh, cacheTtlSeconds, staleIfError }) =>
  executeJsonCommand(
    "models get",
    Effect.gen(function* () {
      const request = yield* loadJsonInput(getModelInputSchema, input)
      yield* validateGetModelInput(request)

      const provider = yield* ModelProvider
      return yield* provider.getModel(
        (request.id ?? request.slug ?? "").trim(),
        cacheOptions({ refresh, cacheTtlSeconds, staleIfError }),
      )
    }),
  ),
).pipe(Command.withDescription("Get a single LLM model by id or slug"))

const modelsCompareCommand = Command.make(
  "compare",
  {
    input: jsonInputArg,
    concurrency: compareConcurrencyOption,
    refresh: refreshOption,
    cacheTtlSeconds: cacheTtlSecondsOption,
    staleIfError: staleIfErrorOption,
  },
  ({ input, concurrency, refresh, cacheTtlSeconds, staleIfError }) =>
    executeJsonCommand(
      "models compare",
      Effect.gen(function* () {
        const request = yield* loadJsonInput(compareModelsInputSchema, input)
        const compareConcurrency = toUndefined(concurrency) ?? DEFAULT_COMPARE_CONCURRENCY

        yield* validateCompareModelsInput(request)
        yield* validateConcurrency(compareConcurrency)

        const provider = yield* ModelProvider
        const models = yield* provider.listModels(
          cacheOptions({ refresh, cacheTtlSeconds, staleIfError }),
        )
        const modelIndex = indexModels(models)
        const identifiers = requestedIdentifiers(request).map((identifier) => identifier.trim())

        const resolved = yield* Effect.forEach(
          identifiers,
          (identifier) =>
            Effect.sync(() => ({
              identifier,
              model: modelIndex.get(identifier),
            })),
          { concurrency: compareConcurrency },
        )

        const missingIdentifiers = resolved
          .filter((entry) => entry.model === undefined)
          .map((entry) => entry.identifier)

        if (missingIdentifiers.length > 0) {
          return yield* Effect.fail(
            new ModelsNotFoundError({
              identifiers: missingIdentifiers,
              message:
                missingIdentifiers.length === 1
                  ? `Model '${missingIdentifiers[0]}' was not found`
                  : `Models not found: ${missingIdentifiers.join(", ")}`,
            }),
          )
        }

        return resolved.flatMap((entry) => (entry.model ? [entry.model] : []))
      }),
    ),
).pipe(
  Command.withDescription(
    "Compare multiple LLM models side by side from a JSON object containing model_ids or model_slugs",
  ),
)

const modelsCacheStatusCommand = Command.make(
  "status",
  { cacheTtlSeconds: cacheTtlSecondsOption },
  ({ cacheTtlSeconds }) =>
    executeJsonCommand(
      "models cache status",
      Effect.flatMap(ModelProvider, (provider) =>
        provider.getModelCacheStatus(
          Option.isSome(cacheTtlSeconds) ? { maxAgeSeconds: cacheTtlSeconds.value } : undefined,
        ),
      ),
    ),
).pipe(Command.withDescription("Inspect the local LLM catalog cache"))

const modelsCacheClearCommand = Command.make("clear", {}, () =>
  executeJsonCommand(
    "models cache clear",
    Effect.flatMap(ModelProvider, (provider) => provider.clearModelCache()),
  ),
).pipe(Command.withDescription("Clear the latest local LLM catalog cache"))

const modelsCacheCommand = Command.make("cache").pipe(
  Command.withDescription("LLM model cache commands"),
  Command.withSubcommands([modelsCacheStatusCommand, modelsCacheClearCommand]),
)

export const modelsCommand = Command.make("models").pipe(
  Command.withDescription("LLM model commands"),
  Command.withSubcommands([
    modelsListCommand,
    modelsGetCommand,
    modelsCompareCommand,
    modelsCacheCommand,
  ]),
)
