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
  "speech-to-speech",
  "speech-to-text",
  "text-to-video",
  "image-to-video",
  "text-to-video-audio",
  "image-to-video-audio",
  "music-instrumental",
  "music-vocals",
)

export type MediaType = typeof MediaTypeSchema.Type

export const ModelCreatorSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.optional(Schema.String),
  country: Schema.optional(Schema.NullOr(Schema.String)),
})

const NullableNumberSchema = Schema.NullOr(Schema.Number)

export const LlmEvaluationsSchema = Schema.Struct({
  artificial_analysis_intelligence_index: Schema.optional(NullableNumberSchema),
  artificial_analysis_coding_index: Schema.optional(NullableNumberSchema),
  artificial_analysis_agentic_index: Schema.optional(NullableNumberSchema),
  tau2_telecom: Schema.optional(NullableNumberSchema),
  tau_banking: Schema.optional(NullableNumberSchema),
  terminalbench_hard: Schema.optional(NullableNumberSchema),
  terminalbench_v2_1: Schema.optional(NullableNumberSchema),
  scicode: Schema.optional(NullableNumberSchema),
  aa_lcr: Schema.optional(NullableNumberSchema),
  aa_omniscience_index: Schema.optional(NullableNumberSchema),
  aa_omniscience_accuracy: Schema.optional(NullableNumberSchema),
  aa_omniscience_non_hallucination_rate: Schema.optional(NullableNumberSchema),
  ifbench: Schema.optional(NullableNumberSchema),
  hle: Schema.optional(NullableNumberSchema),
  gpqa_diamond: Schema.optional(NullableNumberSchema),
  critpt: Schema.optional(NullableNumberSchema),
  gdpval_aa_elo: Schema.optional(NullableNumberSchema),
  gdpval_aa_normalized: Schema.optional(NullableNumberSchema),
  mmmu_pro: Schema.optional(NullableNumberSchema),
  artificial_analysis_openness_index: Schema.optional(NullableNumberSchema),
  artificial_analysis_multilingual_index: Schema.optional(NullableNumberSchema),
})

export const LlmPricingSchema = Schema.Struct({
  price_1m_blended_3_to_1: Schema.optional(NullableNumberSchema),
  price_1m_blended_7_to_2_to_1: Schema.optional(NullableNumberSchema),
  price_1m_input_tokens: Schema.optional(NullableNumberSchema),
  price_1m_output_tokens: Schema.optional(NullableNumberSchema),
  price_1m_cache_hit_tokens: Schema.optional(NullableNumberSchema),
  price_1m_cache_write_tokens: Schema.optional(NullableNumberSchema),
})

export const LlmPerformanceSchema = Schema.Struct({
  percentile_05_output_tokens_per_second: Schema.optional(NullableNumberSchema),
  quartile_25_output_tokens_per_second: Schema.optional(NullableNumberSchema),
  median_output_tokens_per_second: Schema.optional(NullableNumberSchema),
  quartile_75_output_tokens_per_second: Schema.optional(NullableNumberSchema),
  percentile_95_output_tokens_per_second: Schema.optional(NullableNumberSchema),
  percentile_05_time_to_first_token_seconds: Schema.optional(NullableNumberSchema),
  quartile_25_time_to_first_token_seconds: Schema.optional(NullableNumberSchema),
  median_time_to_first_token_seconds: Schema.optional(NullableNumberSchema),
  quartile_75_time_to_first_token_seconds: Schema.optional(NullableNumberSchema),
  percentile_95_time_to_first_token_seconds: Schema.optional(NullableNumberSchema),
  median_time_to_first_answer_token_seconds: Schema.optional(NullableNumberSchema),
  median_end_to_end_response_time_seconds: Schema.optional(NullableNumberSchema),
})

export const ParametersSchema = Schema.Struct({
  total: Schema.Number,
  active: Schema.NullOr(Schema.Number),
})

export const ModalitySetSchema = Schema.Struct({
  text: Schema.NullOr(Schema.Boolean),
  image: Schema.NullOr(Schema.Boolean),
  video: Schema.NullOr(Schema.Boolean),
  speech: Schema.NullOr(Schema.Boolean),
})

export const ModalitiesSchema = Schema.Struct({
  input: ModalitySetSchema,
  output: ModalitySetSchema,
})

export const LicensingSchema = Schema.Struct({
  is_open_weights: Schema.Boolean,
})

export const IntelligenceIndexTokenCountsSchema = Schema.Struct({
  input_tokens: Schema.Number,
  answer_tokens: Schema.Number,
  output_tokens: Schema.Number,
  reasoning_tokens: Schema.Number,
})

export const IntelligenceIndexCostPerTaskSchema = Schema.Struct({
  total_cost: Schema.Number,
  input_cost: Schema.optional(NullableNumberSchema),
  reasoning_cost: Schema.optional(NullableNumberSchema),
  answer_cost: Schema.optional(NullableNumberSchema),
})

export const IntelligenceIndexCostSchema = Schema.Struct({
  total_cost: Schema.Number,
  cost_per_task: Schema.NullOr(IntelligenceIndexCostPerTaskSchema),
  input_cost: Schema.optional(NullableNumberSchema),
  reasoning_cost: Schema.optional(NullableNumberSchema),
  answer_cost: Schema.optional(NullableNumberSchema),
})

export const LlmModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  release_date: Schema.optional(Schema.NullOr(Schema.String)),
  model_creator: Schema.NullOr(ModelCreatorSchema),
  reasoning_model: Schema.optional(Schema.Boolean),
  evaluations: LlmEvaluationsSchema,
  pricing: LlmPricingSchema,
  performance: Schema.optional(LlmPerformanceSchema),
  context_window_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
  huggingface_url: Schema.optional(Schema.NullOr(Schema.String)),
  openrouter_api_id: Schema.optional(Schema.NullOr(Schema.String)),
  artificial_analysis_intelligence_index_cost: Schema.optional(Schema.NullOr(IntelligenceIndexCostSchema)),
  artificial_analysis_intelligence_index_token_counts: Schema.optional(Schema.NullOr(IntelligenceIndexTokenCountsSchema)),
  parameters: Schema.optional(Schema.NullOr(ParametersSchema)),
  modalities: Schema.optional(ModalitiesSchema),
  licensing: Schema.optional(LicensingSchema),
})

export type LlmModel = typeof LlmModelSchema.Type

export interface ModelCacheOptions {
  readonly refresh?: boolean
  readonly maxAgeSeconds?: number
  readonly allowStaleOnError?: boolean
  readonly forceTierCheck?: boolean
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
  readonly tier?: "free" | "pro" | "commercial" | null
}

export const MediaCategorySchema = Schema.Struct({
  label: Schema.optional(Schema.String),
  style_category: Schema.optional(Schema.String),
  subject_matter_category: Schema.optional(Schema.String),
  format_category: Schema.optional(Schema.String),
  elo: Schema.Number,
  ci_95: Schema.optional(Schema.NullOr(Schema.Number)),
  samples: Schema.optional(Schema.Number),
  appearances: Schema.optional(Schema.Number),
})

export const MediaGenreSchema = Schema.Struct({
  label: Schema.String,
  elo: Schema.Number,
  ci_95: Schema.optional(Schema.NullOr(Schema.Number)),
  samples: Schema.optional(Schema.Number),
})

export const MediaProviderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  // Speech-to-Speech
  price_per_hour_input: Schema.optional(NullableNumberSchema),
  price_per_hour_output: Schema.optional(NullableNumberSchema),
  time_to_first_audio_seconds: Schema.optional(NullableNumberSchema),
  // Speech-to-Text
  price_per_1k_minutes: Schema.optional(NullableNumberSchema),
  median_speed_factor: Schema.optional(NullableNumberSchema),
  aa_wer_index: Schema.optional(NullableNumberSchema),
  aa_agenttalk: Schema.optional(NullableNumberSchema),
  voxpopuli_cleaned_aa: Schema.optional(NullableNumberSchema),
  earnings_22_cleaned_aa: Schema.optional(NullableNumberSchema),
})

export const MediaModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.optional(Schema.String),
  model_creator: Schema.NullOr(ModelCreatorSchema),
  elo: Schema.optional(NullableNumberSchema),
  rank: Schema.optional(Schema.NullOr(Schema.Number)),
  ci_95: Schema.optional(Schema.NullOr(Schema.Number)),
  samples: Schema.optional(Schema.Number),
  appearances: Schema.optional(Schema.Number),
  release_date: Schema.optional(Schema.NullOr(Schema.String)),
  price_per_1k_images: Schema.optional(Schema.NullOr(Schema.Number)),
  price_per_1k_videos: Schema.optional(Schema.NullOr(Schema.Number)),
  price_per_1k_minutes: Schema.optional(Schema.NullOr(Schema.Number)),
  price_per_minute: Schema.optional(NullableNumberSchema),
  price_per_1m_characters: Schema.optional(NullableNumberSchema),
  open_weights_url: Schema.optional(Schema.NullOr(Schema.String)),
  categories: Schema.optional(Schema.Array(MediaCategorySchema)),
  genres: Schema.optional(Schema.Array(MediaGenreSchema)),
  bba_score: Schema.optional(NullableNumberSchema),
  fdb_score: Schema.optional(NullableNumberSchema),
  tau_voice_score: Schema.optional(NullableNumberSchema),
  aa_wer_index: Schema.optional(NullableNumberSchema),
  aa_agenttalk: Schema.optional(NullableNumberSchema),
  voxpopuli_cleaned_aa: Schema.optional(NullableNumberSchema),
  earnings_22_cleaned_aa: Schema.optional(NullableNumberSchema),
  open_weights: Schema.optional(Schema.NullOr(Schema.Boolean)),
  providers: Schema.optional(Schema.Array(MediaProviderSchema)),
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
  readonly listMediaModels: (
    type: MediaType,
    options?: ModelCacheOptions,
  ) => Effect.Effect<ReadonlyArray<MediaModel>, ProviderError>
  readonly getMediaModelCacheStatus: (
    type: MediaType,
    options?: ModelCacheOptions,
  ) => Effect.Effect<ModelCacheStatus, ProviderError>
  readonly clearMediaModelCache: (type: MediaType) => Effect.Effect<ModelCacheStatus, ProviderError>
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

export const listMediaModels = (type: MediaType, options?: ModelCacheOptions) =>
  Effect.flatMap(ModelProvider, (provider) => provider.listMediaModels(type, options))

export const getMediaModelCacheStatus = (type: MediaType, options?: ModelCacheOptions) =>
  Effect.flatMap(ModelProvider, (provider) => provider.getMediaModelCacheStatus(type, options))

export const clearMediaModelCache = (type: MediaType) =>
  Effect.flatMap(ModelProvider, (provider) => provider.clearMediaModelCache(type))
