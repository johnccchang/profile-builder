'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
    const [text, setText] = useState('');
    const ref = useRef<HTMLTextAreaElement>(null);

    // A disabled textarea drops focus; hand it back when the reply finishes.
    useEffect(() => {
        if (!disabled) ref.current?.focus();
    }, [disabled]);

    const submit = () => {
        if (disabled || !text.trim()) return;
        onSend(text);
        setText('');
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // isComposing: don't send while an IME is confirming a character.
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
        }
    };

    return (
        <div className="composer">
            <textarea
                ref={ref}
                value={text}
                rows={2}
                disabled={disabled}
                placeholder="Tell me about your travel style…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                maxLength={2000}
            />
            <button type="button" onClick={submit} disabled={disabled || !text.trim()}>
                Send
            </button>
        </div>
    );
}
