import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '@/contract/profile';
import { createJsonStore } from './json-store';

let dir: string;
beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-store-'));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
});

const msg = (n: number) => ({ id: `m${n}`, role: 'user' as const, content: `c${n}`, createdAt: '2026-01-01T00:00:00Z' });

describe('json store', () => {
    it('returns empty state when files are missing', async () => {
        const s = createJsonStore(path.join(dir, 'nested'));
        expect(await s.getProfile()).toEqual(emptyProfile());
        expect(await s.getRecentMessages(10)).toEqual([]);
    });

    it('roundtrips profile and messages, returning the last N oldest first', async () => {
        const s = createJsonStore(path.join(dir, 'nested'));
        await s.saveProfile({ ...emptyProfile(), displayName: 'Ann', interests: ['food'] });
        for (let i = 1; i <= 5; i++) await s.appendMessage(msg(i));
        expect((await s.getProfile()).displayName).toBe('Ann');
        expect((await s.getRecentMessages(3)).map((m) => m.id)).toEqual(['m3', 'm4', 'm5']);
        const again = createJsonStore(path.join(dir, 'nested'));
        expect((await again.getProfile()).interests).toEqual(['food']);
    });

    it('renames a corrupt file and starts fresh', async () => {
        await fs.writeFile(path.join(dir, 'profile.json'), '{not json');
        await fs.writeFile(path.join(dir, 'messages.json'), JSON.stringify([{ nope: 1 }]));
        const s = createJsonStore(dir);
        expect(await s.getProfile()).toEqual(emptyProfile());
        expect(await s.getRecentMessages(5)).toEqual([]);
        const files = await fs.readdir(dir);
        expect(files.filter((f) => f.startsWith('profile.json.') && f.endsWith('.corrupt'))).toHaveLength(1);
        expect(files.filter((f) => f.startsWith('messages.json.') && f.endsWith('.corrupt'))).toHaveLength(1);
        expect(files).not.toContain('profile.json');
    });

    it('serializes concurrent withLock read-modify-write sequences', async () => {
        const s = createJsonStore(dir);
        await Promise.all(
            Array.from({ length: 20 }, () =>
                s.withLock(async () => {
                    const p = await s.getProfile();
                    await s.saveProfile({ ...p, interests: [...p.interests, 'x'] });
                }),
            ),
        );
        expect((await s.getProfile()).interests).toHaveLength(20);
    });

    it('a failing withLock fn does not poison the lock', async () => {
        const s = createJsonStore(dir);
        await expect(s.withLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        await expect(s.withLock(async () => 42)).resolves.toBe(42);
    });

    it('leaves no temp files behind after writes', async () => {
        const s = createJsonStore(dir);
        await s.saveProfile(emptyProfile());
        await s.appendMessage(msg(1));
        const files = (await fs.readdir(dir)).sort();
        expect(files).toEqual(['messages.json', 'profile.json']);
    });
});
