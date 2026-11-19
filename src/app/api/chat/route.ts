// Expects from '@/server/deps' (written by the integrator):
//   export function createDeps(): TurnDeps
// It must be cheap to call per request (memoise heavy things such as the store inside it).
import { ChatRequest } from '@/contract/api';
import { createDeps } from '@/server/deps';
import { runTurn } from '@/server/turn';

// No `dynamic` segment config: cacheComponents rejects it, and POST is never cached.

function json(body: Record<string, unknown>, status: number): Response {
    return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();

    let raw: unknown;
    try {
        raw = await request.json();
    } catch {
        return json({ code: 'bad_request', message: 'Body must be JSON.', requestId }, 400);
    }
    const parsed = ChatRequest.safeParse(raw);
    if (!parsed.success) {
        return json({ code: 'bad_request', message: 'Invalid chat request.', requestId }, 400);
    }

    let events: ReturnType<typeof runTurn>;
    try {
        events = runTurn(createDeps(), parsed.data, requestId);
    } catch {
        return json({ code: 'internal', message: 'Server misconfigured.', requestId }, 500);
    }

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        // Pull-based so a slow client applies backpressure to the LLM stream.
        async pull(controller) {
            const next = await events.next();
            if (next.done) controller.close();
            else controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`));
        },
        // Client went away: unwind the generator so the upstream LLM request is aborted.
        async cancel() {
            await events.return(undefined);
        },
    });

    return new Response(body, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Request-Id': requestId,
        },
    });
}
