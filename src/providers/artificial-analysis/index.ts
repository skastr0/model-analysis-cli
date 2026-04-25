import { FetchHttpClient, HttpClient } from "@effect/platform"
import { Effect, Layer } from "effect"

import { ModelNotFoundError } from "../../core/errors"
import {
  ModelProvider,
  type LlmModel,
  type ModelCacheOptions,
  type ModelProviderService,
} from "../../core/platform"
import { LlmCatalogCache } from "./cache"
import { listLlmModels, listMediaModels } from "./client"

const findModel = (models: ReadonlyArray<LlmModel>, identifier: string) =>
  models.find((model) => model.id === identifier || model.slug === identifier)

const makeArtificialAnalysisProvider = Effect.gen(function* () {
  const rawClient = yield* HttpClient.HttpClient
  const cache = yield* LlmCatalogCache

  return {
    name: "artificial-analysis",
    listModels: (options?: ModelCacheOptions) => listLlmModels(rawClient, cache, options),
    getModel: (identifier: string, options?: ModelCacheOptions) =>
      Effect.gen(function* () {
        const models = yield* listLlmModels(rawClient, cache, options)
        const model = findModel(models, identifier)

        if (!model) {
          return yield* Effect.fail(
            new ModelNotFoundError({
              identifier,
              message: `Model '${identifier}' was not found`,
            }),
          )
        }

        return model
      }),
    getModelCacheStatus: (options) => cache.status(options?.maxAgeSeconds),
    clearModelCache: () => cache.clear(),
    listMediaModels: (type) => listMediaModels(rawClient, type),
  } satisfies ModelProviderService
})

export const ArtificialAnalysisProviderLayer = Layer.effect(ModelProvider, makeArtificialAnalysisProvider)

export const AppLayer = ArtificialAnalysisProviderLayer.pipe(
  Layer.provide(Layer.mergeAll(FetchHttpClient.layer, LlmCatalogCache.Default)),
)
