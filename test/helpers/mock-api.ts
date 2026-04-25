import { createServer } from "node:http"

import { Effect } from "effect"

export interface MockApiRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Record<string, string | string[] | undefined>
}

export interface MockApiResponse {
  readonly status: number
  readonly body?: unknown
  readonly text?: string
  readonly headers?: Record<string, string>
}

export interface MockApiServer {
  readonly baseUrl: string
}

export const startMockApi = (
  handler: (request: MockApiRequest) => MockApiResponse | Promise<MockApiResponse>,
) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1")
        const reply = await handler({
          method: request.method ?? "GET",
          path: url.pathname,
          query: url.searchParams,
          headers: request.headers,
        })

        response.statusCode = reply.status

        for (const [name, value] of Object.entries(reply.headers ?? {})) {
          response.setHeader(name, value)
        }

        if (reply.body !== undefined) {
          if (!response.hasHeader("content-type")) {
            response.setHeader("content-type", "application/json")
          }

          response.end(JSON.stringify(reply.body))
          return
        }

        if (reply.text !== undefined) {
          response.end(reply.text)
          return
        }

        response.end()
      })

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening)
          reject(error)
        }

        const onListening = () => {
          server.off("error", onError)
          resolve()
        }

        server.once("error", onError)
        server.listen(0, "127.0.0.1", onListening)
      })

      const address = server.address()

      if (address === null || typeof address === "string") {
        throw new Error("Failed to bind mock API server")
      }

      return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        server,
      }
    }),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error)
                return
              }

              resolve()
            })
          }),
      ),
  ).pipe(Effect.map(({ baseUrl }) => ({ baseUrl } satisfies MockApiServer)))
