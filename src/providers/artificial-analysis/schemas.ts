import { Schema } from "effect"

import { LlmModelSchema, MediaModelSchema } from "../../core/platform"

const ResponseEnvelopeSchema = <A, I, R>(data: Schema.Schema<A, I, R>) =>
  Schema.Struct({
    status: Schema.Number,
    prompt_options: Schema.optional(Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    })),
    data,
  })

export const ArtificialAnalysisLlmModelSchema = LlmModelSchema
export const ArtificialAnalysisLlmModelsSchema = Schema.Array(ArtificialAnalysisLlmModelSchema)
export const ArtificialAnalysisLlmModelsResponseSchema = Schema.Union(
  ArtificialAnalysisLlmModelsSchema,
  ResponseEnvelopeSchema(ArtificialAnalysisLlmModelsSchema),
)

export const ArtificialAnalysisMediaModelSchema = MediaModelSchema
export const ArtificialAnalysisMediaModelsSchema = Schema.Array(ArtificialAnalysisMediaModelSchema)
export const ArtificialAnalysisMediaModelsResponseSchema = Schema.Union(
  ArtificialAnalysisMediaModelsSchema,
  ResponseEnvelopeSchema(ArtificialAnalysisMediaModelsSchema),
)
