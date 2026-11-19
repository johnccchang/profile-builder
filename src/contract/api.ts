import { z } from 'zod';
import { TravelProfile } from './profile';

/** POST /api/chat. The server owns history, so the client sends only the new message. */
export const ChatRequest = z.object({
    messageId: z.string().uuid(),
    text: z.string().trim().min(1).max(2000),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const StoredMessage = z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    createdAt: z.string(),
});
export type StoredMessage = z.infer<typeof StoredMessage>;

/** GET /api/state. Used on load so a reload restores the profile and the chat. */
export const StateResponse = z.object({
    profile: TravelProfile,
    messages: z.array(StoredMessage),
});
export type StateResponse = z.infer<typeof StateResponse>;
