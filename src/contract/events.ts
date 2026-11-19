import { z } from 'zod';
import { PendingConflict, TravelProfile } from './profile';

export const ErrorCode = z.enum([
    'missing_credentials',
    'invalid_credentials',
    'llm_unavailable',
    'stream_interrupted',
    'storage_corrupt',
    'bad_request',
    'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * Everything the server can send over the SSE stream for one turn.
 * Order per turn: [tool*] profile [conflict*] token* [warning] done | error.
 */
export const ChatEvent = z.discriminatedUnion('type', [
    z.object({ type: z.literal('profile'), profile: TravelProfile }),
    z.object({
        type: z.literal('tool'),
        name: z.literal('getDestinationInfo'),
        input: z.string(),
        found: z.boolean(),
    }),
    z.object({ type: z.literal('conflict'), conflict: PendingConflict }),
    z.object({ type: z.literal('token'), text: z.string() }),
    z.object({
        type: z.literal('warning'),
        code: z.literal('extraction_failed'),
        message: z.string(),
    }),
    z.object({ type: z.literal('done'), requestId: z.string() }),
    z.object({
        type: z.literal('error'),
        code: ErrorCode,
        message: z.string(),
        requestId: z.string(),
        retryable: z.boolean(),
    }),
]);
export type ChatEvent = z.infer<typeof ChatEvent>;
