import type { ServerConfig } from '@/server/config';

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmRequest = { model: string; messages: LlmMessage[] };

/**
 * Streams text deltas. Abandoning the iteration (break / return()) must cancel
 * the underlying request; the turn relies on this to stop after line 1.
 */
export interface LlmClient {
    stream(request: LlmRequest): AsyncGenerator<string>;
}

export type LlmErrorKind =
    | 'missing_credentials'
    | 'invalid_credentials'
    /** 429, 5xx, network failure or timeout before any content: worth a fallback model. */
    | 'unavailable'
    /** The stream broke after it started. */
    | 'interrupted';

export class LlmError extends Error {
    constructor(
        readonly kind: LlmErrorKind,
        message: string,
    ) {
        super(message);
        this.name = 'LlmError';
    }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** Free models sometimes hang; give up on silence rather than leaving the UI spinning. */
const IDLE_TIMEOUT_MS = 30_000;

export function createOpenRouterClient(config: ServerConfig): LlmClient {
    return {
        stream: (request) => streamCompletion(config, request),
    };
}

async function* streamCompletion(config: ServerConfig, request: LlmRequest): AsyncGenerator<string> {
    if (!config.apiKey) throw new LlmError('missing_credentials', 'OPENROUTER_API_KEY is not set');

    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let started = false;

    try {
        resetIdle();
        let response: Response;
        try {
            response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model: request.model, messages: request.messages, stream: true }),
                signal: controller.signal,
            });
        } catch {
            throw new LlmError('unavailable', 'network error or timeout contacting OpenRouter');
        }
        if (response.status === 401 || response.status === 403) {
            throw new LlmError('invalid_credentials', `OpenRouter rejected the API key (${response.status})`);
        }
        if (!response.ok || !response.body) {
            throw new LlmError('unavailable', `OpenRouter returned ${response.status}`);
        }

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        let finished = false;
        while (!finished) {
            let chunk: ReadableStreamReadResult<Uint8Array>;
            try {
                chunk = await reader.read();
            } catch {
                throw new LlmError(started ? 'interrupted' : 'unavailable', 'stream read failed');
            }
            resetIdle();
            if (chunk.done) break;
            pending += decoder.decode(chunk.value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
                const event = parseSseLine(line);
                if (event.kind === 'done') finished = true;
                else if (event.kind === 'error') {
                    throw new LlmError(started ? 'interrupted' : 'unavailable', 'provider error mid-stream');
                } else if (event.kind === 'finish') finished = true;
                else if (event.kind === 'delta' && event.text) {
                    started = true;
                    if (event.finish) finished = true;
                    yield event.text;
                }
                if (finished) break;
            }
        }
        // A stream that just ends (no [DONE], no finish_reason) was cut off.
        if (!finished) throw new LlmError(started ? 'interrupted' : 'unavailable', 'stream ended early');
    } finally {
        clearTimeout(idleTimer);
        controller.abort();
        reader?.cancel().catch(() => undefined);
    }
}

type SseEvent =
    | { kind: 'delta'; text: string; finish: boolean }
    | { kind: 'finish' }
    | { kind: 'done' }
    | { kind: 'error' }
    | { kind: 'skip' };

function parseSseLine(rawLine: string): SseEvent {
    const line = rawLine.trim();
    // Blank lines and ": OPENROUTER PROCESSING" keep-alive comments carry nothing.
    if (!line.startsWith('data:')) return { kind: 'skip' };
    const data = line.slice(5).trim();
    if (data === '[DONE]') return { kind: 'done' };
    try {
        const json = JSON.parse(data) as {
            error?: unknown;
            choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
        };
        if (json.error) return { kind: 'error' };
        const choice = json.choices?.[0];
        const text = choice?.delta?.content;
        // A finish_reason can share a chunk with the last text.
        if (text) return { kind: 'delta', text, finish: Boolean(choice?.finish_reason) };
        if (choice?.finish_reason) return { kind: 'finish' };
        return { kind: 'skip' };
    } catch {
        return { kind: 'skip' };
    }
}
