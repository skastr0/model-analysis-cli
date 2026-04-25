import { Schema } from "effect"

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class MissingApiKeyError extends Schema.TaggedError<MissingApiKeyError>()(
  "MissingApiKeyError",
  {
    envVar: Schema.String,
    hint: Schema.String,
  },
) {}

export class JsonInputError extends Schema.TaggedError<JsonInputError>()(
  "JsonInputError",
  {
    source: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class CommandInputError extends Schema.TaggedError<CommandInputError>()(
  "CommandInputError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class ModelNotFoundError extends Schema.TaggedError<ModelNotFoundError>()(
  "ModelNotFoundError",
  {
    identifier: Schema.String,
    message: Schema.String,
  },
) {}

export class ModelsNotFoundError extends Schema.TaggedError<ModelsNotFoundError>()(
  "ModelsNotFoundError",
  {
    identifiers: Schema.Array(Schema.String),
    message: Schema.String,
  },
) {}

export class ApiRequestError extends Schema.TaggedError<ApiRequestError>()(
  "ApiRequestError",
  {
    method: Schema.String,
    path: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class ApiResponseError extends Schema.TaggedError<ApiResponseError>()(
  "ApiResponseError",
  {
    method: Schema.String,
    path: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    body: Schema.NullishOr(Schema.Unknown),
  },
) {}

export class ApiDecodeError extends Schema.TaggedError<ApiDecodeError>()(
  "ApiDecodeError",
  {
    method: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class CacheReadError extends Schema.TaggedError<CacheReadError>()(
  "CacheReadError",
  {
    path: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class CacheWriteError extends Schema.TaggedError<CacheWriteError>()(
  "CacheWriteError",
  {
    path: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class CacheRemoveError extends Schema.TaggedError<CacheRemoveError>()(
  "CacheRemoveError",
  {
    path: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export type AppError =
  | ConfigurationError
  | MissingApiKeyError
  | JsonInputError
  | CommandInputError
  | ModelNotFoundError
  | ModelsNotFoundError
  | ApiRequestError
  | ApiResponseError
  | ApiDecodeError
  | CacheReadError
  | CacheWriteError
  | CacheRemoveError
