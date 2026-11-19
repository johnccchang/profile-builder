import { randomUUID } from 'node:crypto';
import type { StoredMessage } from '@/contract/api';
import type { DestinationLookup } from '@/contract/destination';
import type { ChatEvent, ErrorCode } from '@/contract/events';
import type { Extraction } from '@/contract/extraction';
import type { PendingConflict } from '@/contract/profile';
import type { ApplyExtraction, GetDestinationInfo, Store } from '@/contract/ports';
import type { ChatRequest } from '@/contract/api';
import type { ServerConfig } from '@/server/config';
import { LineOneParser, type ParserOutput } from '@/server/llm/line-one-parser';
import { LlmError, type LlmClient, type LlmMessage } from '@/server/llm/openrouter';
import { REPAIR_REMINDER, buildExtractionSystemPrompt, buildReplySystemPrompt } from '@/server/llm/prompts';

export type { LlmClient } from '@/server/llm/openrouter';

export type TurnDeps = {
    store: Store;
    applyExtraction: ApplyExtraction;
    getDestinationInfo: GetDestinationInfo;
    llm: LlmClient;
    log: (e: Record<string, unknown>) => void;
    config: ServerConfig;
};

const HISTORY_LIMIT = 20;
const MAX_DESTINATIONS = 5;

/** Runs one chat turn and yields the SSE events in contract order. Never throws. */
export async function* runTurn(
    deps: TurnDeps,
    request: ChatRequest,
    requestId: string,
): AsyncGenerator<ChatEvent> {
    try {
        yield* turn(deps, request, requestId);
    } catch (err) {
        deps.log({ event: 'turn_error', requestId, error: err instanceof Error ? err.name : 'unknown' });
        yield errorEvent(err, requestId);
    }
}

async function* turn(deps: TurnDeps, request: ChatRequest, requestId: string): AsyncGenerator<ChatEvent> {
    await storeUserMessage(deps.store, request);
    if (!deps.config.apiKey) {
        throw new LlmError('missing_credentials', 'OPENROUTER_API_KEY is not set');
    }

    const history = (await deps.store.getRecentMessages(HISTORY_LIMIT)).map(toLlmMessage);
    const profile = await deps.store.getProfile();
    const firstMessages: LlmMessage[] = [
        { role: 'system', content: buildExtractionSystemPrompt(profile) },
        ...history,
    ];

    let source = parsedStream(deps, requestId, firstMessages);
    let extraction = await readExtraction(source);
    if (extraction === null) {
        // One repair attempt: weak models often forget the JSON line.
        await source.return(undefined);
        source = parsedStream(deps, requestId, [...firstMessages, REPAIR_REMINDER]);
        extraction = await readExtraction(source);
    }
    const extractionFailed = extraction === null;

    let replyProfile = profile;
    let lookups: DestinationLookup[] = [];
    let newConflicts: PendingConflict[] = [];
    if (extraction) {
        const names = uniqueNames(extraction.destinations);
        const [found, applied] = await Promise.all([
            lookupAll(deps, names),
            applyAndSave(deps, extraction, request.messageId),
        ]);
        lookups = found;
        replyProfile = applied.profile;
        newConflicts = applied.newConflicts;
        for (const l of lookups) {
            yield { type: 'tool', name: 'getDestinationInfo', input: l.query, found: l.info !== null };
        }
        yield { type: 'profile', profile: applied.profile };
        for (const conflict of newConflicts) yield { type: 'conflict', conflict };
    }

    if (lookups.length > 0 || newConflicts.length > 0) {
        // Cancel call 1 (its prose could not use the tool results) and ask again, grounded.
        await source.return(undefined);
        source = parsedStream(deps, requestId, [
            { role: 'system', content: buildReplySystemPrompt(replyProfile, lookups, newConflicts) },
            ...history,
        ]);
        // The second call is told not to emit JSON; skip its extraction event if it does anyway.
    }

    let reply = '';
    for await (const out of source) {
        if (out.kind !== 'prose') continue;
        reply += out.text;
        yield { type: 'token', text: out.text };
    }
    if (reply.trim() === '') throw new LlmError('unavailable', 'model returned an empty reply');

    // Only a fully streamed reply is stored, so history never holds partial text.
    await deps.store.appendMessage({
        id: randomUUID(),
        role: 'assistant',
        content: reply.trim(),
        createdAt: new Date().toISOString(),
    });
    if (extractionFailed) {
        yield {
            type: 'warning',
            code: 'extraction_failed',
            message: "I couldn't update your profile from that message.",
        };
    }
    yield { type: 'done', requestId };
}

/** Appends the user message unless this is a retry of the one already stored last. */
async function storeUserMessage(store: Store, request: ChatRequest): Promise<void> {
    await store.withLock(async () => {
        const [last] = await store.getRecentMessages(1);
        if (last && last.id === request.messageId && last.role === 'user') return;
        await store.appendMessage({
            id: request.messageId,
            role: 'user',
            content: request.text,
            createdAt: new Date().toISOString(),
        });
    });
}

/** Locks only the read-modify-write, never the streaming. */
function applyAndSave(deps: TurnDeps, extraction: Extraction, messageId: string) {
    return deps.store.withLock(async () => {
        const current = await deps.store.getProfile();
        const result = deps.applyExtraction(current, extraction, messageId);
        await deps.store.saveProfile(result.profile);
        return result;
    });
}

async function lookupAll(deps: TurnDeps, names: string[]): Promise<DestinationLookup[]> {
    return Promise.all(
        names.map(async (query) => {
            try {
                return { query, info: await deps.getDestinationInfo(query) };
            } catch {
                // An unknown or failing lookup is not a turn error.
                return { query, info: null };
            }
        }),
    );
}

function uniqueNames(names: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of names) {
        const name = raw.trim();
        if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            out.push(name);
        }
    }
    return out.slice(0, MAX_DESTINATIONS);
}

/** The parser always emits the extraction event first. */
async function readExtraction(gen: AsyncGenerator<ParserOutput>): Promise<Extraction | null> {
    const first = await gen.next();
    if (first.done || first.value.kind !== 'extraction') return null;
    return first.value.extraction;
}

async function* parsedStream(
    deps: TurnDeps,
    requestId: string,
    messages: LlmMessage[],
): AsyncGenerator<ParserOutput> {
    const parser = new LineOneParser();
    for await (const delta of streamWithFallback(deps, requestId, messages)) {
        yield* parser.push(delta);
    }
    yield* parser.end();
}

/** Primary model first; one fallback only when nothing was received yet. */
async function* streamWithFallback(
    deps: TurnDeps,
    requestId: string,
    messages: LlmMessage[],
): AsyncGenerator<string> {
    const { model, fallbackModel } = deps.config;
    const models = fallbackModel && fallbackModel !== model ? [model, fallbackModel] : [model];
    for (let i = 0; i < models.length; i++) {
        const started = Date.now();
        let firstTokenMs: number | null = null;
        // Stays 'aborted' when the consumer stops early (we cancel after line 1 on purpose).
        let outcome = 'aborted';
        try {
            for await (const delta of deps.llm.stream({ model: models[i], messages })) {
                if (firstTokenMs === null) firstTokenMs = Date.now() - started;
                yield delta;
            }
            outcome = 'ok';
            return;
        } catch (err) {
            let error = err instanceof LlmError ? err : new LlmError('unavailable', 'unexpected LLM failure');
            // Dropping before any text is indistinguishable from an outage: allow fallback.
            if (error.kind === 'interrupted' && firstTokenMs === null) {
                error = new LlmError('unavailable', error.message);
            }
            outcome = error.kind;
            if (error.kind === 'unavailable' && i < models.length - 1) continue;
            throw error;
        } finally {
            deps.log({
                event: 'llm_call',
                requestId,
                model: models[i],
                latencyMs: Date.now() - started,
                firstTokenMs,
                outcome,
            });
        }
    }
}

function toLlmMessage(m: StoredMessage): LlmMessage {
    return { role: m.role, content: m.content };
}

function errorEvent(err: unknown, requestId: string): ChatEvent {
    const make = (code: ErrorCode, message: string, retryable: boolean): ChatEvent => ({
        type: 'error',
        code,
        message,
        requestId,
        retryable,
    });
    if (err instanceof LlmError) {
        switch (err.kind) {
            case 'missing_credentials':
                return make('missing_credentials', 'The server has no OpenRouter API key configured.', false);
            case 'invalid_credentials':
                return make('invalid_credentials', 'OpenRouter rejected the configured API key.', false);
            case 'interrupted':
                return make('stream_interrupted', 'The reply was cut off. Please try again.', true);
            default:
                return make('llm_unavailable', 'The language model is unavailable right now. Please try again.', true);
        }
    }
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'storage_corrupt') {
        return make('storage_corrupt', 'Stored data could not be read.', false);
    }
    return make('internal', 'Something went wrong on our side.', true);
}
