import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { StoredMessage } from '@/contract/api';
import type { Store } from '@/contract/ports';
import { emptyProfile, TravelProfile } from '@/contract/profile';
import { log } from '../log';

const Messages = z.array(StoredMessage);

export function createJsonStore(dataDir: string): Store {
    const profilePath = path.join(dataDir, 'profile.json');
    const messagesPath = path.join(dataDir, 'messages.json');
    let tail: Promise<unknown> = Promise.resolve();

    async function ensureDir(): Promise<void> {
        await fs.mkdir(dataDir, { recursive: true });
    }

    /** Set bad data aside rather than deleting it, so nothing is silently lost. */
    async function quarantine(file: string, reason: unknown): Promise<void> {
        const target = `${file}.${Date.now()}.corrupt`;
        try {
            await fs.rename(file, target);
        } catch {
            // Already gone or unmovable: starting fresh is still the right move.
        }
        log({ level: 'error', event: 'store_corrupt', file, movedTo: target, reason: String(reason) });
    }

    async function load<T>(file: string, schema: z.ZodType<T>, empty: () => T): Promise<T> {
        let raw: string;
        try {
            raw = await fs.readFile(file, 'utf8');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty();
            await quarantine(file, err);
            return empty();
        }
        try {
            return schema.parse(JSON.parse(raw));
        } catch (err) {
            await quarantine(file, err);
            return empty();
        }
    }

    /** Temp file in the same dir + rename keeps readers from ever seeing a half-written file. */
    async function writeAtomic(file: string, data: unknown): Promise<void> {
        await ensureDir();
        const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
        try {
            await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
            await fs.rename(tmp, file);
        } catch (err) {
            await fs.rm(tmp, { force: true });
            throw err;
        }
    }

    return {
        getProfile: () => load(profilePath, TravelProfile, emptyProfile),
        saveProfile: (profile) => writeAtomic(profilePath, TravelProfile.parse(profile)),
        async appendMessage(message) {
            const all = await load(messagesPath, Messages, () => []);
            all.push(message);
            await writeAtomic(messagesPath, all);
        },
        async getRecentMessages(limit) {
            const all = await load(messagesPath, Messages, () => []);
            return limit <= 0 ? [] : all.slice(-limit);
        },
        withLock<T>(fn: () => Promise<T>): Promise<T> {
            const run = tail.then(fn, fn);
            // Swallow the rejection on the chain only; the caller still sees it via `run`.
            tail = run.catch(() => undefined);
            return run;
        },
    };
}
