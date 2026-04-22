import { FileSystem } from "@effect/platform"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  ApiDecodeError,
  ApiRequestError,
  ApiResponseError,
  CommandInputError,
  ConfigurationError,
  JsonInputError,
  MissingApiKeyError,
} from "../src/core/errors"
import { loadBatchJsonInput } from "../src/core/json"
import { toErrorDetails } from "../src/core/output"
import { expectJson, runCli } from "./helpers/cli"

describe("agentic CLI foundation", () => {
  it.effect("auth status reports missing API key without failing", () =>
    Effect.gen(function* () {
      const result = yield* runCli(["auth", "status"], {
        AGENTIC_API_KEY: undefined,
        AGENTIC_API_BASE_URL: undefined,
      })

      const payload = expectJson<{
        ok: boolean
        command: string
        data: { configured: boolean; authenticated: boolean }
      }>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("auth status")
      expect(payload.data.configured).toBe(false)
      expect(payload.data.authenticated).toBe(false)
    }),
  )

  it.effect("items create accepts a single JSON object", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        ["items", "create", '{"name": "Test Item", "tags": ["demo"]}'],
        {
          AGENTIC_API_KEY: "test-key",
          AGENTIC_API_BASE_URL: "http://localhost:9999/v1",
        },
      )

      const payload = expectJson<{
        ok: boolean
        command: string
        data: {
          total: number
          success_count: number
          error_count: number
          concurrency: number
          results: Array<{
            index: number
            ok: boolean
            data?: { id: string; name: string }
            error?: unknown
          }>
        }
      }>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(result.stderr.trim()).toBe("")
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("items create")
      expect(payload.data.total).toBe(1)
      expect(payload.data.success_count).toBe(1)
      expect(payload.data.error_count).toBe(0)
      expect(payload.data.results[0]?.data?.name).toBe("Test Item")
    }),
  )

  it.effect("items create accepts an array of JSON objects", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        [
          "items",
          "create",
          '[{"name": "Item 1"}, {"name": "Item 2"}, {"name": ""}]',
        ],
        {
          AGENTIC_API_KEY: "test-key",
        },
      )

      const payload = expectJson<{
        ok: boolean
        command: string
        data: {
          total: number
          success_count: number
          error_count: number
          concurrency: number
          results: Array<{ index: number; ok: boolean }>
        }
      }>(result.stdout)

      expect(result.exitCode).toBe(1)
      expect(payload.ok).toBe(true)
      expect(payload.command).toBe("items create")
      expect(payload.data.total).toBe(3)
      // Third item has empty name -> error
      expect(payload.data.error_count).toBe(1)
      expect(payload.data.success_count).toBe(2)
    }),
  )

  it.effect("returns structured error for invalid JSON input", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        ["items", "create", "not-valid-json"],
        {
          AGENTIC_API_KEY: "test-key",
        },
      )

      const payload = expectJson<{
        ok: boolean
        command: string
        error: {
          type: string
          message: string
          details?: { source?: string; reason?: string }
        }
      }>(result.stderr)

      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe("")
      expect(payload.ok).toBe(false)
      expect(payload.command).toBe("items create")
      expect(payload.error.type).toBe("JsonInputError")
      expect(payload.error.details?.source).toBe("inline")
      expect(payload.error.details?.reason).toBe("InvalidJson")
    }),
  )

  it.effect("accepts JSON via stdin", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        ["items", "create", "-"],
        {
          AGENTIC_API_KEY: "test-key",
        },
        {
          stdinText: '{"name": "From Stdin"}',
        },
      )

      const payload = expectJson<{
        ok: boolean
        data: { total: number; success_count: number }
      }>(result.stdout)

      expect(result.exitCode).toBe(0)
      expect(payload.ok).toBe(true)
      expect(payload.data.total).toBe(1)
      expect(payload.data.success_count).toBe(1)
    }),
  )
})

describe("toErrorDetails", () => {
  it.effect("formats ConfigurationError", () =>
    Effect.gen(function* () {
      const error = new ConfigurationError({
        field: "AGENTIC_API_BASE_URL",
        message: "Invalid URL",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ConfigurationError")
      expect(details.message).toBe("Invalid URL")
      expect(details.details).toEqual({ field: "AGENTIC_API_BASE_URL" })
    }),
  )

  it.effect("formats MissingApiKeyError", () =>
    Effect.gen(function* () {
      const error = new MissingApiKeyError({
        envVar: "AGENTIC_API_KEY",
        hint: "Set your API key",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("MissingApiKeyError")
      expect(details.message).toBe("AGENTIC_API_KEY is not configured")
      expect(details.details).toEqual({
        env_var: "AGENTIC_API_KEY",
        hint: "Set your API key",
      })
    }),
  )

  it.effect("formats JsonInputError", () =>
    Effect.gen(function* () {
      const error = new JsonInputError({
        source: "inline",
        reason: "InvalidJson",
        message: "Unexpected token",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("JsonInputError")
      expect(details.details).toEqual({
        source: "inline",
        reason: "InvalidJson",
      })
    }),
  )

  it.effect("formats CommandInputError", () =>
    Effect.gen(function* () {
      const error = new CommandInputError({
        field: "name",
        message: "name must not be empty",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("CommandInputError")
      expect(details.details).toEqual({ field: "name" })
    }),
  )

  it.effect("formats ApiRequestError", () =>
    Effect.gen(function* () {
      const error = new ApiRequestError({
        method: "POST",
        path: "/items",
        reason: "ConnectionRefused",
        message: "Connection refused",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ApiRequestError")
      expect(details.details).toEqual({
        method: "POST",
        path: "/items",
        reason: "ConnectionRefused",
      })
    }),
  )

  it.effect("formats ApiResponseError", () =>
    Effect.gen(function* () {
      const error = new ApiResponseError({
        method: "POST",
        path: "/items",
        status: 422,
        message: "Validation failed",
        body: { errors: ["invalid"] },
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ApiResponseError")
      expect(details.details).toEqual({
        method: "POST",
        path: "/items",
        status: 422,
        body: { errors: ["invalid"] },
      })
    }),
  )

  it.effect("formats ApiDecodeError", () =>
    Effect.gen(function* () {
      const error = new ApiDecodeError({
        method: "GET",
        path: "/items",
        message: "Unexpected end of JSON input",
      })
      const details = toErrorDetails(error)
      expect(details.type).toBe("ApiDecodeError")
      expect(details.details).toEqual({
        method: "GET",
        path: "/items",
      })
    }),
  )

  it.effect("falls back to Error for untagged errors", () =>
    Effect.gen(function* () {
      const details = toErrorDetails(new Error("something went wrong"))
      expect(details.type).toBe("Error")
      expect(details.message).toBe("something went wrong")
    }),
  )

  it.effect("falls back for unknown values", () =>
    Effect.gen(function* () {
      const details = toErrorDetails("plain string")
      expect(details.type).toBe("Error")
      expect(details.message).toBe("plain string")
    }),
  )
})

describe("loadBatchJsonInput", () => {
  it.effect("wraps a single object in an array", () =>
    Effect.gen(function* () {
      const result = yield* loadBatchJsonInput('{"name": "test"}').pipe(
        Effect.provide(FileSystem.layerNoop({})),
      )
      expect(result).toEqual([{ name: "test" }])
    }),
  )

  it.effect("preserves an array as-is", () =>
    Effect.gen(function* () {
      const result = yield* loadBatchJsonInput('[{"name": "a"}, {"name": "b"}]').pipe(
        Effect.provide(FileSystem.layerNoop({})),
      )
      expect(result).toEqual([{ name: "a" }, { name: "b" }])
    }),
  )

  it.effect("fails for non-object input", () =>
    Effect.gen(function* () {
      const exit = yield* loadBatchJsonInput("123").pipe(
        Effect.provide(FileSystem.layerNoop({})),
        Effect.exit,
      )
      expect(exit._tag).toBe("Failure")
    }),
  )
})
