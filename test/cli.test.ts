import { describe, expect, it } from "bun:test"
import { FileSystem } from "@effect/platform"
import { Effect, Scope } from "effect"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"

import {
  ApiDecodeError,
  ApiRequestError,
  ApiResponseError,
  CommandInputError,
  ConfigurationError,
  JsonInputError,
  MissingApiKeyError,
  ModelNotFoundError,
  ModelsNotFoundError,
} from "../src/core/errors"
import { loadBatchJsonInput } from "../src/core/json"
import { toErrorDetails } from "../src/core/output"
import { expectJson, runCli } from "./helpers/cli"
import { startMockApi } from "./helpers/mock-api"

const runEffect = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(effect)

const runScopedEffect = <A>(effect: Effect.Effect<A, unknown, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect))

const SAMPLE_LLM_MODELS = [
  {
    id: "model_o3_mini",
    name: "o3-mini",
    slug: "o3-mini",
    release_date: "2024-09-12",
    model_creator: {
      id: "openai",
      name: "OpenAI",
      slug: "openai",
    },
    evaluations: {
      artificial_analysis_intelligence_index: 62.1,
      artificial_analysis_coding_index: 63.7,
      artificial_analysis_math_index: null,
      livecodebench: 67.5,
      gpqa: 57.2,
      hle: null,
      aime_25: null,
      ifbench: 0.71,
      lcr: 0.69,
      terminalbench_hard: 0.37,
      tau2: 0.81,
    },
    pricing: {
      price_1m_blended_3_to_1: 4.5,
      price_1m_input_tokens: 1.1,
      price_1m_output_tokens: 8.9,
    },
    median_output_tokens_per_second: 121.4,
    median_time_to_first_token_seconds: 0.41,
    median_time_to_first_answer_token: 0.47,
  },
  {
    id: "model_gpt_4o",
    name: "GPT-4o",
    slug: "gpt-4o",
    release_date: null,
    model_creator: {
      id: "openai",
      name: "OpenAI",
      slug: "openai",
    },
    evaluations: {
      artificial_analysis_intelligence_index: 58.4,
      artificial_analysis_coding_index: 55.3,
      mmlu_pro: 81.2,
      math_500: 93.8,
    },
    pricing: {
      price_1m_blended_3_to_1: 8.3,
      price_1m_input_tokens: 5,
      price_1m_output_tokens: null,
    },
    median_output_tokens_per_second: 98.6,
    median_time_to_first_token_seconds: 0.53,
    median_time_to_first_answer_token: null,
  },
]

const enveloped = <A>(data: A) => ({
  status: 200,
  prompt_options: {
    parallel_queries: 1,
    prompt_length: 1000,
  },
  data,
})

const SAMPLE_MEDIA_MODELS = [
  {
    id: "flux_pro",
    name: "FLUX.1 Pro",
    slug: "flux-1-pro",
    model_creator: {
      id: "black-forest-labs",
      name: "Black Forest Labs",
    },
    elo: 1178,
    rank: 1,
    ci95: "+/- 23",
    appearances: 412,
    release_date: "2024-08-01",
    categories: [
      {
        style_category: "photorealistic",
        elo: 1188,
        ci95: "+/- 30",
        appearances: 149,
      },
      {
        subject_matter_category: "portraits",
        elo: 1169,
        ci95: "+/- 28",
        appearances: 121,
      },
    ],
  },
  {
    id: "gpt_image_1",
    name: "GPT Image 1",
    slug: "gpt-image-1",
    model_creator: {
      id: "openai",
      name: "OpenAI",
    },
    elo: 1140,
    rank: 2,
    ci95: "+/- 25",
    appearances: 351,
  },
]

describe("model-analysis CLI", () => {
  it("auth status reports missing API key without failing", async () => {
    const result = await runEffect(
      runCli(["auth", "status"], {
        ARTIFICIAL_ANALYSIS_API_KEY: undefined,
        ARTIFICIAL_ANALYSIS_BASE_URL: undefined,
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        configured: boolean
        authenticated: boolean
        api_base_url: string
        status: number | null
        error?: string
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("auth status")
    expect(payload.data.configured).toBe(false)
    expect(payload.data.authenticated).toBe(false)
    expect(payload.data.status).toBeNull()
    expect(payload.data.error).toBe("API key is not configured")
  })

  it("auth status reports configured API key without spending a catalog request", async () => {
    const requests: Array<{ path: string; credentialHeader: string | string[] | undefined }> = []

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            credentialHeader: request.headers["x-api-key"],
          })

          return {
            status: 200,
            body: enveloped(SAMPLE_LLM_MODELS),
          }
        })

        return yield* runCli(["auth", "status"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        configured: boolean
        authenticated: boolean | null
        checked: boolean
        api_base_url: string
        status: number | null
        note?: string
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("auth status")
    expect(payload.data.configured).toBe(true)
    expect(payload.data.authenticated).toBeNull()
    expect(payload.data.checked).toBe(false)
    expect(payload.data.status).toBeNull()
    expect(payload.data.note).toContain("--check")
    expect(requests).toEqual([])
  })

  it("auth status --check verifies provider connectivity", async () => {
    const requests: Array<{ path: string; credentialHeader: string | string[] | undefined }> = []

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            credentialHeader: request.headers["x-api-key"],
          })

          return {
            status: 200,
            body: enveloped(SAMPLE_LLM_MODELS),
          }
        })

        return yield* runCli(["auth", "status", "--check"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        configured: boolean
        authenticated: boolean
        checked: boolean
        api_base_url: string
        status: number | null
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("auth status")
    expect(payload.data.configured).toBe(true)
    expect(payload.data.authenticated).toBe(true)
    expect(payload.data.checked).toBe(true)
    expect(payload.data.status).toBe(200)
    expect(requests).toEqual([
      {
        path: "/data/llms/models",
        credentialHeader: "test-key",
      },
    ])
  })

  it("models list returns all LLM models", async () => {
    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 200,
          body: enveloped(SAMPLE_LLM_MODELS),
        }))

        return yield* runCli(["models", "list"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: typeof SAMPLE_LLM_MODELS
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("models list")
    expect(payload.data).toEqual(SAMPLE_LLM_MODELS)
  })

  it("models get returns a model by slug", async () => {
    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 200,
          body: SAMPLE_LLM_MODELS,
        }))

        return yield* runCli(["models", "get", '{"slug":"o3-mini"}'], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: (typeof SAMPLE_LLM_MODELS)[number]
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("models get")
    expect(payload.data).toEqual(SAMPLE_LLM_MODELS[0]!)
  })

  it("models compare returns models in requested order", async () => {
    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 200,
          body: SAMPLE_LLM_MODELS,
        }))

        return yield* runCli(["models", "compare", '{"model_slugs":["gpt-4o","o3-mini"]}'], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: typeof SAMPLE_LLM_MODELS
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("models compare")
    expect(payload.data.map((model) => model.slug)).toEqual(["gpt-4o", "o3-mini"])
  })

  it("models get reuses the cached LLM catalog", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (requests.length > 1) {
            return {
              status: 429,
              body: { error: { message: "Rate limit exceeded" } },
            }
          }

          return {
            status: 200,
            body: enveloped(SAMPLE_LLM_MODELS),
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const listResult = yield* runCli(["models", "list"], env)
        const getResult = yield* runCli(["models", "get", '{"slug":"o3-mini"}'], env)

        const getPayload = expectJson<{
          ok: boolean
          command: string
          data: (typeof SAMPLE_LLM_MODELS)[number]
        }>(getResult.stdout)

        expect(listResult.exitCode).toBe(0)
        expect(getResult.exitCode).toBe(0)
        expect(getPayload.data.slug).toBe("o3-mini")
      }),
    )

    expect(requests).toEqual(["/data/llms/models"])
  })

  it("models compare reuses the cached LLM catalog", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (requests.length > 1) {
            return {
              status: 429,
              body: { error: { message: "Rate limit exceeded" } },
            }
          }

          return {
            status: 200,
            body: enveloped(SAMPLE_LLM_MODELS),
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const listResult = yield* runCli(["models", "list"], env)
        const compareResult = yield* runCli(
          ["models", "compare", '{"model_slugs":["gpt-4o","o3-mini"]}'],
          env,
        )

        const comparePayload = expectJson<{
          ok: boolean
          command: string
          data: typeof SAMPLE_LLM_MODELS
        }>(compareResult.stdout)

        expect(listResult.exitCode).toBe(0)
        expect(compareResult.exitCode).toBe(0)
        expect(comparePayload.data.map((model) => model.slug)).toEqual(["gpt-4o", "o3-mini"])
      }),
    )

    expect(requests).toEqual(["/data/llms/models"])
  })

  it("models list uses stale valid cache unless refresh is requested", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (requests.length > 1) {
            return {
              status: 429,
              body: { error: { message: "Rate limit exceeded" } },
            }
          }

          return {
            status: 200,
            body: enveloped(SAMPLE_LLM_MODELS),
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const listResult = yield* runCli(["models", "list"], env)
        const statusResult = yield* runCli(["models", "cache", "status"], env)
        const statusPayload = expectJson<{
          ok: boolean
          command: string
          data: { path: string }
        }>(statusResult.stdout)

        const cacheFile = JSON.parse(readFileSync(statusPayload.data.path, "utf8")) as {
          cached_at: string
        }
        writeFileSync(
          statusPayload.data.path,
          `${JSON.stringify({ ...cacheFile, cached_at: "2000-01-01T00:00:00.000Z" }, null, 2)}\n`,
        )

        const cachedListResult = yield* runCli(
          ["models", "list", "--cache-ttl-seconds", "1"],
          env,
        )
        const cachedListPayload = expectJson<{
          ok: boolean
          command: string
          data: typeof SAMPLE_LLM_MODELS
        }>(cachedListResult.stdout)

        expect(listResult.exitCode).toBe(0)
        expect(statusResult.exitCode).toBe(0)
        expect(cachedListResult.exitCode).toBe(0)
        expect(cachedListPayload.data.map((model) => model.slug)).toEqual(["o3-mini", "gpt-4o"])
      }),
    )

    expect(requests).toEqual(["/data/llms/models"])
  })

  it("models list writes a latest cache and permanent snapshot", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 200,
          body: enveloped(SAMPLE_LLM_MODELS),
        }))

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const listResult = yield* runCli(["models", "list"], env)
        const statusResult = yield* runCli(["models", "cache", "status"], env)

        return { listResult, statusResult }
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        path: string
        snapshot_directory: string
        snapshot_count: number
        exists: boolean
        valid: boolean
        fresh: boolean
        ttl_seconds: number
        model_count: number
      }
    }>(result.statusResult.stdout)

    expect(result.listResult.exitCode).toBe(0)
    expect(result.statusResult.exitCode).toBe(0)
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("models cache status")
    expect(payload.data.path.startsWith(cacheDir)).toBe(true)
    expect(payload.data.snapshot_directory.startsWith(cacheDir)).toBe(true)
    expect(payload.data.snapshot_count).toBe(1)
    expect(payload.data.exists).toBe(true)
    expect(payload.data.valid).toBe(true)
    expect(payload.data.fresh).toBe(true)
    expect(payload.data.ttl_seconds).toBe(7 * 24 * 60 * 60)
    expect(payload.data.model_count).toBe(SAMPLE_LLM_MODELS.length)
  })

  it("media list returns category data when requested", async () => {
    const requests: Array<{ path: string; includeCategories: string | null }> = []

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            includeCategories: request.query.get("include_categories"),
          })

          return {
            status: 200,
            body: SAMPLE_MEDIA_MODELS,
          }
        })

        return yield* runCli(["media", "list", '{"type":"text-to-image","include_categories":true}'], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: typeof SAMPLE_MEDIA_MODELS
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("media list")
    expect(payload.data[0]?.categories?.length).toBe(2)
    expect(requests).toEqual([
      {
        path: "/data/media/text-to-image",
        includeCategories: "true",
      },
    ])
  })

  it("media list reuses the cached media catalog", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<{ path: string; includeCategories: string | null }> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            includeCategories: request.query.get("include_categories"),
          })

          if (requests.length > 1) {
            return {
              status: 429,
              body: { error: { message: "Rate limit exceeded" } },
            }
          }

          return {
            status: 200,
            body: SAMPLE_MEDIA_MODELS,
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const firstResult = yield* runCli(
          ["media", "list", '{"type":"text-to-image","include_categories":true}'],
          env,
        )
        const secondResult = yield* runCli(
          ["media", "list", '{"type":"text-to-image","include_categories":true}'],
          env,
        )
        const statusResult = yield* runCli(
          ["media", "cache", "status", '{"type":"text-to-image"}'],
          env,
        )

        const secondPayload = expectJson<{
          ok: boolean
          command: string
          data: typeof SAMPLE_MEDIA_MODELS
        }>(secondResult.stdout)
        const statusPayload = expectJson<{
          ok: boolean
          command: string
          data: {
            path: string
            snapshot_directory: string
            snapshot_count: number
            exists: boolean
            valid: boolean
            model_count: number
          }
        }>(statusResult.stdout)

        expect(firstResult.exitCode).toBe(0)
        expect(secondResult.exitCode).toBe(0)
        expect(statusResult.exitCode).toBe(0)
        expect(secondPayload.command).toBe("media list")
        expect(secondPayload.data[0]?.categories?.length).toBe(2)
        expect(statusPayload.command).toBe("media cache status")
        expect(statusPayload.data.path.startsWith(cacheDir)).toBe(true)
        expect(statusPayload.data.snapshot_directory.startsWith(cacheDir)).toBe(true)
        expect(statusPayload.data.snapshot_count).toBe(1)
        expect(statusPayload.data.exists).toBe(true)
        expect(statusPayload.data.valid).toBe(true)
        expect(statusPayload.data.model_count).toBe(SAMPLE_MEDIA_MODELS.length)
      }),
    )

    expect(requests).toEqual([
      {
        path: "/data/media/text-to-image",
        includeCategories: "true",
      },
    ])
  })

  it("media list can fall back to stale cache when refresh hits a rate limit", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<{ path: string; includeCategories: string | null }> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            includeCategories: request.query.get("include_categories"),
          })

          if (requests.length > 1) {
            return {
              status: 429,
              body: { error: { message: "Rate limit exceeded" } },
            }
          }

          return {
            status: 200,
            body: SAMPLE_MEDIA_MODELS,
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const listResult = yield* runCli(
          ["media", "list", '{"type":"text-to-video","include_categories":true}'],
          env,
        )
        const statusResult = yield* runCli(
          ["media", "cache", "status", '{"type":"text-to-video"}'],
          env,
        )
        const statusPayload = expectJson<{
          ok: boolean
          command: string
          data: { path: string }
        }>(statusResult.stdout)

        const cacheFile = JSON.parse(readFileSync(statusPayload.data.path, "utf8")) as {
          cached_at: string
        }
        writeFileSync(
          statusPayload.data.path,
          `${JSON.stringify({ ...cacheFile, cached_at: "2000-01-01T00:00:00.000Z" }, null, 2)}\n`,
        )

        const refreshedResult = yield* runCli(
          [
            "media",
            "list",
            "--refresh",
            "--cache-ttl-seconds",
            "1",
            "--stale-if-error",
            '{"type":"text-to-video","include_categories":true}',
          ],
          env,
        )
        const refreshedPayload = expectJson<{
          ok: boolean
          command: string
          data: typeof SAMPLE_MEDIA_MODELS
        }>(refreshedResult.stdout)

        expect(listResult.exitCode).toBe(0)
        expect(statusResult.exitCode).toBe(0)
        expect(refreshedResult.exitCode).toBe(0)
        expect(refreshedPayload.data.map((model) => model.slug)).toEqual(["flux-1-pro", "gpt-image-1"])
      }),
    )

    expect(requests).toEqual([
      {
        path: "/data/media/text-to-video",
        includeCategories: "true",
      },
      {
        path: "/data/media/text-to-video",
        includeCategories: "true",
      },
    ])
  })

  it("media cache preserves category-rich data for stripped and full projections", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<{ path: string; includeCategories: string | null }> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            includeCategories: request.query.get("include_categories"),
          })

          return {
            status: 200,
            body: SAMPLE_MEDIA_MODELS,
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const strippedResult = yield* runCli(["media", "list", '{"type":"image-to-video"}'], env)
        const fullResult = yield* runCli(
          ["media", "list", '{"type":"image-to-video","include_categories":true}'],
          env,
        )

        const strippedPayload = expectJson<{
          ok: boolean
          command: string
          data: typeof SAMPLE_MEDIA_MODELS
        }>(strippedResult.stdout)
        const fullPayload = expectJson<{
          ok: boolean
          command: string
          data: typeof SAMPLE_MEDIA_MODELS
        }>(fullResult.stdout)

        expect(strippedResult.exitCode).toBe(0)
        expect(fullResult.exitCode).toBe(0)
        expect(strippedPayload.data[0]?.categories).toBeUndefined()
        expect(fullPayload.data[0]?.categories?.length).toBe(2)
      }),
    )

    expect(requests).toEqual([
      {
        path: "/data/media/image-to-video",
        includeCategories: "true",
      },
    ])
  })

  it("models list fails with MissingApiKeyError when API key is absent", async () => {
    const result = await runEffect(
      runCli(["models", "list"], {
        ARTIFICIAL_ANALYSIS_API_KEY: undefined,
        ARTIFICIAL_ANALYSIS_BASE_URL: undefined,
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details?: { env_var?: string }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("models list")
    expect(payload.error.type).toBe("MissingApiKeyError")
    expect(payload.error.details?.env_var).toBe("ARTIFICIAL_ANALYSIS_API_KEY")
  })

  it("models get validates selector input", async () => {
    const result = await runEffect(
      runCli(["models", "get", "{}"], {
        ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details?: { field?: string }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("models get")
    expect(payload.error.type).toBe("CommandInputError")
    expect(payload.error.details?.field).toBe("input")
  })

  it("models list returns structured 429 API errors", async () => {
    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 429,
          body: {
            error: {
              message: "Rate limit exceeded",
            },
          },
        }))

        return yield* runCli(["models", "list"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details?: { status?: number }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("models list")
    expect(payload.error.type).toBe("ApiResponseError")
    expect(payload.error.message).toBe("Rate limit exceeded")
    expect(payload.error.details?.status).toBe(429)
  })
})

describe("toErrorDetails", () => {
  it("formats ConfigurationError", async () => {
    const details = toErrorDetails(
      new ConfigurationError({
        field: "ARTIFICIAL_ANALYSIS_BASE_URL",
        message: "Invalid URL",
      }),
    )

    expect(details.type).toBe("ConfigurationError")
    expect(details.message).toBe("Invalid URL")
    expect(details.details).toEqual({ field: "ARTIFICIAL_ANALYSIS_BASE_URL" })
  })

  it("formats MissingApiKeyError", async () => {
    const details = toErrorDetails(
      new MissingApiKeyError({
        envVar: "ARTIFICIAL_ANALYSIS_API_KEY",
        hint: "Set your API key",
      }),
    )

    expect(details.type).toBe("MissingApiKeyError")
    expect(details.message).toBe("ARTIFICIAL_ANALYSIS_API_KEY is not configured")
    expect(details.details).toEqual({
      env_var: "ARTIFICIAL_ANALYSIS_API_KEY",
      hint: "Set your API key",
    })
  })

  it("formats JsonInputError", async () => {
    const details = toErrorDetails(
      new JsonInputError({
        source: "inline",
        reason: "InvalidJson",
        message: "Unexpected token",
      }),
    )

    expect(details.type).toBe("JsonInputError")
    expect(details.details).toEqual({
      source: "inline",
      reason: "InvalidJson",
    })
  })

  it("formats CommandInputError", async () => {
    const details = toErrorDetails(
      new CommandInputError({
        field: "name",
        message: "name must not be empty",
      }),
    )

    expect(details.type).toBe("CommandInputError")
    expect(details.details).toEqual({ field: "name" })
  })

  it("formats ModelNotFoundError", async () => {
    const details = toErrorDetails(
      new ModelNotFoundError({
        identifier: "o3-mini",
        message: "Model 'o3-mini' was not found",
      }),
    )

    expect(details.type).toBe("ModelNotFoundError")
    expect(details.details).toEqual({ identifier: "o3-mini" })
  })

  it("formats ModelsNotFoundError", async () => {
    const details = toErrorDetails(
      new ModelsNotFoundError({
        identifiers: ["foo", "bar"],
        message: "Models not found: foo, bar",
      }),
    )

    expect(details.type).toBe("ModelsNotFoundError")
    expect(details.details).toEqual({ identifiers: ["foo", "bar"] })
  })

  it("formats ApiRequestError", async () => {
    const details = toErrorDetails(
      new ApiRequestError({
        method: "POST",
        path: "/data/llms/models",
        reason: "ConnectionRefused",
        message: "Connection refused",
      }),
    )

    expect(details.type).toBe("ApiRequestError")
    expect(details.details).toEqual({
      method: "POST",
      path: "/data/llms/models",
      reason: "ConnectionRefused",
    })
  })

  it("formats ApiResponseError", async () => {
    const details = toErrorDetails(
      new ApiResponseError({
        method: "GET",
        path: "/data/media/text-to-image",
        status: 422,
        message: "Validation failed",
        body: { errors: ["invalid"] },
      }),
    )

    expect(details.type).toBe("ApiResponseError")
    expect(details.details).toEqual({
      method: "GET",
      path: "/data/media/text-to-image",
      status: 422,
      body: { errors: ["invalid"] },
    })
  })

  it("formats ApiDecodeError", async () => {
    const details = toErrorDetails(
      new ApiDecodeError({
        method: "GET",
        path: "/data/llms/models",
        message: "Unexpected end of JSON input",
      }),
    )

    expect(details.type).toBe("ApiDecodeError")
    expect(details.details).toEqual({
      method: "GET",
      path: "/data/llms/models",
    })
  })

  it("falls back to Error for untagged errors", async () => {
    const details = toErrorDetails(new Error("something went wrong"))
    expect(details.type).toBe("Error")
    expect(details.message).toBe("something went wrong")
  })

  it("falls back for unknown values", async () => {
    const details = toErrorDetails("plain string")
    expect(details.type).toBe("Error")
    expect(details.message).toBe("plain string")
  })
})

describe("loadBatchJsonInput", () => {
  it("wraps a single object in an array", async () => {
    const result = await runEffect(
      loadBatchJsonInput('{"name": "test"}').pipe(
        Effect.provide(FileSystem.layerNoop({})),
      ),
    )

    expect(result).toEqual([{ name: "test" }])
  })

  it("preserves an array as-is", async () => {
    const result = await runEffect(
      loadBatchJsonInput('[{"name": "a"}, {"name": "b"}]').pipe(
        Effect.provide(FileSystem.layerNoop({})),
      ),
    )

    expect(result).toEqual([{ name: "a" }, { name: "b" }])
  })

  it("fails for non-object input", async () => {
    const exit = await runEffect(
      loadBatchJsonInput("123").pipe(
        Effect.provide(FileSystem.layerNoop({})),
        Effect.exit,
      ),
    )

    expect(exit._tag).toBe("Failure")
  })
})
