import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform"
import { Effect, Schema } from "effect"

import { ApiDecodeError, ApiRequestError, ApiResponseError } from "./errors"
import { decodeUnknownJsonText } from "./json"

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

export interface RequestSpec<A, I, R, B = A> {
  readonly method: HttpMethod
  readonly path: string
  readonly query?: Record<string, string | undefined>
  readonly body?: unknown
  readonly responseSchema: Schema.Schema<A, I, R>
  readonly selectData?: (response: A) => B
}

export interface RawRequestSpec {
  readonly method: HttpMethod
  readonly path: string
  readonly query?: Record<string, string | undefined>
  readonly body?: unknown
}

const compactQuery = (query: Record<string, string | undefined> | undefined) => {
  if (!query) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

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

export const requestJson = <A, I, R, B = A>(spec: RequestSpec<A, I, R, B>) =>
  Effect.flatMap(HttpClient.HttpClient, (client) => requestJsonWith(client, spec))

export const requestJsonWith = <A, I, R, B = A>(
  client: HttpClient.HttpClient,
  spec: RequestSpec<A, I, R, B>,
) =>
  Effect.gen(function* () {
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

    if (responseText.trim().length === 0) {
      return yield* Effect.fail(
        new ApiDecodeError({
          method: spec.method,
          path: spec.path,
          message: "API returned an empty response body",
        }),
      )
    }

    const decoded = yield* Schema.decodeUnknown(Schema.parseJson(spec.responseSchema))(responseText).pipe(
      Effect.mapError(
        (error) =>
          new ApiDecodeError({
            method: spec.method,
            path: spec.path,
            message: error.message,
          }),
      ),
    )

    return (spec.selectData ? spec.selectData(decoded) : decoded) as B
  })

export const requestNoContent = (spec: RawRequestSpec) =>
  Effect.flatMap(HttpClient.HttpClient, (client) => requestNoContentWith(client, spec))

export const requestNoContentWith = (
  client: HttpClient.HttpClient,
  spec: RawRequestSpec,
) =>
  Effect.gen(function* () {
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

export const AppLayer = FetchHttpClient.layer
