import { Schema } from "effect"

import { LlmModelSchema, MediaModelSchema } from "../../core/platform"

export const PaginationMetaSchema = Schema.Struct({
  page: Schema.Number,
  page_size: Schema.Number,
  total_pages: Schema.Number,
  has_more: Schema.Boolean,
})

export const LlmModelsListResponseSchema = Schema.Struct({
  tier: Schema.Union(Schema.Literal("free"), Schema.Literal("pro"), Schema.Literal("commercial")),
  intelligence_index_version: Schema.optional(Schema.Number),
  pagination: PaginationMetaSchema,
  data: Schema.Array(LlmModelSchema),
})

export const LlmModelItemResponseSchema = Schema.Struct({
  tier: Schema.Union(Schema.Literal("free"), Schema.Literal("pro"), Schema.Literal("commercial")),
  intelligence_index_version: Schema.optional(Schema.Number),
  data: LlmModelSchema,
})

export const MediaModelsListResponseSchema = Schema.Struct({
  tier: Schema.Union(Schema.Literal("free"), Schema.Literal("pro"), Schema.Literal("commercial")),
  data: Schema.Array(MediaModelSchema),
})

export const ArtificialAnalysisLlmModelSchema = LlmModelSchema
export const ArtificialAnalysisLlmModelsSchema = Schema.Array(ArtificialAnalysisLlmModelSchema)
export const ArtificialAnalysisLlmModelsResponseSchema = LlmModelsListResponseSchema

export const ArtificialAnalysisMediaModelSchema = MediaModelSchema
export const ArtificialAnalysisMediaModelsSchema = Schema.Array(ArtificialAnalysisMediaModelSchema)
export const ArtificialAnalysisMediaModelsResponseSchema = MediaModelsListResponseSchema
