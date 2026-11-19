export type ServerConfig = {
    /** Undefined when not configured; the turn reports missing_credentials without calling the LLM. */
    apiKey: string | undefined;
    model: string;
    fallbackModel: string;
};

export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning:free';
export const DEFAULT_FALLBACK_MODEL = 'inclusionai/ling-3.2-flash:free';

/** Blank env values (`LLM_MODEL=` in .env) count as unset. */
function pick(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

/** Never log the returned object: it carries the API key. */
export function readConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
    return {
        apiKey: pick(env.OPENROUTER_API_KEY),
        model: pick(env.LLM_MODEL) ?? DEFAULT_MODEL,
        fallbackModel: pick(env.LLM_FALLBACK_MODEL) ?? DEFAULT_FALLBACK_MODEL,
    };
}
