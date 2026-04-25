import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import { loadJsonInput } from "../core/json"
import { MediaTypeSchema, type MediaModel, ModelProvider } from "../core/platform"
import { executeJsonCommand } from "../core/output"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const mediaListInputSchema = Schema.Struct({
  type: MediaTypeSchema,
  include_categories: Schema.optional(Schema.Boolean),
})

const stripCategories = (models: ReadonlyArray<MediaModel>): ReadonlyArray<MediaModel> =>
  models.map(({ categories: _categories, ...model }) => model)

const mediaListCommand = Command.make("list", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "media list",
    Effect.gen(function* () {
      const request = yield* loadJsonInput(mediaListInputSchema, input)
      const provider = yield* ModelProvider
      const models = yield* provider.listMediaModels(request.type)

      return request.include_categories === true ? models : stripCategories(models)
    }),
  ),
).pipe(Command.withDescription("List media models for a given media type"))

export const mediaCommand = Command.make("media").pipe(
  Command.withDescription("Media model commands"),
  Command.withSubcommands([mediaListCommand]),
)
