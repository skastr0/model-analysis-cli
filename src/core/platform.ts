import { Context, Effect, Schema } from "effect"

import type {
  ApiDecodeError,
  ApiRequestError,
  ApiResponseError,
  CacheReadError,
  CacheRemoveError,
  CacheWriteError,
  ConfigurationError,
  MissingApiKeyError,
  ModelNotFoundError,
} from "./errors"

export const MediaTypeSchema = Schema.Literal(
  "text-to-image",
  "image-editing",
  "text-to-speech",
  "text-to-video",
  "image-to-video",
)

export type MediaType = typeof MediaTypeSchema.Type

export const ModelCreatorSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.optional(Schema.String),
})

const NullableNumberSchema = Schema.NullOr(Schema.Number)

export const LlmEvaluationsSchema = Schema.Struct({
  artificial_analysis_intelligence_index: Schema.optional(NullableNumberSchema),
  artificial_analysis_coding_index: Schema.optional(NullableNumberSchema),
  artificial_analysis_math_index: Schema.optional(NullableNumberSchema),
  mmlu_pro: Schema.optional(NullableNumberSchema),
  gpqa: Schema.optional(NullableNumberSchema),
  hle: Schema.optional(NullableNumberSchema),
  livecodebench: Schema.optional(NullableNumberSchema),
  scicode: Schema.optional(NullableNumberSchema),
  math_500: Schema.optional(NullableNumberSchema),
  aime: Schema.optional(NullableNumberSchema),
  aime_25: Schema.optional(NullableNumberSchema),
  ifbench: Schema.optional(NullableNumberSchema),
  lcr: Schema.optional(NullableNumberSchema),
  terminalbench_hard: Schema.optional(NullableNumberSchema),
  tau2: Schema.optional(NullableNumberSchema),
})

export const LlmPricingSchema = Schema.Struct({
  price_1m_blended_3_to_1: Schema.optional(NullableNumberSchema),
  price_1m_input_tokens: Schema.optional(NullableNumberSchema),
  price_1m_output_tokens: Schema.optional(NullableNumberSchema),
})

export const LlmModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  release_date: Schema.optional(Schema.NullOr(Schema.String)),
  model_creator: ModelCreatorSchema,
  evaluations: LlmEvaluationsSchema,
  pricing: LlmPricingSchema,
  median_output_tokens_per_second: Schema.optional(NullableNumberSchema),
  median_time_to_first_token_seconds: Schema.optional(NullableNumberSchema),
  median_time_to_first_answer_token: Schema.optional(NullableNumberSchema),
})

export type LlmModel = typeof LlmModelSchema.Type

export interface ModelCacheOptions {
  readonly refresh?: boolean
  readonly maxAgeSeconds?: number
  readonly allowStaleOnError?: boolean
}

export interface ModelCacheStatus {
  readonly enabled: true
  readonly path: string
  readonly snapshot_directory: string
  readonly snapshot_count: number | null
  readonly exists: boolean
  readonly valid: boolean
  readonly fresh: boolean
  readonly stale: boolean
  readonly cached_at: string | null
  readonly age_seconds: number | null
  readonly ttl_seconds: number
  readonly model_count: number | null
  readonly error: string | null
}

export const MediaCategorySchema = Schema.Struct({
  style_category: Schema.optional(Schema.String),
  subject_matter_category: Schema.optional(Schema.String),
  format_category: Schema.optional(Schema.String),
  elo: Schema.Number,
  ci95: Schema.String,
  appearances: Schema.Number,
})

export const MediaModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  model_creator: ModelCreatorSchema,
  elo: Schema.Number,
  rank: Schema.Number,
  ci95: Schema.String,
  appearances: Schema.Number,
  release_date: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(MediaCategorySchema)),
})

export type MediaModel = typeof MediaModelSchema.Type

export type ProviderError =
  | ConfigurationError
  | MissingApiKeyError
  | ApiRequestError
  | ApiResponseError
  | ApiDecodeError
  | CacheReadError
  | CacheWriteError
  | CacheRemoveError
  | ModelNotFoundError

export interface ModelProviderService {
  readonly name: string
  readonly listModels: (options?: ModelCacheOptions) => Effect.Effect<ReadonlyArray<LlmModel>, ProviderError>
  readonly getModel: (id: string, options?: ModelCacheOptions) => Effect.Effect<LlmModel, ProviderError>
  readonly getModelCacheStatus: (options?: Pick<ModelCacheOptions, "maxAgeSeconds">) => Effect.Effect<ModelCacheStatus, ProviderError>
  readonly clearModelCache: () => Effect.Effect<ModelCacheStatus, ProviderError>
  readonly listMediaModels: (type: MediaType) => Effect.Effect<ReadonlyArray<MediaModel>, ProviderError>
}

export class ModelProvider extends Context.Tag("model-analysis/ModelProvider")<
  ModelProvider,
  ModelProviderService
>() {}

export const listModels = (options?: ModelCacheOptions) =>
  Effect.flatMap(ModelProvider, (provider) => provider.listModels(options))

export const getModel = (identifier: string, options?: ModelCacheOptions) =>
  Effect.flatMap(ModelProvider, (provider) => provider.getModel(identifier, options))

export const getModelCacheStatus = (options?: Pick<ModelCacheOptions, "maxAgeSeconds">) =>
  Effect.flatMap(ModelProvider, (provider) => provider.getModelCacheStatus(options))

export const clearModelCache = Effect.flatMap(ModelProvider, (provider) => provider.clearModelCache())

export const listMediaModels = (type: MediaType) =>
  Effect.flatMap(ModelProvider, (provider) => provider.listMediaModels(type))
