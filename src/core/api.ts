import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { Effect, Schema } from "effect"

import { loadAppConfig, requireApiKey } from "./config"
import { USER_AGENT } from "./constants"
import { ApiDecodeError, ApiRequestError, ApiResponseError } from "./errors"
import { decodeUnknownJsonText } from "./json"

export const IdentifierSchema = Schema.Union(Schema.Number, Schema.String)

export type Identifier = typeof IdentifierSchema.Type

export interface AuthStatus {
  readonly configured: boolean
  readonly authenticated: boolean
  readonly api_base_url: string
  readonly status: number | null
  readonly error?: string
  readonly details?: unknown
}

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

interface RequestSpec<A, I, R> {
  readonly method: HttpMethod
  readonly path: string
  readonly query?: Record<string, string | undefined>
  readonly body?: unknown
  readonly responseSchema: Schema.Schema<A, I, R>
}

type RawRequestSpec = Omit<RequestSpec<unknown, unknown, never>, "responseSchema">

const toRawRequestSpec = (spec: {
  readonly method: HttpMethod
  readonly path: string
  readonly query?: Record<string, string | undefined>
  readonly body?: unknown
}): RawRequestSpec => ({
  method: spec.method,
  path: spec.path,
  ...(spec.query !== undefined ? { query: spec.query } : {}),
  ...(spec.body !== undefined ? { body: spec.body } : {}),
})

const compactQuery = (query: Record<string, string | undefined> | undefined) => {
  if (!query) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

const baseClient = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const config = yield* loadAppConfig()
  const apiKey = yield* requireApiKey()

  return client.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(config.apiBaseUrl),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(apiKey),
        HttpClientRequest.setHeader("user-agent", USER_AGENT),
      ),
    ),
  )
})

const buildRequest = (spec: RawRequestSpec) => {
  const query = compactQuery(spec.query)

  switch (spec.method) {
    case "GET":
      return HttpClientRequest.get(spec.path, { urlParams: query })
    case "POST": {
      const request = HttpClientRequest.post(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
    case "PATCH": {
      const request = HttpClientRequest.patch(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
    case "PUT": {
      const request = HttpClientRequest.put(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
    case "DELETE": {
      const request = HttpClientRequest.del(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
  }
}

const parseResponseBody = (text: string) =>
  text.trim().length === 0
    ? Effect.succeed<unknown | undefined>(undefined)
    : decodeUnknownJsonText(text, "api-response").pipe(
        Effect.catchAll(() => Effect.succeed<unknown>(text)),
      )

const extractApiMessage = (status: number, body: unknown) => {
  if (typeof body === "string" && body.trim().length > 0) {
    return body
  }

  if (body && typeof body === "object") {
    if ("error" in body) {
      const errorValue = body.error

      if (typeof errorValue === "string" && errorValue.trim().length > 0) {
        return errorValue
      }

      if (
        errorValue &&
        typeof errorValue === "object" &&
        "message" in errorValue &&
        typeof errorValue.message === "string" &&
        errorValue.message.trim().length > 0
      ) {
        return errorValue.message
      }
    }

    if ("message" in body && typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message
    }
  }

  return `API request failed with status ${status}`
}

export const requestJson = <A, I, R>(spec: RequestSpec<A, I, R>) =>
  Effect.gen(function* () {
    const client = yield* baseClient
    const request = buildRequest(toRawRequestSpec(spec))

    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (error) =>
          new ApiRequestError({
            method: spec.method,
            path: spec.path,
            reason: error._tag === "RequestError" ? error.reason : error._tag,
            message: error.message,
          }),
      ),
    )

    const responseText = yield* response.text.pipe(
      Effect.mapError(
        (error) =>
          new ApiRequestError({
            method: spec.method,
            path: spec.path,
            reason: error.reason,
            message: error.message,
          }),
      ),
    )

    if (response.status < 200 || response.status >= 300) {
      const body = yield* parseResponseBody(responseText)

      return yield* Effect.fail(
        new ApiResponseError({
          method: spec.method,
          path: spec.path,
          status: response.status,
          message: extractApiMessage(response.status, body),
          body,
        }),
      )
    }

    if (responseText.trim().length === 0) {
      return yield* Effect.fail(
        new ApiDecodeError({
          method: spec.method,
          path: spec.path,
          message: "API returned an empty response body",
        }),
      )
    }

    return yield* Schema.decodeUnknown(Schema.parseJson(spec.responseSchema))(responseText).pipe(
      Effect.mapError(
        (error) =>
          new ApiDecodeError({
            method: spec.method,
            path: spec.path,
            message: error.message,
          }),
      ),
    )
  })

export const requestNoContent = (spec: RawRequestSpec) =>
  Effect.gen(function* () {
    const client = yield* baseClient
    const request = buildRequest(spec)

    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (error) =>
          new ApiRequestError({
            method: spec.method,
            path: spec.path,
            reason: error._tag === "RequestError" ? error.reason : error._tag,
            message: error.message,
          }),
      ),
    )

    const responseText = yield* response.text.pipe(
      Effect.mapError(
        (error) =>
          new ApiRequestError({
            method: spec.method,
            path: spec.path,
            reason: error.reason,
            message: error.message,
          }),
      ),
    )

    if (response.status < 200 || response.status >= 300) {
      const body = yield* parseResponseBody(responseText)

      return yield* Effect.fail(
        new ApiResponseError({
          method: spec.method,
          path: spec.path,
          status: response.status,
          message: extractApiMessage(response.status, body),
          body,
        }),
      )
    }
  })

// TODO: Replace with actual API health check or /me endpoint
export const getAuthStatus = Effect.gen(function* () {
  const config = yield* loadAppConfig()

  if (!config.apiKey) {
    return {
      configured: false,
      authenticated: false,
      api_base_url: config.apiBaseUrl,
      status: null,
      error: "API key is not configured",
    } satisfies AuthStatus
  }

  return {
    configured: true,
    authenticated: true,
    api_base_url: config.apiBaseUrl,
    status: 200,
  } satisfies AuthStatus
})

export const AppLayer = FetchHttpClient.layer
