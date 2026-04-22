import { Args, Command, Options } from "@effect/cli"
import { Effect, Option, Schema } from "effect"

import { CommandInputError, JsonInputError } from "../core/errors"
import { loadBatchJsonInput, loadJsonInput } from "../core/json"
import { executeJsonCommand, setExitCode, toErrorDetails } from "../core/output"
import { IdentifierSchema } from "../core/api"

const DEFAULT_BATCH_CONCURRENCY = 5

const toUndefined = <A>(value: Option.Option<A>) => (Option.isSome(value) ? value.value : undefined)

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const concurrencyOption = Options.integer("concurrency").pipe(
  Options.optional,
  Options.withDescription(
    `Maximum concurrent mutations to run in parallel (default: ${DEFAULT_BATCH_CONCURRENCY})`,
  ),
)

// Example schemas — replace with your domain schemas
export const ItemCreateRequestSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
})

export type ItemCreateRequest = typeof ItemCreateRequestSchema.Type

export const ItemSchema = Schema.Struct({
  id: IdentifierSchema,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.Array(Schema.String),
  created_at: Schema.String,
})

export type Item = typeof ItemSchema.Type

// Reuse the same schema for input validation
const createItemInputSchema = ItemCreateRequestSchema
type CreateItemInput = typeof createItemInputSchema.Type

type BatchResultItem =
  | {
      readonly index: number
      readonly ok: true
      readonly data: unknown
    }
  | {
      readonly index: number
      readonly ok: false
      readonly error: ReturnType<typeof toErrorDetails>
    }

interface BatchMutationResult {
  readonly total: number
  readonly success_count: number
  readonly error_count: number
  readonly concurrency: number
  readonly results: ReadonlyArray<BatchResultItem>
}

const validateCreateInput = (input: CreateItemInput) =>
  Effect.gen(function* () {
    if (input.name.trim().length === 0) {
      yield* Effect.fail(
        new CommandInputError({
          field: "name",
          message: "name must not be empty",
        }),
      )
    }
  })

const decodeBatchItem = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  value: unknown,
  index: number,
) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(
      (error) =>
        new JsonInputError({
          source: `item[${index}]`,
          reason: "InvalidShape",
          message: error.message,
        }),
    ),
  )

const summarizeBatchResults = (
  concurrency: number,
  results: ReadonlyArray<BatchResultItem>,
): BatchMutationResult => {
  const error_count = results.filter((result) => !result.ok).length

  return {
    total: results.length,
    success_count: results.length - error_count,
    error_count,
    concurrency,
    results,
  }
}

export const runMutationBatch = <A, I, R, S>(options: {
  readonly input: string
  readonly concurrency: number
  readonly itemSchema: Schema.Schema<A, I, R>
  readonly validate: (item: A) => Effect.Effect<void, CommandInputError>
  readonly run: (item: A) => Effect.Effect<S, unknown, R>
  readonly toSuccess: (item: A, result: S, index: number) => BatchResultItem
}) =>
  Effect.gen(function* () {
    if (options.concurrency <= 0) {
      yield* Effect.fail(
        new CommandInputError({
          field: "concurrency",
          message: `concurrency must be a positive integer`,
        }),
      )
    }

    const rawItems = yield* loadBatchJsonInput(options.input)
    const results = yield* Effect.forEach(
      rawItems,
      (rawItem, index) =>
        Effect.gen(function* () {
          const item = yield* decodeBatchItem(options.itemSchema, rawItem, index)
          yield* options.validate(item)

          const result = yield* options.run(item)
          return options.toSuccess(item, result, index)
        }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed({
              index,
              ok: false as const,
              error: toErrorDetails(error),
            }),
          ),
        ),
      { concurrency: options.concurrency },
    )

    const summary = summarizeBatchResults(options.concurrency, results)

    if (summary.error_count > 0) {
      yield* setExitCode(1)
    }

    return summary
  })

// TODO: Replace with actual API call
const createItem = (params: { readonly body: ItemCreateRequest }) =>
  Effect.succeed({
    id: "item_123",
    name: params.body.name,
    description: params.body.description ?? null,
    tags: params.body.tags ?? [],
    created_at: new Date().toISOString(),
  } satisfies Item)

const itemsCreateCommand = Command.make(
  "create",
  {
    input: jsonInputArg,
    concurrency: concurrencyOption,
  },
  ({ input, concurrency }) =>
    executeJsonCommand(
      "items create",
      runMutationBatch({
        input,
        concurrency: toUndefined(concurrency) ?? DEFAULT_BATCH_CONCURRENCY,
        itemSchema: createItemInputSchema,
        validate: validateCreateInput,
        run: (item) => createItem({ body: item }),
        toSuccess: (_item, item, index) => ({
          index,
          ok: true,
          data: item,
        }),
      }),
    ),
).pipe(
  Command.withDescription(
    "Create one or more items from a JSON object or array. Supports parallel batch execution.",
  ),
)

export const itemsCommand = Command.make("items").pipe(
  Command.withDescription("Item workflow commands"),
  Command.withSubcommands([itemsCreateCommand]),
)
