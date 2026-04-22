# @skastr0/agentic-cli - Agent Guide

## Project Intent

This is a **generic CLI template** for building agent-first command-line tools. The core thesis: traditional CLIs are too blunt for sophisticated AI agents. They force agents to perform tedious string-munging of flags and parameters, and they lack the composability that agents need to orchestrate multi-step workflows.

This template encodes an opinionated alternative: a CLI that is **built on Effect** for robust error handling, concurrency, and resource management; **JSON-first** for rich structured inputs; and **batch-native** so agents can perform complex work in a single invocation instead of chaining many brittle tool calls.

Success criteria: any agent should be able to perform complex, typed, validated, parallelizable operations through this CLI with minimal ceremony and maximum observability.

## Agentic-First Focus

This CLI is designed for AI agents as primary consumers. Every design decision prioritizes agent ergonomics over human convenience:

- **Structured I/O**: Agents consume and produce JSON. No text parsing, no regex scraping.
- **Single-shot operations**: A single invocation can create, update, and delete multiple resources.
- **Deterministic errors**: Every failure path returns the same structured envelope shape with typed error codes.
- **Composable commands**: Commands are pure functions over JSON — they can be pre-built, batched, and retried without side-effects on the CLI process itself.
- **Parallelizable by design**: Concurrency is a parameter, not a shell script.

When adding features, ask: "Can an agent use this without understanding shell quoting, flag ordering, or exit-code semantics?" If the answer is no, reconsider the interface.

## Stack and Tooling Constraints

- **Runtime**: Bun. All package operations use `bun` (never npm).
- **Effect stack**: `effect`, `@effect/cli`, `@effect/platform`, `@effect/platform-bun`.
- **TypeScript**: Strictest settings (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- **Testing**: `bun:test` or `@effect/vitest`.
- **Build**: Bun compile for cross-platform static binary distribution.

## Core Concepts

### 1. Effect as the Foundation

Every operation returns `Effect.Effect`. This is non-negotiable. It gives the CLI:
- **Typed errors**: Domain errors are `Schema.TaggedError` instances, never bare strings or thrown exceptions.
- **Interruptibility**: Long-running or batch operations can be safely interrupted.
- **Parallelism**: `Effect.forEach` with `concurrency` makes batch operations trivial.
- **Observability**: `Effect.fn` names create automatic spans. `Effect.log*` produces structured logs.

Guideline: if you are writing a function that does IO, parsing, or business logic, it must return `Effect.Effect`. Wrap imperative APIs with `Effect.tryPromise` or `Effect.sync`.

### 2. JSON-First Input

Agents should pass JSON objects, not `--flag` strings. The template provides a `loadJsonInput` utility that accepts:
- Inline JSON: `'{"key": "value"}'`
- File reference: `@path/to/file.json`
- Stdin: `-` or `@-`

Each command defines an input Schema. The CLI decodes and validates the JSON against that schema before executing any business logic. This means agents get immediate, structured feedback on malformed inputs rather than cryptic CLI parsing errors.

Guideline: every mutation command should accept a single JSON object. Every batch command should accept an array of JSON objects and homogenize single objects into single-element arrays automatically.

### 3. Batch and Parallel by Default

Agents prefer to create 10 drafts in one call rather than 10 separate calls. The template provides a `runMutationBatch` utility that:
- Accepts either a single object or an array
- Validates each item against the command's input schema
- Runs mutations in parallel with a configurable concurrency limit
- Returns a summary envelope with per-item success/failure results
- Sets exit code to 1 if any item fails, but always returns the full result set

Guideline: any command that makes a state change should support batch input and parallel execution. Use `Effect.forEach(..., { concurrency })` never `for` loops.

### 4. Structured Output Envelopes

All output is JSON. There is no free-form text to stdout. The envelope shape is:

```typescript
// Success
{ ok: true, command: "drafts create", data: { ... } }

// Failure
{ ok: false, command: "drafts create", error: { type: "ValidationError", message: "...", details: { ... } } }
```

This means agents can always parse the output deterministically. The `output.ts` module centralizes all envelope rendering.

Guideline: commands should never write raw objects or strings to stdout. Always use `executeJsonCommand(commandName, effect)`.

### 5. Domain-Driven Errors

Errors are part of the domain, not afterthoughts. Each error is a `Schema.TaggedError` with:
- A `_tag` for discrimination
- Structured details relevant to the error type
- Human-readable messages

This enables precise error handling with `Effect.catchTag`, and rich error envelopes for agents.

Guideline: add a new tagged error class for each distinct failure mode. Never throw bare `Error` or use `Effect.die` for recoverable errors.

### 6. Single Environment Layer Provision

The CLI assembles all service layers into a single `Layer` via `Layer.mergeAll(BunContext.layer, AppLayer)` and provides it once at the top level of command execution. This ensures a single, consistent dependency injection context for the entire CLI run.

Guideline: never call `Effect.provide(AppLayer)` more than once per command execution. The layer is the single source of truth for dependency injection.

## Architecture Guidelines

### Directory Layout

```
src/
  cli.ts              # Entry point: command tree assembly, error envelope catch-all
  core/
    constants.ts      # CLI name, version, env var names, defaults
    errors.ts         # All Schema.TaggedError definitions
    config.ts         # Env/config loading with validation via Effect
    json.ts           # loadJsonInput: stdin, @file, inline JSON decoding
    output.ts         # Envelope writers, executeJsonCommand combinator
    api.ts            # App-specific HTTP client, request builders, response schemas
  commands/
    example.ts        # Concrete command: input schema, validation, mutation, batch
```

### Adding a New Command

1. Define input schema(s) with `Schema.Struct` in `commands/<name>.ts`
2. Define validation effect(s) that return `Effect.Effect<void, CommandInputError>`
3. Build the mutation effect using functions from `core/api.ts`
4. Wrap with `executeJsonCommand` and register as a subcommand in `cli.ts`
5. Add tests using the `runCli` helper

### Input Schema Conventions

- Use `snake_case` keys in JSON inputs (agent-friendly convention)
- Use `Schema.optional` for truly optional fields
- Use `Schema.NullOr` when the API accepts explicit `null` to clear a field
- Coerce and validate in a separate `validate*` effect, not in the schema itself

### Batch Command Pattern

```typescript
const runMutationBatch = <A, I, R, S>(options: {
  readonly input: string
  readonly concurrency: number
  readonly itemSchema: Schema.Schema<A, I, R>
  readonly validate: (item: A) => Effect.Effect<void, CommandInputError>
  readonly run: (item: A) => Effect.Effect<S, unknown, R>
  readonly toSuccess: (item: A, result: S, index: number) => BatchResultItem
}) => Effect.gen(function* () {
  const rawItems = yield* loadBatchJsonInput(options.input)
  const results = yield* Effect.forEach(rawItems, (raw, index) =>
    Effect.gen(function* () {
      const item = yield* decodeBatchItem(options.itemSchema, raw, index)
      yield* options.validate(item)
      const result = yield* options.run(item)
      return options.toSuccess(item, result, index)
    }).pipe(Effect.catchAll((error) => Effect.succeed({ index, ok: false, error: toErrorDetails(error) })))
  , { concurrency: options.concurrency })

  return summarizeBatchResults(options.concurrency, results)
})
```

This pattern is the canonical way to implement agent-friendly batch operations.

### HTTP Client Pattern

The API module exposes a `requestJson` helper that:
- Builds `HttpClientRequest` from a method/path/body spec
- Executes with the configured base client (auth headers, base URL, user-agent)
- Handles non-2xx status codes with structured `ApiError`
- Decodes JSON responses through Schema

Commands never touch the HTTP client directly. They call domain functions like `createDraft(params)` which internally use `requestJson`.

## Anti-Patterns to Avoid

❌ **Do not use bare `throw` or `try-catch` in Effect contexts.**
- Use `Effect.tryPromise` with `catch` mapping to tagged errors.
- Use `Effect.fail` for domain errors.
- Use `Effect.catchAll` and `Effect.catchTag` for recovery.

❌ **Do not write unstructured text to stdout.**
- Always write JSON envelopes.
- Use `executeJsonCommand` to wrap every command effect.

❌ **Do not create multiple `Effect.provide(AppLayer)` calls per invocation.**
- Assemble the full layer once via `Layer.mergeAll`.
- Provide it at the top level of the command execution pipeline.

❌ **Do not make agents parse `--flag` strings or positional args for complex inputs.**
- Complex inputs go through JSON.
- Flags are reserved for truly global/simple options (e.g., `--concurrency`).

❌ **Do not mutate shared state outside of Effect.**
- All state lives in Effect's execution model.
- Configuration comes from `Bun.env` read inside `Effect` via `config.ts`.

❌ **Do not use `Effect.die` for recoverable errors.**
- `Effect.die` creates defects that bypass error handling.
- Reserve for programmer invariants that must never happen.

❌ **Do not forget concurrency limits.**
- `Effect.forEach` without a `concurrency` option runs everything in parallel.
- Always bound concurrency for network or resource-limited operations.

❌ **Do not skip input validation.**
- Decode JSON through Schema first.
- Then run domain validation effects (date ranges, positive integers, etc.).
- Never trust input shape even after Schema parsing.
