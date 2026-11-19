import { NextResponse } from 'next/server';
import type { StateResponse } from '@/contract/api';
import { getStore } from '@/server/store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse<StateResponse>> {
    const store = getStore();
    const [profile, messages] = await Promise.all([store.getProfile(), store.getRecentMessages(100)]);
    return NextResponse.json({ profile, messages });
}
