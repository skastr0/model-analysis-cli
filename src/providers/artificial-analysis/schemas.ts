import { Schema } from "effect"

import { LlmModelSchema, MediaModelSchema } from "../../core/platform"

const PositiveIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.positive())

export const PaginationMetaSchema = Schema.Struct({
  page: Schema.Number.pipe(Schema.int(), Schema.between(1, 10_000)),
  page_size: PositiveIntegerSchema,
  total_pages: PositiveIntegerSchema,
  has_more: Schema.Boolean,
})

const ReportedTierSchema = Schema.Union(
  Schema.Literal("free"),
  Schema.Literal("pro"),
  Schema.Literal("commercial"),
)

const PaidTierSchema = Schema.Union(Schema.Literal("pro"), Schema.Literal("commercial"))

export const LlmModelsFreeResponseSchema = Schema.Struct({
  tier: ReportedTierSchema,
  intelligence_index_version: Schema.Number,
  pagination: PaginationMetaSchema,
  data: Schema.Array(LlmModelSchema),
})

export const LlmModelsPaidResponseSchema = Schema.Struct({
  tier: PaidTierSchema,
  intelligence_index_version: Schema.Number,
  pagination: PaginationMetaSchema,
  data: Schema.Array(LlmModelSchema),
})

export const LlmModelItemResponseSchema = Schema.Struct({
  tier: PaidTierSchema,
  intelligence_index_version: Schema.Number,
  data: LlmModelSchema,
})

export const MediaModelsFreeResponseSchema = Schema.Struct({
  tier: ReportedTierSchema,
  data: Schema.Array(MediaModelSchema),
})

export const MediaModelsPaidResponseSchema = Schema.Struct({
  tier: PaidTierSchema,
  data: Schema.Array(MediaModelSchema),
})

export const ArtificialAnalysisLlmModelSchema = LlmModelSchema
export const ArtificialAnalysisLlmModelsSchema = Schema.Array(ArtificialAnalysisLlmModelSchema)
export const ArtificialAnalysisLlmModelsResponseSchema = Schema.Union(
  LlmModelsFreeResponseSchema,
  LlmModelsPaidResponseSchema,
)

export const ArtificialAnalysisMediaModelSchema = MediaModelSchema
export const ArtificialAnalysisMediaModelsSchema = Schema.Array(ArtificialAnalysisMediaModelSchema)
export const ArtificialAnalysisMediaModelsResponseSchema = Schema.Union(
  MediaModelsFreeResponseSchema,
  MediaModelsPaidResponseSchema,
)
