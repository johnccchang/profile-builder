import { applyExtraction } from '@/server/conflicts';
import { readConfig } from '@/server/config';
import { getDestinationInfo } from '@/server/destinations';
import { createOpenRouterClient } from '@/server/llm/openrouter';
import { log } from '@/server/log';
import { getStore } from '@/server/store';
import type { TurnDeps } from '@/server/turn';

/**
 * Composition root: the only place that binds the turn orchestrator to concrete
 * implementations. Config is re-read per request so editing .env.local needs no code change.
 */
export function createDeps(): TurnDeps {
    const config = readConfig();
    return {
        store: getStore(),
        applyExtraction,
        getDestinationInfo,
        llm: createOpenRouterClient(config),
        log,
        config,
    };
}
