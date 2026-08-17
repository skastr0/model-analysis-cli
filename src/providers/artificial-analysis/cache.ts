import { FileSystem } from "@effect/platform"
import { createHash, randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { Effect, Either, Schema } from "effect"

import { loadAppConfig } from "../../core/config"
import {
  CACHE_DIR_ENV,
  CACHE_TTL_SECONDS_ENV,
  DEFAULT_CACHE_DIR_RELATIVE,
  DEFAULT_CACHE_TTL_SECONDS,
} from "../../core/constants"
import { CacheReadError, CacheRemoveError, CacheWriteError } from "../../core/errors"
import {
  LlmModelSchema,
  MediaModelSchema,
  MediaTypeSchema,
  type LlmModel,
  type MediaModel,
  type MediaType,
  type ModelCacheStatus,
} from "../../core/platform"

const LlmModelsCacheFileSchema = Schema.Struct({
  schema_id: Schema.Literal("model-analysis/artificial-analysis/llm-models-cache/v2"),
  provider: Schema.Literal("artificial-analysis"),
  api_base_url: Schema.String,
  cached_at: Schema.String,
  tier: Schema.Union(Schema.Literal("free"), Schema.Literal("pro"), Schema.Literal("commercial")),
  data_shape: Schema.Union(Schema.Literal("free"), Schema.Literal("full")),
  prompt_type: Schema.optional(Schema.Literal("long")),
  intelligence_index_version: Schema.Number,
  data: Schema.Array(LlmModelSchema),
})

const LlmModelDetailCacheFileSchema = Schema.Struct({
  schema_id: Schema.Literal("model-analysis/artificial-analysis/llm-model-detail-cache/v1"),
  provider: Schema.Literal("artificial-analysis"),
  api_base_url: Schema.String,
  cached_at: Schema.String,
  catalog_cached_at: Schema.String,
  tier: Schema.Union(Schema.Literal("pro"), Schema.Literal("commercial")),
  intelligence_index_version: Schema.Number,
  prompt_type: Schema.Literal("long"),
  slug: Schema.String,
  data: LlmModelSchema,
})

const MediaModelsCacheFileSchema = Schema.Struct({
  schema_id: Schema.Literal("model-analysis/artificial-analysis/media-models-cache/v2"),
  provider: Schema.Literal("artificial-analysis"),
  api_base_url: Schema.String,
  media_type: MediaTypeSchema,
  include_categories: Schema.Boolean,
  include_genres: Schema.optional(Schema.Boolean),
  cached_at: Schema.String,
  tier: Schema.Union(Schema.Literal("free"), Schema.Literal("pro"), Schema.Literal("commercial")),
  data_shape: Schema.Union(Schema.Literal("free"), Schema.Literal("full")),
  data: Schema.Array(MediaModelSchema),
})

type LlmModelsCacheFile = typeof LlmModelsCacheFileSchema.Type
type LlmModelDetailCacheFile = typeof LlmModelDetailCacheFileSchema.Type
type MediaModelsCacheFile = typeof MediaModelsCacheFileSchema.Type

interface CatalogCacheReadResult<A> extends ModelCacheStatus {
  readonly data: ReadonlyArray<A> | null
}

type LlmCacheReadResult = CatalogCacheReadResult<LlmModel>
type MediaCacheReadResult = CatalogCacheReadResult<MediaModel>

export interface LlmModelDetailCacheReadResult {
  readonly path: string
  readonly exists: boolean
  readonly valid: boolean
  readonly fresh: boolean
  readonly stale: boolean
  readonly cached_at: string | null
  readonly age_seconds: number | null
  readonly ttl_seconds: number
  readonly error: string | null
  readonly tier: "pro" | "commercial" | null
  readonly intelligence_index_version: number | null
  readonly data: LlmModel | null
}

export interface MediaCacheRequest {
  readonly type: MediaType
  readonly includeCategories: boolean
  readonly includeGenres: boolean
}

interface CacheLocation {
  readonly directory: string
  readonly key: string
  readonly latestPath: string
  readonly snapshotDirectory: string
}

const platformErrorReason = (error: { readonly _tag?: string; readonly reason?: unknown }) =>
  typeof error.reason === "string" ? error.reason : error._tag ?? "PlatformError"

export class LlmCatalogCache extends Effect.Service<LlmCatalogCache>()(
  "model-analysis/LlmCatalogCache",
  {
    effect: Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem

      const resolveLocation = Effect.fn("LlmCatalogCache.resolveLocation")(function* () {
        const config = yield* loadAppConfig()
        const cacheDir = Bun.env[CACHE_DIR_ENV]?.trim() || `${homedir()}/${DEFAULT_CACHE_DIR_RELATIVE}`
        const directory = cacheDir.replace(/\/+$/, "")
        const cacheKey = createHash("sha256")
          .update(`${config.apiBaseUrl}\n${config.apiKey ?? ""}`)
          .digest("hex")
          .slice(0, 16)

        return {
          directory,
          key: cacheKey,
          latestPath: `${directory}/artificial-analysis-llm-models-${cacheKey}.json`,
          snapshotDirectory: `${directory}/snapshots`,
        } satisfies CacheLocation
      })

      const resolvePath = Effect.fn("LlmCatalogCache.resolvePath")(function* () {
        const location = yield* resolveLocation()

        return location.latestPath
      })

      const resolveDetailLocation = Effect.fn("LlmCatalogCache.resolveDetailLocation")(function* (
        slug: string,
      ) {
        const catalogLocation = yield* resolveLocation()
        const detailKey = createHash("sha256").update(slug).digest("hex").slice(0, 16)
        const key = `${catalogLocation.key}-${detailKey}`

        return {
          directory: catalogLocation.directory,
          key,
          latestPath: `${catalogLocation.directory}/artificial-analysis-llm-model-detail-${key}.json`,
          snapshotDirectory: catalogLocation.snapshotDirectory,
        } satisfies CacheLocation
      })

      const detailSnapshotPathFor = (
        location: CacheLocation,
        cachedAt: string,
        snapshotId: string,
      ) => {
        const timestamp = cachedAt.replace(/[:.]/g, "-")

        return `${location.snapshotDirectory}/artificial-analysis-llm-model-detail-${location.key}-${timestamp}-${snapshotId}.json`
      }

      const readDetail = Effect.fn("LlmCatalogCache.readDetail")(function* (
        slug: string,
        catalogCachedAt: string,
        catalogTier: "pro" | "commercial",
        maxAgeSeconds?: number,
      ) {
        const location = yield* resolveDetailLocation(slug)
        const path = location.latestPath
        const ttlSeconds = resolveModelCacheTtlSeconds(maxAgeSeconds)
        const exists = yield* fileSystem.exists(path).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        if (!exists) {
          return emptyDetailReadResult(path, ttlSeconds, false)
        }

        const text = yield* fileSystem.readFileString(path).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )
        const decoded = yield* Schema.decodeUnknown(
          Schema.parseJson(LlmModelDetailCacheFileSchema),
        )(text).pipe(Effect.either)

        if (
          Either.isLeft(decoded) ||
          decoded.right.slug !== slug ||
          decoded.right.data.slug !== slug ||
          decoded.right.catalog_cached_at !== catalogCachedAt ||
          decoded.right.tier !== catalogTier
        ) {
          return {
            ...emptyDetailReadResult(path, ttlSeconds, true),
            stale: true,
            error: Either.isLeft(decoded)
              ? decoded.left.message
              : "Detail cache file does not match the requested model catalog generation",
          } satisfies LlmModelDetailCacheReadResult
        }

        const cachedAtMs = Date.parse(decoded.right.cached_at)
        const ageSeconds = Number.isFinite(cachedAtMs)
          ? Math.max(0, Math.floor((Date.now() - cachedAtMs) / 1000))
          : null
        const fresh = ageSeconds !== null && ageSeconds <= ttlSeconds

        return {
          path,
          exists: true,
          valid: true,
          fresh,
          stale: !fresh,
          cached_at: decoded.right.cached_at,
          age_seconds: ageSeconds,
          ttl_seconds: ttlSeconds,
          error: null,
          tier: decoded.right.tier,
          intelligence_index_version: decoded.right.intelligence_index_version,
          data: decoded.right.data,
        } satisfies LlmModelDetailCacheReadResult
      })

      const writeDetail = Effect.fn("LlmCatalogCache.writeDetail")(function* (
        slug: string,
        model: LlmModel,
        tier: "pro" | "commercial",
        intelligenceIndexVersion: number,
        catalogCachedAt: string,
      ) {
        const location = yield* resolveDetailLocation(slug)
        const path = location.latestPath
        const config = yield* loadAppConfig()
        const cachedAt = new Date().toISOString()
        const snapshotPath = detailSnapshotPathFor(location, cachedAt, randomUUID())
        const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
        const tempSnapshotPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`
        const cacheFile = {
          schema_id: "model-analysis/artificial-analysis/llm-model-detail-cache/v1",
          provider: "artificial-analysis",
          api_base_url: config.apiBaseUrl,
          cached_at: cachedAt,
          catalog_cached_at: catalogCachedAt,
          tier,
          intelligence_index_version: intelligenceIndexVersion,
          prompt_type: "long",
          slug,
          data: model,
        } satisfies LlmModelDetailCacheFile

        return yield* Effect.gen(function* () {
          const serialized = `${JSON.stringify(cacheFile, null, 2)}\n`

          yield* fileSystem.makeDirectory(location.directory, { recursive: true })
          yield* fileSystem.makeDirectory(location.snapshotDirectory, { recursive: true })
          yield* fileSystem.writeFileString(tempPath, serialized)
          yield* fileSystem.writeFileString(tempSnapshotPath, serialized)
          yield* fileSystem.rename(tempPath, path)
          yield* fileSystem.rename(tempSnapshotPath, snapshotPath)
        }).pipe(
          Effect.mapError((error) =>
            new CacheWriteError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
          Effect.tapError(() =>
            Effect.all(
              [
                fileSystem.remove(tempPath).pipe(Effect.ignore),
                fileSystem.remove(tempSnapshotPath).pipe(Effect.ignore),
              ],
              { discard: true },
            ),
          ),
        )
      })

      const snapshotPathFor = (location: CacheLocation, cachedAt: string, snapshotId: string) => {
        const timestamp = cachedAt.replace(/[:.]/g, "-")

        return `${location.snapshotDirectory}/artificial-analysis-llm-models-${location.key}-${timestamp}-${snapshotId}.json`
      }

      const countSnapshots = Effect.fn("LlmCatalogCache.countSnapshots")(function* (location: CacheLocation) {
        const exists = yield* fileSystem.exists(location.snapshotDirectory).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path: location.snapshotDirectory,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        if (!exists) {
          return 0
        }

        const entries = yield* fileSystem.readDirectory(location.snapshotDirectory).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path: location.snapshotDirectory,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        return entries.filter(
          (entry) =>
            entry.startsWith(`artificial-analysis-llm-models-${location.key}-`) &&
            entry.endsWith(".json"),
        ).length
      })

      const read = Effect.fn("LlmCatalogCache.read")(function* (maxAgeSeconds?: number) {
        const location = yield* resolveLocation()
        const path = location.latestPath
        const ttlSeconds = resolveModelCacheTtlSeconds(maxAgeSeconds)
        const snapshotCount = yield* countSnapshots(location)
        const exists = yield* fileSystem.exists(path).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        if (!exists) {
          return emptyReadResult<LlmModel>(location, ttlSeconds, snapshotCount, false)
        }

        const text = yield* fileSystem.readFileString(path).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )
        const decoded = yield* Schema.decodeUnknown(Schema.parseJson(LlmModelsCacheFileSchema))(text).pipe(
          Effect.either,
        )

        if (Either.isLeft(decoded)) {
          return {
            ...emptyReadResult<LlmModel>(location, ttlSeconds, snapshotCount, true),
            valid: false,
            stale: true,
            error: decoded.left.message,
          } satisfies LlmCacheReadResult
        }

        const cachedAtMs = Date.parse(decoded.right.cached_at)
        const ageSeconds = Number.isFinite(cachedAtMs)
          ? Math.max(0, Math.floor((Date.now() - cachedAtMs) / 1000))
          : null
        const fresh = ageSeconds !== null && ageSeconds <= ttlSeconds

        return {
          enabled: true,
          path,
          snapshot_directory: location.snapshotDirectory,
          snapshot_count: snapshotCount,
          exists: true,
          valid: true,
          fresh,
          stale: !fresh,
          cached_at: decoded.right.cached_at,
          age_seconds: ageSeconds,
          ttl_seconds: ttlSeconds,
          model_count: decoded.right.data.length,
          error: null,
          data: decoded.right.data,
          tier: decoded.right.tier ?? null,
          data_shape: decoded.right.data_shape ?? null,
          prompt_type: decoded.right.prompt_type ?? null,
          intelligence_index_version: decoded.right.intelligence_index_version ?? null,
        } satisfies LlmCacheReadResult
      })

      const write = Effect.fn("LlmCatalogCache.write")(function* (
        models: ReadonlyArray<LlmModel>,
        tier: "free" | "pro" | "commercial",
        dataShape: "free" | "full",
        intelligenceIndexVersion: number,
      ) {
        const location = yield* resolveLocation()
        const path = location.latestPath
        const config = yield* loadAppConfig()
        const cachedAt = new Date().toISOString()
        const snapshotPath = snapshotPathFor(location, cachedAt, randomUUID())
        const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
        const tempSnapshotPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`
        const cacheFile = {
          schema_id: "model-analysis/artificial-analysis/llm-models-cache/v2",
          provider: "artificial-analysis",
          api_base_url: config.apiBaseUrl,
          cached_at: cachedAt,
          tier,
          data_shape: dataShape,
          prompt_type: dataShape === "full" ? "long" : undefined,
          intelligence_index_version: intelligenceIndexVersion,
          data: models,
        } satisfies LlmModelsCacheFile

        return yield* Effect.gen(function* () {
          const serialized = `${JSON.stringify(cacheFile, null, 2)}\n`

          yield* fileSystem.makeDirectory(location.directory, { recursive: true })
          yield* fileSystem.makeDirectory(location.snapshotDirectory, { recursive: true })
          yield* fileSystem.writeFileString(tempPath, serialized)
          yield* fileSystem.writeFileString(tempSnapshotPath, serialized)
          yield* fileSystem.rename(tempPath, path)
          yield* fileSystem.rename(tempSnapshotPath, snapshotPath)
        }).pipe(
          Effect.mapError((error) =>
            new CacheWriteError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
          Effect.tapError(() =>
            Effect.all(
              [
                fileSystem.remove(tempPath).pipe(Effect.ignore),
                fileSystem.remove(tempSnapshotPath).pipe(Effect.ignore),
              ],
              { discard: true },
            ),
          ),
        )
      })

      const status = Effect.fn("LlmCatalogCache.status")(function* (maxAgeSeconds?: number) {
        const cache = yield* read(maxAgeSeconds)

        return {
          ...toStatus(cache),
          prompt_type: cache.prompt_type ?? null,
          intelligence_index_version: cache.intelligence_index_version ?? null,
        } satisfies ModelCacheStatus
      })

      const clear = Effect.fn("LlmCatalogCache.clear")(function* () {
        const location = yield* resolveLocation()
        const path = location.latestPath
        const exists = yield* fileSystem.exists(path).pipe(
          Effect.mapError((error) =>
            new CacheRemoveError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        if (exists) {
          yield* fileSystem.remove(path).pipe(
            Effect.mapError((error) =>
              new CacheRemoveError({
                path,
                reason: platformErrorReason(error),
                message: error.message,
              }),
            ),
          )
        }

        return yield* status()
      })

      return {
        read,
        write,
        readDetail,
        writeDetail,
        status,
        clear,
      }
    }),
  },
) {}

export class MediaCatalogCache extends Effect.Service<MediaCatalogCache>()(
  "model-analysis/MediaCatalogCache",
  {
    effect: Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem

      const resolveLocation = Effect.fn("MediaCatalogCache.resolveLocation")(function* (
        request: MediaCacheRequest,
      ) {
        const config = yield* loadAppConfig()
        const cacheDir = Bun.env[CACHE_DIR_ENV]?.trim() || `${homedir()}/${DEFAULT_CACHE_DIR_RELATIVE}`
        const directory = cacheDir.replace(/\/+$/, "")
        const categoryScope = request.includeCategories ? "with-categories" : "base"
        const genreScope = request.includeGenres ? "with-genres" : "no-genres"
        const scope = `${request.type}-${categoryScope}-${genreScope}`
        const cacheKey = createHash("sha256")
          .update(`${config.apiBaseUrl}\n${config.apiKey ?? ""}\n${request.type}\n${categoryScope}\n${genreScope}`)
          .digest("hex")
          .slice(0, 16)

        return {
          directory,
          key: `${scope}-${cacheKey}`,
          latestPath: `${directory}/artificial-analysis-media-models-${scope}-${cacheKey}.json`,
          snapshotDirectory: `${directory}/snapshots`,
        } satisfies CacheLocation
      })

      const snapshotPathFor = (location: CacheLocation, cachedAt: string, snapshotId: string) => {
        const timestamp = cachedAt.replace(/[:.]/g, "-")

        return `${location.snapshotDirectory}/artificial-analysis-media-models-${location.key}-${timestamp}-${snapshotId}.json`
      }

      const countSnapshots = Effect.fn("MediaCatalogCache.countSnapshots")(function* (
        location: CacheLocation,
      ) {
        const exists = yield* fileSystem.exists(location.snapshotDirectory).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path: location.snapshotDirectory,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        if (!exists) {
          return 0
        }

        const entries = yield* fileSystem.readDirectory(location.snapshotDirectory).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path: location.snapshotDirectory,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        return entries.filter(
          (entry) =>
            entry.startsWith(`artificial-analysis-media-models-${location.key}-`) &&
            entry.endsWith(".json"),
        ).length
      })

      const read = Effect.fn("MediaCatalogCache.read")(function* (
        request: MediaCacheRequest,
        maxAgeSeconds?: number,
      ) {
        const location = yield* resolveLocation(request)
        const path = location.latestPath
        const ttlSeconds = resolveModelCacheTtlSeconds(maxAgeSeconds)
        const snapshotCount = yield* countSnapshots(location)
        const exists = yield* fileSystem.exists(path).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        if (!exists) {
          return emptyReadResult<MediaModel>(location, ttlSeconds, snapshotCount, false)
        }

        const text = yield* fileSystem.readFileString(path).pipe(
          Effect.mapError((error) =>
            new CacheReadError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )
        const decoded = yield* Schema.decodeUnknown(Schema.parseJson(MediaModelsCacheFileSchema))(text).pipe(
          Effect.either,
        )

        if (Either.isLeft(decoded)) {
          return {
            ...emptyReadResult<MediaModel>(location, ttlSeconds, snapshotCount, true),
            valid: false,
            stale: true,
            error: decoded.left.message,
          } satisfies MediaCacheReadResult
        }

        if (
          decoded.right.media_type !== request.type ||
          decoded.right.include_categories !== request.includeCategories ||
          (decoded.right.include_genres ?? false) !== request.includeGenres
        ) {
          return {
            ...emptyReadResult<MediaModel>(location, ttlSeconds, snapshotCount, true),
            valid: false,
            stale: true,
            error: "Cache file does not match requested media cache key",
          } satisfies MediaCacheReadResult
        }

        const cachedAtMs = Date.parse(decoded.right.cached_at)
        const ageSeconds = Number.isFinite(cachedAtMs)
          ? Math.max(0, Math.floor((Date.now() - cachedAtMs) / 1000))
          : null
        const fresh = ageSeconds !== null && ageSeconds <= ttlSeconds

        return {
          enabled: true,
          path,
          snapshot_directory: location.snapshotDirectory,
          snapshot_count: snapshotCount,
          exists: true,
          valid: true,
          fresh,
          stale: !fresh,
          cached_at: decoded.right.cached_at,
          age_seconds: ageSeconds,
          ttl_seconds: ttlSeconds,
          model_count: decoded.right.data.length,
          error: null,
          data: decoded.right.data,
          tier: decoded.right.tier ?? null,
          data_shape: decoded.right.data_shape ?? null,
        } satisfies MediaCacheReadResult
      })

      const write = Effect.fn("MediaCatalogCache.write")(function* (
        request: MediaCacheRequest,
        models: ReadonlyArray<MediaModel>,
        tier: "free" | "pro" | "commercial",
        dataShape: "free" | "full",
      ) {
        const location = yield* resolveLocation(request)
        const path = location.latestPath
        const config = yield* loadAppConfig()
        const cachedAt = new Date().toISOString()
        const snapshotPath = snapshotPathFor(location, cachedAt, randomUUID())
        const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
        const tempSnapshotPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`
        const cacheFile = {
          schema_id: "model-analysis/artificial-analysis/media-models-cache/v2",
          provider: "artificial-analysis",
          api_base_url: config.apiBaseUrl,
          media_type: request.type,
          include_categories: request.includeCategories,
          include_genres: request.includeGenres,
          cached_at: cachedAt,
          tier,
          data_shape: dataShape,
          data: models,
        } satisfies MediaModelsCacheFile

        return yield* Effect.gen(function* () {
          const serialized = `${JSON.stringify(cacheFile, null, 2)}\n`

          yield* fileSystem.makeDirectory(location.directory, { recursive: true })
          yield* fileSystem.makeDirectory(location.snapshotDirectory, { recursive: true })
          yield* fileSystem.writeFileString(tempPath, serialized)
          yield* fileSystem.writeFileString(tempSnapshotPath, serialized)
          yield* fileSystem.rename(tempPath, path)
          yield* fileSystem.rename(tempSnapshotPath, snapshotPath)
        }).pipe(
          Effect.mapError((error) =>
            new CacheWriteError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
          Effect.tapError(() =>
            Effect.all(
              [
                fileSystem.remove(tempPath).pipe(Effect.ignore),
                fileSystem.remove(tempSnapshotPath).pipe(Effect.ignore),
              ],
              { discard: true },
            ),
          ),
        )
      })

      const status = Effect.fn("MediaCatalogCache.status")(function* (
        request: MediaCacheRequest,
        maxAgeSeconds?: number,
      ) {
        const cache = yield* read(request, maxAgeSeconds)

        return toStatus(cache)
      })

      const clear = Effect.fn("MediaCatalogCache.clear")(function* (request: MediaCacheRequest) {
        const location = yield* resolveLocation(request)
        const path = location.latestPath
        const exists = yield* fileSystem.exists(path).pipe(
          Effect.mapError((error) =>
            new CacheRemoveError({
              path,
              reason: platformErrorReason(error),
              message: error.message,
            }),
          ),
        )

        if (exists) {
          yield* fileSystem.remove(path).pipe(
            Effect.mapError((error) =>
              new CacheRemoveError({
                path,
                reason: platformErrorReason(error),
                message: error.message,
              }),
            ),
          )
        }

        return yield* status(request)
      })

      return {
        read,
        write,
        status,
        clear,
      }
    }),
  },
) {}

export const resolveModelCacheTtlSeconds = (maxAgeSeconds?: number) => {
  if (maxAgeSeconds !== undefined) {
    return maxAgeSeconds
  }

  const rawValue = Bun.env[CACHE_TTL_SECONDS_ENV]?.trim()

  if (!rawValue) {
    return DEFAULT_CACHE_TTL_SECONDS
  }

  const parsed = Number.parseInt(rawValue, 10)

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_SECONDS
}

const emptyDetailReadResult = (
  path: string,
  ttlSeconds: number,
  exists: boolean,
): LlmModelDetailCacheReadResult => ({
  path,
  exists,
  valid: false,
  fresh: false,
  stale: exists,
  cached_at: null,
  age_seconds: null,
  ttl_seconds: ttlSeconds,
  error: null,
  tier: null,
  intelligence_index_version: null,
  data: null,
})

const emptyReadResult = <A>(
  location: CacheLocation,
  ttlSeconds: number,
  snapshotCount: number,
  exists: boolean,
): CatalogCacheReadResult<A> => ({
  enabled: true,
  path: location.latestPath,
  snapshot_directory: location.snapshotDirectory,
  snapshot_count: snapshotCount,
  exists,
  valid: false,
  fresh: false,
  stale: exists,
  cached_at: null,
  age_seconds: null,
  ttl_seconds: ttlSeconds,
  model_count: null,
  error: null,
  data: null,
})

const toStatus = <A>(cache: CatalogCacheReadResult<A>): ModelCacheStatus => ({
  enabled: cache.enabled,
  path: cache.path,
  snapshot_directory: cache.snapshot_directory,
  snapshot_count: cache.snapshot_count,
  exists: cache.exists,
  valid: cache.valid,
  fresh: cache.fresh,
  stale: cache.stale,
  cached_at: cache.cached_at,
  age_seconds: cache.age_seconds,
  ttl_seconds: cache.ttl_seconds,
  model_count: cache.model_count,
  error: cache.error,
  tier: cache.tier ?? null,
  data_shape: cache.data_shape ?? null,
})
