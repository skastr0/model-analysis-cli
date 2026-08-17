import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Effect } from "effect"

import { requestJsonWith } from "../../core/api"
import { loadAppConfig, requireApiKey } from "../../core/config"
import { USER_AGENT } from "../../core/constants"
import { ApiDecodeError, ModelNotFoundError } from "../../core/errors"
import type { LlmModel, MediaModel, MediaType, ModelCacheOptions } from "../../core/platform"
import {
  ArtificialAnalysisLlmModelsResponseSchema,
  ArtificialAnalysisMediaModelsResponseSchema,
  LlmModelItemResponseSchema,
} from "./schemas"
import { LlmCatalogCache, MediaCatalogCache, type MediaCacheRequest } from "./cache"

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

const ensureRouteTier = <A extends { readonly tier: "free" | "pro" | "commercial" }>(
  response: A,
  isFree: boolean,
  path: string,
) =>
  !isFree && response.tier === "free"
    ? Effect.fail(
        new ApiDecodeError({
          method: "GET",
          path,
          message: "Paid endpoint returned an impossible Free tier response",
        }),
      )
    : Effect.succeed(response)

const fetchAccessPage = (rawClient: HttpClient.HttpClient, isFree: boolean) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)
    const path = isFree ? "/language/models/free" : "/language/models"
    const response = yield* requestJsonWith(client, {
      method: "GET",
      path,
      query: {
        page: "1",
        ...(!isFree ? { prompt_type: "long" } : {}),
      },
      responseSchema: ArtificialAnalysisLlmModelsResponseSchema,
      selectData: (res) => res,
    })
    yield* ensureRouteTier(response, isFree, path)

    return {
      tier: response.tier,
      data_shape: isFree ? "free" as const : "full" as const,
    }
  })

export const checkArtificialAnalysisAccess = (rawClient: HttpClient.HttpClient) =>
  fetchAccessPage(rawClient, false).pipe(
    Effect.catchTag("ApiResponseError", (error) =>
      error.status === 403
        ? fetchAccessPage(rawClient, true)
        : Effect.fail(error),
    ),
  )

const fetchLlmModelsPaginated = (rawClient: HttpClient.HttpClient, isFree: boolean) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)
    const basePath = isFree ? "/language/models/free" : "/language/models"

    const firstPage = yield* requestJsonWith(client, {
      method: "GET",
      path: basePath,
      query: {
        page: "1",
        ...(!isFree ? { prompt_type: "long" } : {}),
      },
      responseSchema: ArtificialAnalysisLlmModelsResponseSchema,
      selectData: (res) => res,
    })
    yield* ensureRouteTier(firstPage, isFree, basePath)

    const allData = [...firstPage.data]
    const totalPages = firstPage.pagination.total_pages

    if (
      firstPage.pagination.page !== 1 ||
      firstPage.pagination.has_more !== (totalPages > 1)
    ) {
      return yield* Effect.fail(
        new ApiDecodeError({
          method: "GET",
          path: basePath,
          message: "API returned inconsistent pagination metadata for page 1",
        }),
      )
    }

    if (totalPages > 1) {
      const pageEffects = Array.from({ length: totalPages - 1 }, (_, i) => {
        const expectedPage = i + 2
        const pageNum = String(expectedPage)

        return requestJsonWith(client, {
          method: "GET",
          path: basePath,
          query: {
            page: pageNum,
            ...(!isFree ? { prompt_type: "long" } : {}),
          },
          responseSchema: ArtificialAnalysisLlmModelsResponseSchema,
          selectData: (res) => res,
        }).pipe(
          Effect.flatMap((page) => {
            const isConsistent =
              page.tier === firstPage.tier &&
              page.intelligence_index_version === firstPage.intelligence_index_version &&
              page.pagination.page === expectedPage &&
              page.pagination.page_size === firstPage.pagination.page_size &&
              page.pagination.total_pages === totalPages &&
              page.pagination.has_more === (expectedPage < totalPages)

            return isConsistent
              ? Effect.succeed(page.data)
              : Effect.fail(
                  new ApiDecodeError({
                    method: "GET",
                    path: basePath,
                    message: `API returned inconsistent pagination metadata for page ${expectedPage}`,
                  }),
                )
          }),
        )
      })

      const extraPagesData = yield* Effect.all(pageEffects, { concurrency: 5 })
      for (const pageData of extraPagesData) {
        allData.push(...pageData)
      }
    }

    return {
      tier: firstPage.tier,
      intelligenceIndexVersion: firstPage.intelligence_index_version,
      dataShape: isFree ? "free" as const : "full" as const,
      data: allData,
    }
  })

const fetchFreeLlmModelsWithUpgradeCheck = (rawClient: HttpClient.HttpClient) =>
  Effect.gen(function* () {
    const freeResult = yield* fetchLlmModelsPaginated(rawClient, true)

    return freeResult.tier === "free"
      ? freeResult
      : yield* fetchLlmModelsPaginated(rawClient, false)
  })

const fetchLlmModelsWithFallback = (
  rawClient: HttpClient.HttpClient,
  cachedTier?: "free" | "pro" | "commercial" | null,
  cachedDataShape?: "free" | "full" | null,
) =>
  Effect.gen(function* () {
    const cachedFreeShape =
      cachedDataShape === "free" || (cachedDataShape == null && cachedTier === "free")

    if (cachedFreeShape) {
      return yield* fetchFreeLlmModelsWithUpgradeCheck(rawClient)
    }

    return yield* fetchLlmModelsPaginated(rawClient, false).pipe(
      Effect.catchTag("ApiResponseError", (error) => {
        if (error.status === 403) {
          return fetchFreeLlmModelsWithUpgradeCheck(rawClient)
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
      cached.data_shape,
    ).pipe(
      Effect.map((result) => ({ source: "provider" as const, result })),
      Effect.catchAll((error) =>
        options?.allowStaleOnError !== false && cached.data !== null
          ? Effect.succeed({ source: "cache" as const, data: cached.data })
          : Effect.fail(error),
      ),
    )

    if (fetchedResult.source === "cache") {
      return fetchedResult.data
    }

    yield* cache.write(
      fetchedResult.result.data,
      fetchedResult.result.tier,
      fetchedResult.result.dataShape,
      fetchedResult.result.intelligenceIndexVersion,
    )

    return fetchedResult.result.data
  })

const fetchLlmModelDetail = (rawClient: HttpClient.HttpClient, slug: string) =>
  Effect.gen(function* () {
    const client = yield* makeArtificialAnalysisClient(rawClient)

    return yield* requestJsonWith(client, {
      method: "GET",
      path: `/language/models/${slug}`,
      query: { prompt_type: "long" },
      responseSchema: LlmModelItemResponseSchema,
      selectData: (res) => res,
    })
  })

const findModel = (models: ReadonlyArray<LlmModel>, identifier: string) =>
  models.find((model) => model.id === identifier || model.slug === identifier)

const modelNotFound = (identifier: string) =>
  new ModelNotFoundError({
    identifier,
    message: `Model '${identifier}' was not found`,
  })

export const getLlmModel = (
  rawClient: HttpClient.HttpClient,
  cache: LlmCatalogCache,
  identifier: string,
  options?: ModelCacheOptions,
) =>
  Effect.gen(function* () {
    const maxAgeSeconds = options?.maxAgeSeconds
    let catalog = yield* cache.read(maxAgeSeconds)

    if (options?.refresh || !catalog.valid || catalog.data === null) {
      yield* listLlmModels(rawClient, cache, options)
      catalog = yield* cache.read(maxAgeSeconds)
    }

    if (catalog.data === null) {
      return yield* Effect.fail(modelNotFound(identifier))
    }

    const model = findModel(catalog.data, identifier)

    if (!model) {
      return yield* Effect.fail(modelNotFound(identifier))
    }

    const tier = catalog.tier ?? "free"
    if (tier !== "pro" && tier !== "commercial") {
      return model
    }

    const catalogCachedAt = catalog.cached_at ?? ""
    const cachedDetail = yield* cache.readDetail(
      model.slug,
      catalogCachedAt,
      tier,
      maxAgeSeconds,
    )
    const matchingCachedVersion =
      catalog.intelligence_index_version == null ||
      cachedDetail.intelligence_index_version === catalog.intelligence_index_version

    if (
      !options?.refresh &&
      cachedDetail.valid &&
      cachedDetail.data !== null &&
      matchingCachedVersion
    ) {
      return cachedDetail.data
    }

    const detailResult = yield* fetchLlmModelDetail(rawClient, model.slug).pipe(
      Effect.map((response) => ({ source: "provider" as const, response })),
      Effect.catchAll((error) =>
        options?.allowStaleOnError !== false
          ? Effect.succeed({
              source: "cache" as const,
              data: matchingCachedVersion ? cachedDetail.data ?? model : model,
            })
          : Effect.fail(error),
      ),
    )

    if (detailResult.source === "cache") {
      return detailResult.data
    }

    if (
      catalog.intelligence_index_version != null &&
      detailResult.response.intelligence_index_version !== catalog.intelligence_index_version
    ) {
      return yield* Effect.fail(
        new ApiDecodeError({
          method: "GET",
          path: `/language/models/${model.slug}`,
          message:
            `Detail intelligence index version ${detailResult.response.intelligence_index_version} ` +
            `does not match catalog version ${catalog.intelligence_index_version}`,
        }),
      )
    }

    yield* cache.writeDetail(
      model.slug,
      detailResult.response.data,
      detailResult.response.tier,
      detailResult.response.intelligence_index_version,
      catalogCachedAt,
    )

    return detailResult.response.data
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

    const response = yield* requestJsonWith(client, {
      method: "GET",
      path,
      query,
      responseSchema: ArtificialAnalysisMediaModelsResponseSchema,
      selectData: (res) => res,
    })
    yield* ensureRouteTier(response, isFree, path)

    return {
      ...response,
      dataShape: isFree ? "free" as const : "full" as const,
    }
  })

const fetchFreeMediaModelsWithUpgradeCheck = (
  rawClient: HttpClient.HttpClient,
  type: MediaType,
) =>
  Effect.gen(function* () {
    const freeResult = yield* fetchMediaModels(rawClient, type, true)

    return freeResult.tier === "free"
      ? freeResult
      : yield* fetchMediaModels(rawClient, type, false)
  })

const fetchMediaModelsWithFallback = (
  rawClient: HttpClient.HttpClient,
  type: MediaType,
  cachedTier?: "free" | "pro" | "commercial" | null,
  cachedDataShape?: "free" | "full" | null,
) =>
  Effect.gen(function* () {
    const cachedFreeShape =
      cachedDataShape === "free" || (cachedDataShape == null && cachedTier === "free")

    if (cachedFreeShape) {
      return yield* fetchFreeMediaModelsWithUpgradeCheck(rawClient, type)
    }

    return yield* fetchMediaModels(rawClient, type, false).pipe(
      Effect.catchTag("ApiResponseError", (error) => {
        if (error.status === 403) {
          return fetchFreeMediaModelsWithUpgradeCheck(rawClient, type)
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
      cached.data_shape,
    ).pipe(
      Effect.map((result) => ({ source: "provider" as const, result })),
      Effect.catchAll((error) =>
        options?.allowStaleOnError !== false && cached.data !== null
          ? Effect.succeed({ source: "cache" as const, data: cached.data })
          : Effect.fail(error),
      ),
    )

    if (fetchedResult.source === "cache") {
      return fetchedResult.data
    }

    yield* cache.write(
      cacheRequest,
      fetchedResult.result.data,
      fetchedResult.result.tier,
      fetchedResult.result.dataShape,
    )

    return fetchedResult.result.data
  })

export const getMediaCacheStatus = (
  cache: MediaCatalogCache,
  type: MediaType,
  options?: ModelCacheOptions,
) => cache.status(mediaCacheRequestFor(type), options?.maxAgeSeconds)

export const clearMediaCache = (cache: MediaCatalogCache, type: MediaType) =>
  cache.clear(mediaCacheRequestFor(type))
