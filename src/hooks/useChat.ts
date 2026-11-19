'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StateResponse } from '@/contract/api';
import { ChatEvent, type ErrorCode } from '@/contract/events';
import { emptyProfile, type TravelProfile } from '@/contract/profile';

export type UiMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    warning?: string;
};

export type ChatError = {
    code: ErrorCode | 'http';
    message: string;
    retryable: boolean;
};

type Turn = { messageId: string; text: string; assistantId: string };

/** Greeting is static and client-only: never stored, never an LLM call. */
export function greetingFor(profile: TravelProfile): string {
    return profile.displayName
        ? `Welcome back, ${profile.displayName}! Where are we dreaming of next?`
        : 'Hi! I\'m your travel buddy. What should I call you?';
}

/** Splits a text/event-stream buffer into complete `data:` payloads; returns the unfinished tail. */
function takeEvents(buffer: string): { payloads: string[]; rest: string } {
    // Normalise CRLF so events split across chunks still match on a blank line.
    const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
    const rest = parts.pop() ?? '';
    const payloads: string[] = [];
    for (const part of parts) {
        const data = part
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).replace(/^ /, ''))
            .join('\n');
        if (data) payloads.push(data);
    }
    return { payloads, rest };
}

const INTERRUPTED: ChatError = {
    code: 'stream_interrupted',
    message: 'The connection dropped before the reply finished.',
    retryable: true,
};

export function useChat() {
    const [profile, setProfile] = useState<TravelProfile>(emptyProfile);
    const [messages, setMessages] = useState<UiMessage[]>([]);
    const [status, setStatus] = useState<'idle' | 'streaming'>('idle');
    const [error, setError] = useState<ChatError | null>(null);
    const [pendingTool, setPendingTool] = useState<string | null>(null);
    const [greeting, setGreeting] = useState<string | null>(null);

    const bufferRef = useRef('');
    const targetRef = useRef<string | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastTurnRef = useRef<Turn | null>(null);
    const busyRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);
    const frameRef = useRef<() => void>(() => {});

    const appendToTarget = useCallback((text: string) => {
        const id = targetRef.current;
        if (!id || !text) return;
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + text } : m)));
    }, []);

    // Tokens arrive in bursts; draining a few chars per frame reads as steady typing.
    // The chunk grows with the backlog so the display never lags far behind the server.
    // Frames go through a ref so the callback can re-schedule itself.
    const frame = useCallback(() => {
        rafRef.current = null;
        const buf = bufferRef.current;
        if (!buf) return;
        const n = Math.min(buf.length, Math.max(2, Math.ceil(buf.length / 15)));
        bufferRef.current = buf.slice(n);
        appendToTarget(buf.slice(0, n));
        if (bufferRef.current) rafRef.current = requestAnimationFrame(() => frameRef.current());
    }, [appendToTarget]);

    useEffect(() => {
        frameRef.current = frame;
    }, [frame]);

    const enqueue = useCallback((text: string) => {
        bufferRef.current += text;
        if (rafRef.current === null) rafRef.current = requestAnimationFrame(() => frameRef.current());
    }, []);

    const flush = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        const rest = bufferRef.current;
        bufferRef.current = '';
        appendToTarget(rest);
    }, [appendToTarget]);

    // Restore profile + chat after reload.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            let state: StateResponse | null = null;
            try {
                const res = await fetch('/api/state');
                const parsed = StateResponse.safeParse(await res.json());
                if (parsed.success) state = parsed.data;
                else console.warn('Invalid /api/state response', parsed.error);
            } catch (err) {
                console.warn('Failed to load /api/state', err);
            }
            if (cancelled) return;
            const loaded = state?.profile ?? emptyProfile();
            setProfile(loaded);
            setMessages((state?.messages ?? []).map(({ id, role, content }) => ({ id, role, content })));
            setGreeting(greetingFor(loaded));
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(
        () => () => {
            abortRef.current?.abort();
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        },
        [],
    );

    const runTurn = useCallback(
        async (turn: Turn) => {
            busyRef.current = true;
            lastTurnRef.current = turn;
            targetRef.current = turn.assistantId;
            bufferRef.current = '';
            setStatus('streaming');
            setError(null);
            setPendingTool(null);

            const controller = new AbortController();
            abortRef.current = controller;
            let terminal = false;
            let failure: ChatError | null = null;

            const handle = (event: ChatEvent) => {
                switch (event.type) {
                    case 'profile':
                        setProfile(event.profile);
                        break;
                    case 'tool':
                        setPendingTool(event.found ? `Looking up ${event.input}…` : `No data on ${event.input}`);
                        break;
                    case 'token':
                        setPendingTool(null);
                        enqueue(event.text);
                        break;
                    case 'warning': {
                        const id = turn.assistantId;
                        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, warning: event.message } : m)));
                        break;
                    }
                    case 'done':
                        terminal = true;
                        break;
                    case 'error':
                        terminal = true;
                        failure = { code: event.code, message: event.message, retryable: event.retryable };
                        break;
                    case 'conflict':
                        // The profile event already carries pendingConflicts; nothing extra to render.
                        break;
                }
            };

            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messageId: turn.messageId, text: turn.text }),
                    signal: controller.signal,
                });
                if (!res.ok || !res.body) {
                    terminal = true;
                    failure = {
                        code: 'http',
                        message: `Request failed (${res.status}).`,
                        retryable: res.status >= 500,
                    };
                } else {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let pending = '';
                    while (!terminal) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        pending += decoder.decode(value, { stream: true });
                        const { payloads, rest } = takeEvents(pending);
                        pending = rest;
                        for (const payload of payloads) {
                            let json: unknown;
                            try {
                                json = JSON.parse(payload);
                            } catch {
                                console.warn('Dropped non-JSON SSE payload', payload);
                                continue;
                            }
                            const parsed = ChatEvent.safeParse(json);
                            if (!parsed.success) {
                                console.warn('Dropped invalid chat event', parsed.error);
                                continue;
                            }
                            handle(parsed.data);
                        }
                    }
                    reader.cancel().catch(() => {});
                }
            } catch (err) {
                if (controller.signal.aborted) return;
                console.warn('Chat stream failed', err);
            }

            if (controller.signal.aborted) return;
            flush();
            if (!terminal) failure = INTERRUPTED;
            setPendingTool(null);
            setError(failure);
            setStatus('idle');
            busyRef.current = false;
        },
        [enqueue, flush],
    );

    const send = useCallback(
        (rawText: string) => {
            const text = rawText.trim();
            if (!text || busyRef.current) return;
            const messageId = crypto.randomUUID();
            const assistantId = `assistant-${messageId}`;
            setMessages((prev) => [
                ...prev,
                { id: messageId, role: 'user', content: text },
                { id: assistantId, role: 'assistant', content: '' },
            ]);
            void runTurn({ messageId, text, assistantId });
        },
        [runTurn],
    );

    // Same messageId on purpose: the server dedupes, so a retry cannot double-apply the turn.
    const retry = useCallback(() => {
        const turn = lastTurnRef.current;
        if (!turn || busyRef.current) return;
        setMessages((prev) =>
            prev.map((m) => (m.id === turn.assistantId ? { ...m, content: '', warning: undefined } : m)),
        );
        void runTurn(turn);
    }, [runTurn]);

    return { profile, messages, status, error, pendingTool, greeting, send, retry };
}
