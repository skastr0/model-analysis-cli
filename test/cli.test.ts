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
    },
    evaluations: {
      artificial_analysis_intelligence_index: 62.1,
      artificial_analysis_coding_index: 63.7,
      artificial_analysis_agentic_index: 27.6,
    },
    pricing: {
      price_1m_blended_3_to_1: 4.5,
      price_1m_input_tokens: 1.1,
      price_1m_output_tokens: 8.9,
      price_1m_cache_hit_tokens: 0.5,
      price_1m_cache_write_tokens: 1,
    },
    performance: {
      median_output_tokens_per_second: 121.4,
      median_time_to_first_token_seconds: 0.41,
      median_time_to_first_answer_token_seconds: 0.47,
      median_end_to_end_response_time_seconds: 4.6,
    },
    artificial_analysis_intelligence_index_cost: null,
  },
  {
    id: "model_gpt_4o",
    name: "GPT-4o",
    slug: "gpt-4o",
    release_date: null,
    model_creator: {
      id: "openai",
      name: "OpenAI",
    },
    evaluations: {
      artificial_analysis_intelligence_index: 58.4,
      artificial_analysis_coding_index: 55.3,
      artificial_analysis_agentic_index: null,
    },
    pricing: {
      price_1m_blended_3_to_1: 8.3,
      price_1m_input_tokens: 5,
      price_1m_output_tokens: null,
      price_1m_cache_hit_tokens: null,
      price_1m_cache_write_tokens: null,
    },
    performance: {
      median_output_tokens_per_second: 98.6,
      median_time_to_first_token_seconds: 0.53,
      median_time_to_first_answer_token_seconds: null,
      median_end_to_end_response_time_seconds: 6.1,
    },
    artificial_analysis_intelligence_index_cost: null,
  },
]

const enveloped = <A>(data: A) => ({
  tier: "pro" as const,
  intelligence_index_version: 4.1,
  pagination: {
    page: 1,
    page_size: 200,
    total_pages: 1,
    has_more: false,
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
    ci_95: 23,
    samples: 412,
    release_date: "2024-08-01",
    categories: [
      {
        label: "Photorealistic",
        elo: 1188,
        ci_95: 30,
        samples: 149,
      },
      {
        label: "Portraits",
        elo: 1169,
        ci_95: 28,
        samples: 121,
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
    ci_95: 25,
    samples: 351,
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

  it("auth status --check verifies provider connectivity with only the first catalog page", async () => {
    const requests: Array<{
      path: string
      page: string | null
      promptType: string | null
      credentialHeader: string | string[] | undefined
    }> = []

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            page: request.query.get("page"),
            promptType: request.query.get("prompt_type"),
            credentialHeader: request.headers["x-api-key"],
          })

          return {
            status: 200,
            body: {
              ...enveloped(SAMPLE_LLM_MODELS),
              pagination: {
                page: 1,
                page_size: 200,
                total_pages: 4,
                has_more: true,
              },
            },
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
        available: boolean
        checked: boolean
        api_base_url: string
        status: number | null
        tier: string | null
        data_shape: string
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("auth status")
    expect(payload.data.configured).toBe(true)
    expect(payload.data.authenticated).toBe(true)
    expect(payload.data.available).toBe(true)
    expect(payload.data.checked).toBe(true)
    expect(payload.data.status).toBe(200)
    expect(payload.data.tier).toBe("pro")
    expect(payload.data.data_shape).toBe("full")
    expect(requests).toEqual([
      {
        path: "/language/models",
        page: "1",
        promptType: "long",
        credentialHeader: "test-key",
      },
    ])
  })

  it("auth status --check distinguishes invalid credentials from provider unavailability", async () => {
    const invalidResult = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 401,
          body: { error: "Invalid API key" },
        }))

        return yield* runCli(["auth", "status", "--check"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )
    const unavailableResult = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 429,
          body: { error: "Rate limit exceeded" },
        }))

        return yield* runCli(["auth", "status", "--check"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
        })
      }),
    )
    const invalidPayload = expectJson<{
      ok: boolean
      data: { authenticated: boolean | null; available: boolean; status: number }
    }>(invalidResult.stdout)
    const unavailablePayload = expectJson<{
      ok: boolean
      data: { authenticated: boolean | null; available: boolean; status: number }
    }>(unavailableResult.stdout)

    expect(invalidResult.exitCode).toBe(0)
    expect(invalidPayload.data.authenticated).toBe(false)
    expect(invalidPayload.data.available).toBe(false)
    expect(invalidPayload.data.status).toBe(401)
    expect(unavailableResult.exitCode).toBe(0)
    expect(unavailablePayload.data.authenticated).toBeNull()
    expect(unavailablePayload.data.available).toBe(false)
    expect(unavailablePayload.data.status).toBe(429)
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

  it("models list follows V2 pagination and sends the documented long prompt preset", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<{ page: string | null; promptType: string | null }> = []

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          const page = Number(request.query.get("page") ?? "1")
          requests.push({
            page: request.query.get("page"),
            promptType: request.query.get("prompt_type"),
          })

          return {
            status: 200,
            body: {
              tier: "pro",
              intelligence_index_version: 4.1,
              pagination: {
                page,
                page_size: 1,
                total_pages: 2,
                has_more: page < 2,
              },
              data: [SAMPLE_LLM_MODELS[page - 1]!],
            },
          }
        })

        return yield* runCli(["models", "list"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      data: typeof SAMPLE_LLM_MODELS
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.data.map((model) => model.slug)).toEqual(["o3-mini", "gpt-4o"])
    expect(requests).toEqual([
      { page: "1", promptType: "long" },
      { page: "2", promptType: "long" },
    ])
  })

  it("models list rejects mixed-version pagination snapshots", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          const page = Number(request.query.get("page") ?? "1")

          return {
            status: 200,
            body: {
              tier: "pro",
              intelligence_index_version: page === 1 ? 4.1 : 4.2,
              pagination: {
                page,
                page_size: 1,
                total_pages: 2,
                has_more: page === 1,
              },
              data: [SAMPLE_LLM_MODELS[page - 1]!],
            },
          }
        })

        return yield* runCli(["models", "list"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        })
      }),
    )

    const payload = expectJson<{ ok: boolean; error: { type: string } }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(payload.error.type).toBe("ApiDecodeError")
  })

  it("paid routes reject impossible Free-tier success envelopes", async () => {
    const modelResult = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 200,
          body: { ...enveloped(SAMPLE_LLM_MODELS), tier: "free" },
        }))

        return yield* runCli(["models", "list"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: mkdtempSync(resolve(tmpdir(), "model-analysis-cache-")),
        })
      }),
    )
    const mediaResult = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 200,
          body: { tier: "free", data: SAMPLE_MEDIA_MODELS },
        }))

        return yield* runCli(["media", "list", '{"type":"text-to-image"}'], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: mkdtempSync(resolve(tmpdir(), "model-analysis-cache-")),
        })
      }),
    )
    const modelPayload = expectJson<{ ok: boolean; error: { type: string } }>(modelResult.stderr)
    const mediaPayload = expectJson<{ ok: boolean; error: { type: string } }>(mediaResult.stderr)

    expect(modelResult.exitCode).toBe(1)
    expect(modelPayload.error.type).toBe("ApiDecodeError")
    expect(mediaResult.exitCode).toBe(1)
    expect(mediaPayload.error.type).toBe("ApiDecodeError")
  })

  it("models list accepts the current paid shape when pricing is omitted", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const { pricing: _pricing, ...modelWithoutPricing } = SAMPLE_LLM_MODELS[0]!

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => ({
          status: 200,
          body: enveloped([modelWithoutPricing]),
        }))

        return yield* runCli(["models", "list"], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      data: Array<{ slug: string; pricing?: unknown }>
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.data[0]?.slug).toBe("o3-mini")
    expect(payload.data[0]?.pricing).toBeUndefined()
  })

  it("models get preserves V2 detail-only intelligence and provider fields", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<{ path: string; promptType: string | null }> = []
    const tokenCounts = {
      input_tokens: 100,
      answer_tokens: 20,
      output_tokens: 50,
      reasoning_tokens: 30,
    }
    const detailModel = {
      ...SAMPLE_LLM_MODELS[0]!,
      modalities: {
        input: { text: true, image: false, video: false, speech: false },
        output: { text: true, image: false, video: false, speech: false },
      },
      evaluation_token_counts: { hle: tokenCounts },
      aa_omniscience_breakdown: {
        total: { accuracy: 0.5, omniscience: 0.25, hallucination_rate: 0.1 },
      },
      artificial_analysis_openness_index_breakdown: {
        weights_access: 3,
        artificial_analysis_openness_index: 38.9,
      },
      providers: [
        {
          id: "provider-1",
          name: "Provider One",
          slug: "provider-one",
          pricing: {
            price_1m_input_tokens: 1,
            price_1m_output_tokens: 2,
            price_1m_cache_hit_tokens: null,
            price_1m_cache_write_tokens: null,
          },
          performance: {
            median_output_tokens_per_second: 100,
            median_time_to_first_token_seconds: 0.5,
            median_time_to_first_answer_token_seconds: 0.6,
            median_end_to_end_response_time_seconds: 5.6,
          },
          context_window_tokens: 128000,
        },
      ],
    }

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            promptType: request.query.get("prompt_type"),
          })

          if (request.path === "/language/models/o3-mini") {
            return {
              status: 200,
              body: {
                tier: "commercial",
                intelligence_index_version: 4.1,
                data: detailModel,
              },
            }
          }

          return {
            status: 200,
            body: enveloped(SAMPLE_LLM_MODELS),
          }
        })

        return yield* runCli(["models", "get", '{"slug":"o3-mini"}'], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      data: {
        evaluation_token_counts?: { hle?: typeof tokenCounts }
        aa_omniscience_breakdown?: { total: { accuracy: number } }
        artificial_analysis_openness_index_breakdown?: {
          artificial_analysis_openness_index?: number | null
        }
        providers?: Array<{ slug: string }>
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.data.evaluation_token_counts?.hle).toEqual(tokenCounts)
    expect(payload.data.aa_omniscience_breakdown?.total.accuracy).toBe(0.5)
    expect(
      payload.data.artificial_analysis_openness_index_breakdown
        ?.artificial_analysis_openness_index,
    ).toBe(38.9)
    expect(payload.data.providers?.[0]?.slug).toBe("provider-one")
    expect(requests).toEqual([
      { path: "/language/models", promptType: "long" },
      { path: "/language/models/o3-mini", promptType: "long" },
    ])
  })

  it("models get propagates paid detail authentication failures", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) =>
          request.path === "/language/models/o3-mini"
            ? { status: 401, body: { error: "Invalid API key" } }
            : { status: 200, body: enveloped(SAMPLE_LLM_MODELS) },
        )

        return yield* runCli(["models", "get", '{"slug":"o3-mini"}'], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        })
      }),
    )

    const payload = expectJson<{
      ok: boolean
      error: { type: string; details?: { status?: number } }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(payload.error.type).toBe("ApiResponseError")
    expect(payload.error.details?.status).toBe(401)
  })

  it("models get propagates paid detail schema drift", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))

    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) =>
          request.path === "/language/models/o3-mini"
            ? { status: 200, body: { tier: "pro", data: SAMPLE_LLM_MODELS[0] } }
            : { status: 200, body: enveloped(SAMPLE_LLM_MODELS) },
        )

        return yield* runCli(["models", "get", '{"slug":"o3-mini"}'], {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        })
      }),
    )

    const payload = expectJson<{ ok: boolean; error: { type: string } }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(payload.error.type).toBe("ApiDecodeError")
  })

  it("models list falls back to /free endpoint on 403 and caches the free tier", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (request.path === "/language/models") {
            return {
              status: 403,
              body: { error: { message: "Forbidden - Free Tier keys must use /free endpoints" } },
            }
          }

          if (request.path === "/language/models/free") {
            return {
              status: 200,
              body: {
                tier: "free" as const,
                intelligence_index_version: 4.1,
                pagination: {
                  page: 1,
                  page_size: 200,
                  total_pages: 1,
                  has_more: false,
                },
                data: SAMPLE_LLM_MODELS,
              },
            }
          }

          return {
            status: 404,
            body: { error: { message: "Not Found" } },
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const listResult1 = yield* runCli(["models", "list"], env)
        const payload1 = expectJson<{
          ok: boolean
          command: string
          data: typeof SAMPLE_LLM_MODELS
        }>(listResult1.stdout)

        expect(listResult1.exitCode).toBe(0)
        expect(payload1.ok).toBe(true)
        expect(payload1.data).toEqual(SAMPLE_LLM_MODELS)
        expect(requests).toEqual(["/language/models", "/language/models/free"])

        const cacheStatusResult = yield* runCli(["models", "cache", "status"], env)
        const cacheStatusPayload = expectJson<{
          ok: boolean
          data: {
            tier: string
            data_shape: string
            prompt_type: string | null
            intelligence_index_version: number
            exists: boolean
            valid: boolean
          }
        }>(cacheStatusResult.stdout)

        expect(cacheStatusResult.exitCode).toBe(0)
        expect(cacheStatusPayload.data.exists).toBe(true)
        expect(cacheStatusPayload.data.valid).toBe(true)
        expect(cacheStatusPayload.data.tier).toBe("free")
        expect(cacheStatusPayload.data.data_shape).toBe("free")
        expect(cacheStatusPayload.data.prompt_type).toBeNull()
        expect(cacheStatusPayload.data.intelligence_index_version).toBe(4.1)

        const authStatusResult = yield* runCli(["auth", "status", "--check"], env)
        const authStatusPayload = expectJson<{
          ok: boolean
          data: {
            tier: string
            checked: boolean
          }
        }>(authStatusResult.stdout)

        expect(authStatusResult.exitCode).toBe(0)
        expect(authStatusPayload.data.checked).toBe(true)
        expect(authStatusPayload.data.tier).toBe("free")
      }),
    )
  })

  it("models list uses cached free tier to bypass pro endpoint checks on subsequent refreshes", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (request.path === "/language/models") {
            return {
              status: 403,
              body: { error: { message: "Forbidden" } },
            }
          }

          if (request.path === "/language/models/free") {
            return {
              status: 200,
              body: {
                tier: "free" as const,
                intelligence_index_version: 4.1,
                pagination: {
                  page: 1,
                  page_size: 200,
                  total_pages: 1,
                  has_more: false,
                },
                data: SAMPLE_LLM_MODELS,
              },
            }
          }

          return {
            status: 404,
            body: { error: { message: "Not Found" } },
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        // First list: falls back and caches "free"
        yield* runCli(["models", "list"], env)
        expect(requests).toEqual(["/language/models", "/language/models/free"])

        // Query cache status to find cache path
        // Reset request log
        requests.length = 0

        // Second list with explicit --refresh starts at /free because the cached data shape is Free.
        const listResult2 = yield* runCli(["models", "list", "--refresh"], env)
        const payload2 = expectJson<{
          ok: boolean
          data: typeof SAMPLE_LLM_MODELS
        }>(listResult2.stdout)

        expect(listResult2.exitCode).toBe(0)
        expect(payload2.ok).toBe(true)
        expect(payload2.data).toEqual(SAMPLE_LLM_MODELS)
        expect(requests).toEqual(["/language/models/free"])

        // Reset request log
        requests.length = 0

        // auth status --check is an independent one-page probe, so it always tries the standard route first.
        const authStatusResult = yield* runCli(["auth", "status", "--check"], env)
        expect(authStatusResult.exitCode).toBe(0)
        expect(requests).toEqual(["/language/models", "/language/models/free"])
      }),
    )
  })

  it("models refresh detects an in-place Free-to-Pro upgrade without caching a paid tier as Free-shaped data", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []
    let upgraded = false

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (request.path === "/language/models/free") {
            return {
              status: 200,
              body: {
                ...enveloped(SAMPLE_LLM_MODELS),
                tier: upgraded ? "pro" : "free",
              },
            }
          }

          if (request.path === "/language/models" && upgraded) {
            return {
              status: 200,
              body: enveloped([
                { ...SAMPLE_LLM_MODELS[0]!, reasoning_model: true },
                SAMPLE_LLM_MODELS[1]!,
              ]),
            }
          }

          return {
            status: 403,
            body: { error: "Free keys must use the /free endpoint" },
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const initialResult = yield* runCli(["models", "list"], env)
        expect(initialResult.exitCode).toBe(0)

        upgraded = true
        const refreshedResult = yield* runCli(["models", "list", "--refresh"], env)
        const refreshedPayload = expectJson<{
          ok: boolean
          data: Array<{ reasoning_model?: boolean }>
        }>(refreshedResult.stdout)
        const statusResult = yield* runCli(["models", "cache", "status"], env)
        const statusPayload = expectJson<{
          ok: boolean
          data: { tier: string; data_shape: string }
        }>(statusResult.stdout)

        expect(refreshedResult.exitCode).toBe(0)
        expect(refreshedPayload.data[0]?.reasoning_model).toBe(true)
        expect(statusPayload.data.tier).toBe("pro")
        expect(statusPayload.data.data_shape).toBe("full")
      }),
    )

    expect(requests).toEqual([
      "/language/models",
      "/language/models/free",
      "/language/models/free",
      "/language/models",
    ])
  })

  it("models get returns a model by slug", async () => {
    const result = await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          if (request.path === "/language/models/o3-mini") {
            return {
              status: 200,
              body: {
                tier: "pro",
                intelligence_index_version: 4.1,
                data: SAMPLE_LLM_MODELS[0],
              },
            }
          }
          return {
            status: 200,
            body: enveloped(SAMPLE_LLM_MODELS),
          }
        })

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
          body: enveloped(SAMPLE_LLM_MODELS),
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

  it("models get caches detail separately without freshening the catalog", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []
    const detailedModel = { ...SAMPLE_LLM_MODELS[0]!, reasoning_model: true }

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (request.path === "/language/models/o3-mini") {
            return {
              status: 200,
              body: {
                tier: "pro",
                intelligence_index_version: 4.1,
                data: detailedModel,
              },
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
        const initialStatusResult = yield* runCli(["models", "cache", "status"], env)
        const initialStatus = expectJson<{
          ok: boolean
          data: { path: string }
        }>(initialStatusResult.stdout)
        const cacheFile = JSON.parse(readFileSync(initialStatus.data.path, "utf8")) as object
        writeFileSync(
          initialStatus.data.path,
          `${JSON.stringify(
            { ...cacheFile, cached_at: "2000-01-01T00:00:00.000Z" },
            null,
            2,
          )}\n`,
        )

        const firstGetResult = yield* runCli(["models", "get", '{"slug":"o3-mini"}'], env)
        const secondGetResult = yield* runCli(["models", "get", '{"slug":"o3-mini"}'], env)
        const secondGetPayload = expectJson<{
          ok: boolean
          data: { slug: string; reasoning_model?: boolean }
        }>(secondGetResult.stdout)
        const finalStatusResult = yield* runCli(["models", "cache", "status"], env)
        const finalStatus = expectJson<{
          ok: boolean
          data: { cached_at: string; snapshot_count: number }
        }>(finalStatusResult.stdout)

        expect(listResult.exitCode).toBe(0)
        expect(firstGetResult.exitCode).toBe(0)
        expect(secondGetResult.exitCode).toBe(0)
        expect(secondGetPayload.data.slug).toBe("o3-mini")
        expect(secondGetPayload.data.reasoning_model).toBe(true)
        expect(finalStatus.data.cached_at).toBe("2000-01-01T00:00:00.000Z")
        expect(finalStatus.data.snapshot_count).toBe(1)
      }),
    )

    expect(requests).toEqual(["/language/models", "/language/models/o3-mini"])
  })

  it("models get invalidates Commercial detail data when a refreshed catalog is Pro", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []
    let catalogTier: "commercial" | "pro" = "commercial"

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (request.path === "/language/models/o3-mini") {
            return {
              status: 200,
              body: {
                tier: catalogTier,
                intelligence_index_version: 4.1,
                data: {
                  ...SAMPLE_LLM_MODELS[0]!,
                  ...(catalogTier === "commercial"
                    ? {
                        providers: [
                          {
                            id: "provider-1",
                            name: "Provider One",
                            slug: "provider-one",
                            pricing: {
                              price_1m_input_tokens: 1,
                              price_1m_output_tokens: 2,
                              price_1m_cache_hit_tokens: null,
                              price_1m_cache_write_tokens: null,
                            },
                            performance: {
                              median_output_tokens_per_second: 100,
                              median_time_to_first_token_seconds: 0.5,
                              median_time_to_first_answer_token_seconds: 0.6,
                              median_end_to_end_response_time_seconds: 5.6,
                            },
                            context_window_tokens: null,
                          },
                        ],
                      }
                    : {}),
                },
              },
            }
          }

          return {
            status: 200,
            body: { ...enveloped(SAMPLE_LLM_MODELS), tier: catalogTier },
          }
        })
        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const commercialGet = yield* runCli(["models", "get", '{"slug":"o3-mini"}'], env)
        const commercialPayload = expectJson<{
          ok: boolean
          data: { providers?: ReadonlyArray<unknown> }
        }>(commercialGet.stdout)
        expect(commercialPayload.data.providers?.length).toBe(1)

        catalogTier = "pro"
        const refreshResult = yield* runCli(["models", "list", "--refresh"], env)
        const proGet = yield* runCli(["models", "get", '{"slug":"o3-mini"}'], env)
        const proPayload = expectJson<{
          ok: boolean
          data: { providers?: ReadonlyArray<unknown> }
        }>(proGet.stdout)

        expect(refreshResult.exitCode).toBe(0)
        expect(proGet.exitCode).toBe(0)
        expect(proPayload.data.providers).toBeUndefined()
      }),
    )

    expect(requests).toEqual([
      "/language/models",
      "/language/models/o3-mini",
      "/language/models",
      "/language/models/o3-mini",
    ])
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

    expect(requests).toEqual(["/language/models"])
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

    expect(requests).toEqual(["/language/models"])
  })

  it("models stale-if-error does not rewrite stale data as a fresh snapshot", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    let requestCount = 0

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => {
          requestCount += 1

          return requestCount === 1
            ? { status: 200, body: enveloped(SAMPLE_LLM_MODELS) }
            : { status: 429, body: { error: "Rate limit exceeded" } }
        })
        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const firstResult = yield* runCli(["models", "list"], env)
        const initialStatusResult = yield* runCli(["models", "cache", "status"], env)
        const initialStatus = expectJson<{ ok: boolean; data: { path: string } }>(
          initialStatusResult.stdout,
        )
        const cacheFile = JSON.parse(readFileSync(initialStatus.data.path, "utf8")) as object
        writeFileSync(
          initialStatus.data.path,
          `${JSON.stringify(
            { ...cacheFile, cached_at: "2000-01-01T00:00:00.000Z" },
            null,
            2,
          )}\n`,
        )

        const staleResult = yield* runCli(
          ["models", "list", "--refresh", "--stale-if-error"],
          env,
        )
        const finalStatusResult = yield* runCli(["models", "cache", "status"], env)
        const finalStatus = expectJson<{
          ok: boolean
          data: {
            cached_at: string
            snapshot_count: number
            intelligence_index_version: number
          }
        }>(finalStatusResult.stdout)

        expect(firstResult.exitCode).toBe(0)
        expect(staleResult.exitCode).toBe(0)
        expect(finalStatus.data.cached_at).toBe("2000-01-01T00:00:00.000Z")
        expect(finalStatus.data.snapshot_count).toBe(1)
        expect(finalStatus.data.intelligence_index_version).toBe(4.1)
      }),
    )

    expect(requestCount).toBe(2)
  })

  it("models list invalidates the released V1 catalog cache schema", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    let requestCount = 0

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi(() => {
          requestCount += 1
          return { status: 200, body: enveloped(SAMPLE_LLM_MODELS) }
        })
        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const firstResult = yield* runCli(["models", "list"], env)
        const statusResult = yield* runCli(["models", "cache", "status"], env)
        const status = expectJson<{ ok: boolean; data: { path: string } }>(statusResult.stdout)
        const cacheFile = JSON.parse(readFileSync(status.data.path, "utf8")) as Record<
          string,
          unknown
        >
        writeFileSync(
          status.data.path,
          `${JSON.stringify(
            {
              ...cacheFile,
              schema_id: "model-analysis/artificial-analysis/llm-models-cache/v1",
            },
            null,
            2,
          )}\n`,
        )

        const secondResult = yield* runCli(["models", "list"], env)
        const rewritten = JSON.parse(readFileSync(status.data.path, "utf8")) as {
          schema_id: string
        }

        expect(firstResult.exitCode).toBe(0)
        expect(secondResult.exitCode).toBe(0)
        expect(rewritten.schema_id).toBe(
          "model-analysis/artificial-analysis/llm-models-cache/v2",
        )
      }),
    )

    expect(requestCount).toBe(2)
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
        tier: string
        data_shape: string
        prompt_type: string
        intelligence_index_version: number
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
    expect(payload.data.tier).toBe("pro")
    expect(payload.data.data_shape).toBe("full")
    expect(payload.data.prompt_type).toBe("long")
    expect(payload.data.intelligence_index_version).toBe(4.1)
  })

  it("media list maps all 11 V2 media families and falls back to their /free siblings", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const cases = [
      ["text-to-image", "/media/text-to-image/models", "categories"],
      ["image-editing", "/media/image-editing/models", "categories"],
      ["text-to-speech", "/media/text-to-speech/models", null],
      ["speech-to-speech", "/media/speech-to-speech/models", null],
      ["speech-to-text", "/media/speech-to-text/models", null],
      ["text-to-video", "/media/text-to-video/models", "categories"],
      ["image-to-video", "/media/image-to-video/models", "categories"],
      ["text-to-video-audio", "/media/text-to-video-audio/models", "categories"],
      ["image-to-video-audio", "/media/image-to-video-audio/models", "categories"],
      ["music-instrumental", "/media/music/instrumental/models", "genres"],
      ["music-vocals", "/media/music/with-vocals/models", "genres"],
    ] as const
    const requests: Array<{
      path: string
      includeCategories: string | null
      includeGenres: string | null
    }> = []

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            includeCategories: request.query.get("include_categories"),
            includeGenres: request.query.get("include_genres"),
          })

          if (!request.path.endsWith("/free")) {
            return {
              status: 403,
              body: { error: "Free keys must use the /free endpoint" },
            }
          }

          const identity = {
            id: "media-model",
            name: "Media Model",
            model_creator: { id: "creator", name: "Creator" },
          }
          const model = request.path.includes("speech-to-speech")
            ? {
                ...identity,
                slug: "media-model",
                bba_score: 0.7,
                fdb_score: 0.6,
                tau_voice_score: 0.5,
              }
            : request.path.includes("speech-to-text")
              ? { ...identity, aa_wer_index: 0.2 }
              : request.path.includes("/music/")
                ? { ...identity, elo: 1000, ci_95: 10 }
                : { ...identity, slug: "media-model", elo: 1000, ci_95: 10 }

          return {
            status: 200,
            body: { tier: "free", data: [model] },
          }
        })

        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        for (const [type] of cases) {
          const result = yield* runCli(["media", "list", JSON.stringify({ type })], env)
          expect(result.exitCode).toBe(0)
        }
      }),
    )

    expect(requests).toEqual(
      cases.flatMap(([, path, richQuery]) => [
        {
          path,
          includeCategories: richQuery === "categories" ? "true" : null,
          includeGenres: richQuery === "genres" ? "true" : null,
        },
        {
          path: `${path}/free`,
          includeCategories: null,
          includeGenres: null,
        },
      ]),
    )
  }, 15_000)

  it("media refresh detects an in-place Free-to-Pro upgrade and caches the full media shape", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<string> = []
    let upgraded = false

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push(request.path)

          if (request.path.endsWith("/free")) {
            return {
              status: 200,
              body: {
                tier: upgraded ? "pro" : "free",
                data: SAMPLE_MEDIA_MODELS.map(
                  ({ id, name, slug, model_creator, elo, ci_95 }) => ({
                    id,
                    name,
                    slug,
                    model_creator,
                    elo,
                    ci_95,
                  }),
                ),
              },
            }
          }

          if (!upgraded) {
            return {
              status: 403,
              body: { error: "Free keys must use the /free endpoint" },
            }
          }

          return { status: 200, body: { tier: "pro", data: SAMPLE_MEDIA_MODELS } }
        })
        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }
        const input = '{"type":"text-to-image","include_categories":true}'

        const freeResult = yield* runCli(["media", "list", input], env)
        expect(freeResult.exitCode).toBe(0)

        upgraded = true
        const proResult = yield* runCli(["media", "list", "--refresh", input], env)
        const proPayload = expectJson<{
          ok: boolean
          data: Array<{ categories?: ReadonlyArray<unknown> }>
        }>(proResult.stdout)
        const statusResult = yield* runCli(
          ["media", "cache", "status", '{"type":"text-to-image"}'],
          env,
        )
        const statusPayload = expectJson<{
          ok: boolean
          data: { tier: string; data_shape: string }
        }>(statusResult.stdout)

        expect(proResult.exitCode).toBe(0)
        expect(proPayload.data[0]?.categories?.length).toBe(2)
        expect(statusPayload.data.tier).toBe("pro")
        expect(statusPayload.data.data_shape).toBe("full")
      }),
    )

    expect(requests).toEqual([
      "/media/text-to-image/models",
      "/media/text-to-image/models/free",
      "/media/text-to-image/models/free",
      "/media/text-to-image/models",
    ])
  })

  it("media list projects paid music genres only when requested while reusing the rich cache", async () => {
    const cacheDir = mkdtempSync(resolve(tmpdir(), "model-analysis-cache-"))
    const requests: Array<{ path: string; includeGenres: string | null }> = []
    const musicModels = [
      {
        id: "music-model",
        name: "Music Model",
        model_creator: { id: "creator", name: "Creator" },
        elo: 1100,
        ci_95: 12,
        samples: 50,
        genres: [{ label: "Electronic", elo: 1110, ci_95: 15, samples: 20 }],
      },
    ]

    await runScopedEffect(
      Effect.gen(function* () {
        const api = yield* startMockApi((request) => {
          requests.push({
            path: request.path,
            includeGenres: request.query.get("include_genres"),
          })

          return {
            status: 200,
            body: { tier: "pro", data: musicModels },
          }
        })
        const env = {
          ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
          ARTIFICIAL_ANALYSIS_BASE_URL: api.baseUrl,
          MODEL_ANALYSIS_CACHE_DIR: cacheDir,
        }

        const strippedResult = yield* runCli(
          ["media", "list", '{"type":"music-instrumental"}'],
          env,
        )
        const fullResult = yield* runCli(
          ["media", "list", '{"type":"music-instrumental","include_genres":true}'],
          env,
        )
        const strippedPayload = expectJson<{
          ok: boolean
          data: Array<{ genres?: unknown }>
        }>(strippedResult.stdout)
        const fullPayload = expectJson<{
          ok: boolean
          data: Array<{ genres?: ReadonlyArray<unknown> }>
        }>(fullResult.stdout)

        expect(strippedResult.exitCode).toBe(0)
        expect(fullResult.exitCode).toBe(0)
        expect(strippedPayload.data[0]?.genres).toBeUndefined()
        expect(fullPayload.data[0]?.genres?.length).toBe(1)
      }),
    )

    expect(requests).toEqual([
      {
        path: "/media/music/instrumental/models",
        includeGenres: "true",
      },
    ])
  })

  it("media list rejects category and genre projections for unsupported families", async () => {
    const categoryResult = await runEffect(
      runCli(["media", "list", '{"type":"speech-to-text","include_categories":true}'], {
        ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
      }),
    )
    const genreResult = await runEffect(
      runCli(["media", "list", '{"type":"text-to-image","include_genres":true}'], {
        ARTIFICIAL_ANALYSIS_API_KEY: "test-key",
      }),
    )
    const categoryPayload = expectJson<{
      ok: boolean
      error: { type: string; details?: { field?: string } }
    }>(categoryResult.stderr)
    const genrePayload = expectJson<{
      ok: boolean
      error: { type: string; details?: { field?: string } }
    }>(genreResult.stderr)

    expect(categoryResult.exitCode).toBe(1)
    expect(categoryPayload.error.type).toBe("CommandInputError")
    expect(categoryPayload.error.details?.field).toBe("include_categories")
    expect(genreResult.exitCode).toBe(1)
    expect(genrePayload.error.type).toBe("CommandInputError")
    expect(genrePayload.error.details?.field).toBe("include_genres")
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
            body: {
              tier: "pro",
              data: SAMPLE_MEDIA_MODELS,
            },
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
        path: "/media/text-to-image/models",
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
            body: {
              tier: "pro",
              data: SAMPLE_MEDIA_MODELS,
            },
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
        path: "/media/text-to-image/models",
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
            body: {
              tier: "pro",
              data: SAMPLE_MEDIA_MODELS,
            },
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
        const refreshedStatusResult = yield* runCli(
          ["media", "cache", "status", '{"type":"text-to-video"}'],
          env,
        )
        const refreshedStatusPayload = expectJson<{
          ok: boolean
          data: { cached_at: string; snapshot_count: number }
        }>(refreshedStatusResult.stdout)

        expect(listResult.exitCode).toBe(0)
        expect(statusResult.exitCode).toBe(0)
        expect(refreshedResult.exitCode).toBe(0)
        expect(refreshedStatusResult.exitCode).toBe(0)
        expect(refreshedPayload.data.map((model) => model.slug)).toEqual(["flux-1-pro", "gpt-image-1"])
        expect(refreshedStatusPayload.data.cached_at).toBe("2000-01-01T00:00:00.000Z")
        expect(refreshedStatusPayload.data.snapshot_count).toBe(1)
      }),
    )

    expect(requests).toEqual([
      {
        path: "/media/text-to-video/models",
        includeCategories: "true",
      },
      {
        path: "/media/text-to-video/models",
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
            body: {
              tier: "pro",
              data: SAMPLE_MEDIA_MODELS,
            },
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
        path: "/media/image-to-video/models",
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
          headers: {
            "retry-after": "3600",
            "x-aa-tier": "free",
            "x-ratelimit-limit": "100",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1786706000",
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
        details?: {
          status?: number
          retry_after_seconds?: number
          rate_limit?: { limit?: number; remaining?: number; reset?: number; tier?: string }
        }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("models list")
    expect(payload.error.type).toBe("ApiResponseError")
    expect(payload.error.message).toBe("Rate limit exceeded")
    expect(payload.error.details?.status).toBe(429)
    expect(payload.error.details?.retry_after_seconds).toBe(3600)
    expect(payload.error.details?.rate_limit).toEqual({
      limit: 100,
      remaining: 0,
      reset: 1786706000,
      tier: "free",
    })
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
        path: "/language/models",
        reason: "ConnectionRefused",
        message: "Connection refused",
      }),
    )

    expect(details.type).toBe("ApiRequestError")
    expect(details.details).toEqual({
      method: "POST",
      path: "/language/models",
      reason: "ConnectionRefused",
    })
  })

  it("formats ApiResponseError", async () => {
    const details = toErrorDetails(
      new ApiResponseError({
        method: "GET",
        path: "/media/text-to-image/models",
        status: 422,
        message: "Validation failed",
        body: { errors: ["invalid"] },
      }),
    )

    expect(details.type).toBe("ApiResponseError")
    expect(details.details).toEqual({
      method: "GET",
      path: "/media/text-to-image/models",
      status: 422,
      body: { errors: ["invalid"] },
    })
  })

  it("formats ApiDecodeError", async () => {
    const details = toErrorDetails(
      new ApiDecodeError({
        method: "GET",
        path: "/language/models",
        message: "Unexpected end of JSON input",
      }),
    )

    expect(details.type).toBe("ApiDecodeError")
    expect(details.details).toEqual({
      method: "GET",
      path: "/language/models",
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
