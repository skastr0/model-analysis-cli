import { FetchHttpClient, HttpClient } from "@effect/platform"
import { Effect, Layer } from "effect"

import {
  ModelProvider,
  type ModelCacheOptions,
  type ModelProviderService,
} from "../../core/platform"
import { LlmCatalogCache, MediaCatalogCache } from "./cache"
import { clearMediaCache, getLlmModel, getMediaCacheStatus, listLlmModels, listMediaModels } from "./client"

const makeArtificialAnalysisProvider = Effect.gen(function* () {
  const rawClient = yield* HttpClient.HttpClient
  const cache = yield* LlmCatalogCache
  const mediaCache = yield* MediaCatalogCache

  return {
    name: "artificial-analysis",
    listModels: (options?: ModelCacheOptions) => listLlmModels(rawClient, cache, options),
    getModel: (identifier: string, options?: ModelCacheOptions) =>
      getLlmModel(rawClient, cache, identifier, options),
    getModelCacheStatus: (options) => cache.status(options?.maxAgeSeconds),
    clearModelCache: () => cache.clear(),
    listMediaModels: (type, options) => listMediaModels(rawClient, mediaCache, type, options),
    getMediaModelCacheStatus: (type, options) => getMediaCacheStatus(mediaCache, type, options),
    clearMediaModelCache: (type) => clearMediaCache(mediaCache, type),
  } satisfies ModelProviderService
})

export const ArtificialAnalysisProviderLayer = Layer.effect(ModelProvider, makeArtificialAnalysisProvider)

export const AppLayer = ArtificialAnalysisProviderLayer.pipe(
  Layer.provide(Layer.mergeAll(FetchHttpClient.layer, LlmCatalogCache.Default, MediaCatalogCache.Default)),
)
