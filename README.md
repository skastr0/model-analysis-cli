# @skastr0/agentic-cli

A **generic CLI template** for building agent-first command-line tools.

## Philosophy

Traditional CLIs are too blunt for sophisticated AI agents. They force agents to perform tedious string-munging of flags and parameters, and lack the composability agents need for multi-step orchestration.

This template encodes an opinionated alternative: a CLI built on **Effect** for robust error handling, concurrency, and resource management; **JSON-first** for rich structured inputs; and **batch-native** so agents can perform complex work in a single invocation instead of chaining brittle tool calls.

## Key Features

- **Effect-based**: Typed errors, interruptibility, parallel execution, structured logging
- **JSON-first input**: Agents pass JSON objects — no flag-parsing, no string-munging
- **Batch-native**: Create/update/delete multiple resources in one call with configurable concurrency
- **Structured output**: Every command returns a deterministic JSON envelope (`{ ok, command, data }` or `{ ok, command, error }`)
- **Domain-driven errors**: `Schema.TaggedError` with rich structured details for agent recovery
- **Cross-platform compilation**: Bun compile for static binary distribution

## Getting Started

```bash
# Install dependencies
bun install

# Run in development
bun run dev auth status

# Run tests
bun test

# Build cross-platform binaries
bun run build

# Install locally
bun run install:local
```

## Project Structure

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
    items.ts          # Example command with batch mutation support
    auth.ts           # Authentication status command
scripts/
  build.ts            # Cross-platform binary compilation
  install.ts          # Local binary installation
test/
  helpers/cli.ts      # runCli helper and expectJson utility
  cli.test.ts         # Foundation tests for auth, batch, error handling
```

## Adding a New Command

1. Define input schema with `Schema.Struct` in `commands/<name>.ts`
2. Define validation effect returning `Effect.Effect<void, CommandInputError>`
3. Build mutation effect using functions from `core/api.ts`
4. Wrap with `executeJsonCommand` and register as subcommand in `cli.ts`
5. Add tests using the `runCli` helper

See `src/commands/items.ts` for a complete example with batch mutation support.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENTIC_API_KEY` | Yes* | — | API authentication key |
| `AGENTIC_API_BASE_URL` | No | `https://api.example.com/v1` | API base URL |

*Replace with your domain's API key variable name.

## License

MIT
