'use client';

import { useEffect, useRef } from 'react';
import { useChat } from '@/hooks/useChat';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { ProfileSidebar } from './ProfileSidebar';

export function ChatApp() {
    const { profile, messages, status, error, pendingTool, greeting, send, retry } = useChat();
    const listRef = useRef<HTMLDivElement>(null);
    const stickRef = useRef(true);
    const streaming = status === 'streaming';

    // Only follow the stream while the user is near the bottom, so scrolling up to read is not fought.
    useEffect(() => {
        const el = listRef.current;
        if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    }, [messages, error, pendingTool, greeting]);

    const onScroll = () => {
        const el = listRef.current;
        if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };

    const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

    return (
        <div className="app">
            <ProfileSidebar profile={profile} ready={greeting !== null} />
            <main className="chat">
                <div className="messages" ref={listRef} onScroll={onScroll}>
                    <div className="messages-inner">
                        {greeting && (
                            <MessageBubble message={{ id: 'greeting', role: 'assistant', content: greeting }} />
                        )}
                        {messages.map((m) => (
                            <MessageBubble
                                key={m.id}
                                message={m}
                                live={
                                    m.id === lastAssistantId && (streaming || error)
                                        ? { pendingTool, streaming, error, onRetry: retry }
                                        : undefined
                                }
                            />
                        ))}
                    </div>
                </div>
                <Composer
                    disabled={streaming}
                    onSend={(t) => {
                        stickRef.current = true;
                        send(t);
                    }}
                />
            </main>
        </div>
    );
}
