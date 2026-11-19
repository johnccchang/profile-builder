import path from 'node:path';
import type { Store } from '@/contract/ports';
import { createJsonStore } from './json-store';

// Stashed on globalThis so Next dev hot reload keeps one store (and one lock chain).
const g = globalThis as unknown as { __profileStore?: Store };

export function getStore(): Store {
    g.__profileStore ??= createJsonStore(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
    return g.__profileStore;
}
