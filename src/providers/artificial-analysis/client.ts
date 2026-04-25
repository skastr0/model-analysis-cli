import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Effect } from "effect"

import { requestJsonWith } from "../../core/api"
import { loadAppConfig, requireApiKey } from "../../core/config"
import { USER_AGENT } from "../../core/constants"
import type { LlmModel, MediaType, ModelCacheOptions } from "../../core/platform"
import {
  ArtificialAnalysisLlmModelsResponseSchema,
  ArtificialAnalysisMediaModelsResponseSchema,
} from "./schemas"
import { LlmCatalogCache, MediaCatalogCache, type MediaCacheRequest } from "./cache"

type LlmModelsResponse = typeof ArtificialAnalysisLlmModelsResponseSchema.Type
type MediaModelsResponse = typeof ArtificialAnalysisMediaModelsResponseSchema.Type

const mediaEndpoints: Record<MediaType, { readonly path: string; readonly supportsCategories: boolean }> = {
  "text-to-image": {
    path: "/data/media/text-to-image",
    supportsCategories: true,
  },
  "image-editing": {
    path: "/data/media/image-editing",
    supportsCategories: false,
  },
  "text-to-speech": {
    path: "/data/media/text-to-speech",
    supportsCategories: false,
  },
  "text-to-video": {
    path: "/data/media/text-to-video",
    supportsCategories: true,
  },
  "image-to-video": {
    path: "/data/media/image-to-video",
    supportsCategories: true,
  },
}

const mediaCacheRequestFor = (type: MediaType): MediaCacheRequest => ({
  type,
  includeCategories: mediaEndpoints[type].supportsCategories,
})

const makeArtificialAnalysisClient = (rawClient: HttpClient.HttpClient) =>
  Effect.gen(function* () {
    const config = yield* loadAppConfig()
    const apiKey = yield* requireApiKey()

    return rawClient.pipe(
      HttpClient.mapRequest((request) =>
        request.pipe(
          HttpClientRequest.prependUrl(config.apiBaseUrl),
          HttpClientRequest.acceptJson,
          HttpClientRequest.setHeader("x-api-key", apiKey),
          HttpClientRequest.setHeader("user-agent", USER_AGENT),
        ),
      ),
    )
  })

const selectLlmModels = (response: LlmModelsResponse) =>
  "data" in response ? response.data : response

const selectMediaModels = (response: MediaModelsResponse) =>
  "data" in response ? response.data : response

const fetchLlmModels = (rawClient: HttpClient.HttpClient) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)

    return yield* requestJsonWith(client, {
      method: "GET",
      path: "/data/llms/models",
      responseSchema: ArtificialAnalysisLlmModelsResponseSchema,
      selectData: selectLlmModels,
    })
  })

export const listLlmModels = (
  rawClient: HttpClient.HttpClient,
  cache: LlmCatalogCache,
  options?: ModelCacheOptions,
) =>
  Effect.gen(function* () {
    const maxAgeSeconds = options?.maxAgeSeconds
    const cached = yield* cache.read(maxAgeSeconds)

    if (!options?.refresh && cached.valid && cached.data !== null) {
      return cached.data
    }

    const fetched = yield* fetchLlmModels(rawClient).pipe(
      Effect.catchAll((error) =>
        options?.allowStaleOnError !== false && cached.data !== null
          ? Effect.succeed(cached.data)
          : Effect.fail(error),
      ),
    )

    yield* cache.write(fetched)

    return fetched
  })

const fetchMediaModels = (rawClient: HttpClient.HttpClient, type: MediaType) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)
    const endpoint = mediaEndpoints[type]

    return yield* requestJsonWith(client, {
      method: "GET",
      path: endpoint.path,
      ...(endpoint.supportsCategories
        ? { query: { include_categories: "true" } }
        : {}),
      responseSchema: ArtificialAnalysisMediaModelsResponseSchema,
      selectData: selectMediaModels,
    })
  })

export const listMediaModels = (
  rawClient: HttpClient.HttpClient,
  cache: MediaCatalogCache,
  type: MediaType,
  options?: ModelCacheOptions,
) =>
  Effect.gen(function* () {
    const cacheRequest = mediaCacheRequestFor(type)
    const maxAgeSeconds = options?.maxAgeSeconds
    const cached = yield* cache.read(cacheRequest, maxAgeSeconds)

    if (!options?.refresh && cached.valid && cached.data !== null) {
      return cached.data
    }

    const fetched = yield* fetchMediaModels(rawClient, type).pipe(
      Effect.catchAll((error) =>
        options?.allowStaleOnError !== false && cached.data !== null
          ? Effect.succeed(cached.data)
          : Effect.fail(error),
      ),
    )

    yield* cache.write(cacheRequest, fetched)

    return fetched
  })

export const getMediaCacheStatus = (
  cache: MediaCatalogCache,
  type: MediaType,
  options?: ModelCacheOptions,
) => cache.status(mediaCacheRequestFor(type), options?.maxAgeSeconds)

export const clearMediaCache = (cache: MediaCatalogCache, type: MediaType) =>
  cache.clear(mediaCacheRequestFor(type))
