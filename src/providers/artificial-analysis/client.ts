import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Effect } from "effect"

import { requestJsonWith } from "../../core/api"
import { loadAppConfig, requireApiKey } from "../../core/config"
import { USER_AGENT } from "../../core/constants"
import { ModelNotFoundError } from "../../core/errors"
import type { LlmModel, MediaModel, MediaType, ModelCacheOptions } from "../../core/platform"
import {
  ArtificialAnalysisLlmModelsResponseSchema,
  ArtificialAnalysisMediaModelsResponseSchema,
  LlmModelItemResponseSchema,
} from "./schemas"
import { LlmCatalogCache, MediaCatalogCache, type MediaCacheRequest } from "./cache"

type LlmModelsResponse = typeof ArtificialAnalysisLlmModelsResponseSchema.Type
type MediaModelsResponse = typeof ArtificialAnalysisMediaModelsResponseSchema.Type

const mediaEndpoints: Record<
  MediaType,
  { readonly path: string; readonly supportsCategories: boolean; readonly supportsGenres: boolean }
> = {
  "text-to-image": {
    path: "/media/text-to-image/models",
    supportsCategories: true,
    supportsGenres: false,
  },
  "image-editing": {
    path: "/media/image-editing/models",
    supportsCategories: true,
    supportsGenres: false,
  },
  "text-to-speech": {
    path: "/media/text-to-speech/models",
    supportsCategories: false,
    supportsGenres: false,
  },
  "speech-to-speech": {
    path: "/media/speech-to-speech/models",
    supportsCategories: false,
    supportsGenres: false,
  },
  "speech-to-text": {
    path: "/media/speech-to-text/models",
    supportsCategories: false,
    supportsGenres: false,
  },
  "text-to-video": {
    path: "/media/text-to-video/models",
    supportsCategories: true,
    supportsGenres: false,
  },
  "image-to-video": {
    path: "/media/image-to-video/models",
    supportsCategories: true,
    supportsGenres: false,
  },
  "text-to-video-audio": {
    path: "/media/text-to-video-audio/models",
    supportsCategories: true,
    supportsGenres: false,
  },
  "image-to-video-audio": {
    path: "/media/image-to-video-audio/models",
    supportsCategories: true,
    supportsGenres: false,
  },
  "music-instrumental": {
    path: "/media/music/instrumental/models",
    supportsCategories: false,
    supportsGenres: true,
  },
  "music-vocals": {
    path: "/media/music/with-vocals/models",
    supportsCategories: false,
    supportsGenres: true,
  },
}

const mediaCacheRequestFor = (type: MediaType): MediaCacheRequest => ({
  type,
  includeCategories: mediaEndpoints[type].supportsCategories,
  includeGenres: mediaEndpoints[type].supportsGenres,
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

const fetchLlmModelsPaginated = (rawClient: HttpClient.HttpClient, isFree: boolean) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)
    const basePath = isFree ? "/language/models/free" : "/language/models"

    const firstPage = yield* requestJsonWith(client, {
      method: "GET",
      path: basePath,
      query: { page: "1" },
      responseSchema: ArtificialAnalysisLlmModelsResponseSchema,
      selectData: (res) => res,
    })

    const allData = [...firstPage.data]
    const totalPages = firstPage.pagination.total_pages

    if (totalPages > 1) {
      const pageEffects = Array.from({ length: totalPages - 1 }, (_, i) => {
        const pageNum = String(i + 2)
        return requestJsonWith(client, {
          method: "GET",
          path: basePath,
          query: { page: pageNum },
          responseSchema: ArtificialAnalysisLlmModelsResponseSchema,
          selectData: (res) => res.data,
        })
      })

      const extraPagesData = yield* Effect.all(pageEffects, { concurrency: 5 })
      for (const pageData of extraPagesData) {
        allData.push(...pageData)
      }
    }

    return {
      tier: firstPage.tier,
      data: allData,
    }
  })

const fetchLlmModelsWithFallback = (
  rawClient: HttpClient.HttpClient,
  cachedTier?: "free" | "pro" | "commercial" | null,
  forceTierCheck?: boolean,
) =>
  Effect.gen(function* () {
    if (cachedTier === "free" && !forceTierCheck) {
      return yield* fetchLlmModelsPaginated(rawClient, true)
    }
    return yield* fetchLlmModelsPaginated(rawClient, false).pipe(
      Effect.catchTag("ApiResponseError", (error) => {
        if (error.status === 403) {
          return fetchLlmModelsPaginated(rawClient, true)
        }
        return Effect.fail(error)
      }),
    )
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

    const fetchedResult = yield* fetchLlmModelsWithFallback(
      rawClient,
      cached.tier,
      options?.forceTierCheck,
    ).pipe(
      Effect.catchAll((error) =>
        options?.allowStaleOnError !== false && cached.data !== null
          ? Effect.succeed({ tier: (cached.tier ?? "free") as "free" | "pro" | "commercial", data: cached.data })
          : Effect.fail(error),
      ),
    )

    yield* cache.write(fetchedResult.data, fetchedResult.tier)

    return fetchedResult.data
  })

const fetchLlmModelDetail = (rawClient: HttpClient.HttpClient, slug: string) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)

    return yield* requestJsonWith(client, {
      method: "GET",
      path: `/language/models/${slug}`,
      responseSchema: LlmModelItemResponseSchema,
      selectData: (res) => res.data,
    })
  })

const findModel = (models: ReadonlyArray<LlmModel>, identifier: string) =>
  models.find((model) => model.id === identifier || model.slug === identifier)

export const getLlmModel = (
  rawClient: HttpClient.HttpClient,
  cache: LlmCatalogCache,
  identifier: string,
  options?: ModelCacheOptions,
) =>
  Effect.gen(function* () {
    const maxAgeSeconds = options?.maxAgeSeconds
    const cached = yield* cache.read(maxAgeSeconds)

    if (!options?.refresh && cached.valid && cached.data !== null) {
      const model = findModel(cached.data, identifier)
      if (model) {
        return model
      }
    }

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

    const cacheStatus = yield* cache.status(options?.maxAgeSeconds)
    const tier = cacheStatus.tier ?? "free"

    if (tier === "pro" || tier === "commercial") {
      return yield* fetchLlmModelDetail(rawClient, model.slug).pipe(
        Effect.catchAll(() => Effect.succeed(model)),
      )
    }

    return model
  })

const fetchMediaModels = (rawClient: HttpClient.HttpClient, type: MediaType, isFree: boolean) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)
    const endpoint = mediaEndpoints[type]
    const path = isFree ? `${endpoint.path}/free` : endpoint.path

    const query: Record<string, string> = {}
    if (!isFree) {
      if (endpoint.supportsCategories) {
        query.include_categories = "true"
      }
      if (endpoint.supportsGenres) {
        query.include_genres = "true"
      }
    }

    return yield* requestJsonWith(client, {
      method: "GET",
      path,
      query,
      responseSchema: ArtificialAnalysisMediaModelsResponseSchema,
      selectData: (res) => res,
    })
  })

const fetchMediaModelsWithFallback = (
  rawClient: HttpClient.HttpClient,
  type: MediaType,
  cachedTier?: "free" | "pro" | "commercial" | null,
  forceTierCheck?: boolean,
) =>
  Effect.gen(function* () {
    if (cachedTier === "free" && !forceTierCheck) {
      return yield* fetchMediaModels(rawClient, type, true)
    }
    return yield* fetchMediaModels(rawClient, type, false).pipe(
      Effect.catchTag("ApiResponseError", (error) => {
        if (error.status === 403) {
          return fetchMediaModels(rawClient, type, true)
        }
        return Effect.fail(error)
      }),
    )
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

    const fetchedResult = yield* fetchMediaModelsWithFallback(
      rawClient,
      type,
      cached.tier,
      options?.forceTierCheck,
    ).pipe(
      Effect.catchAll((error) =>
        options?.allowStaleOnError !== false && cached.data !== null
          ? Effect.succeed({ tier: (cached.tier ?? "free") as "free" | "pro" | "commercial", data: cached.data })
          : Effect.fail(error),
      ),
    )

    yield* cache.write(cacheRequest, fetchedResult.data, fetchedResult.tier)

    return fetchedResult.data
  })

export const getMediaCacheStatus = (
  cache: MediaCatalogCache,
  type: MediaType,
  options?: ModelCacheOptions,
) => cache.status(mediaCacheRequestFor(type), options?.maxAgeSeconds)

export const clearMediaCache = (cache: MediaCatalogCache, type: MediaType) =>
  cache.clear(mediaCacheRequestFor(type))
