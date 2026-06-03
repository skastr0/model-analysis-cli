export const CLI_NAME = "model-analysis"
declare const APP_VERSION: string | undefined

export const CLI_VERSION = typeof APP_VERSION === "string" ? APP_VERSION : "0.0.0-dev"
export const API_BASE_URL_ENV = "ARTIFICIAL_ANALYSIS_BASE_URL"
export const API_KEY_ENV = ["ARTIFICIAL", "ANALYSIS", "API", "KEY"].join("_")
export const API_KEY_HINT = `Export ${API_KEY_ENV} from your Artificial Analysis API settings.`
export const DEFAULT_API_BASE_URL = "https://artificialanalysis.ai/api/v2"
export const USER_AGENT = `${CLI_NAME}/${CLI_VERSION}`
export const CACHE_DIR_ENV = "MODEL_ANALYSIS_CACHE_DIR"
export const CACHE_TTL_SECONDS_ENV = "MODEL_ANALYSIS_CACHE_TTL_SECONDS"
export const DEFAULT_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
export const DEFAULT_CACHE_DIR_RELATIVE = ".config/model-analysis/cache"
