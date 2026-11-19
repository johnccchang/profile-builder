import type { ChatError, UiMessage } from '@/hooks/useChat';

type Props = {
    message: UiMessage;
    /** Only set on the assistant bubble that is currently being written. */
    live?: { pendingTool: string | null; streaming: boolean; error: ChatError | null; onRetry: () => void };
};

export function MessageBubble({ message, live }: Props) {
    const isUser = message.role === 'user';
    const waiting = live?.streaming && !message.content;
    return (
        <div className={`row ${isUser ? 'row-user' : 'row-assistant'}`}>
            <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
                {live?.pendingTool && <div className="tool-status">{live.pendingTool}</div>}
                {message.content && <div className="text">{message.content}</div>}
                {waiting && !live?.pendingTool && <span className="dots" aria-label="Thinking" />}
                {message.warning && <div className="warning">{message.warning}</div>}
                {live?.error && (
                    <div className="error" role="alert">
                        <span>{live.error.message}</span>
                        {live.error.retryable && (
                            <button type="button" className="retry" onClick={live.onRetry}>
                                Retry
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
