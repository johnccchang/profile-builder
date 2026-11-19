import { NextResponse } from 'next/server';
import type { StateResponse } from '@/contract/api';
import { getStore } from '@/server/store';

// No `dynamic` segment config: next.config.ts enables cacheComponents, which rejects it.
// The handler reads files at request time, so it is never prerendered anyway.
export async function GET(): Promise<NextResponse<StateResponse>> {
    const store = getStore();
    const [profile, messages] = await Promise.all([store.getProfile(), store.getRecentMessages(100)]);
    return NextResponse.json({ profile, messages });
}
