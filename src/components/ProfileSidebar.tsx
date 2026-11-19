'use client';

import { useEffect, useState } from 'react';
import type { ConflictableField, FieldValue, PendingConflict, TravelProfile } from '@/contract/profile';

type FieldKey = Exclude<keyof TravelProfile, 'pendingConflicts' | 'displayName'>;

const SECTIONS: { key: FieldKey; label: string }[] = [
    { key: 'dietaryRestrictions', label: 'Dietary restrictions' },
    { key: 'budgetTier', label: 'Budget' },
    { key: 'interests', label: 'Interests' },
    { key: 'preferredSeasons', label: 'Preferred seasons' },
    { key: 'travelCompanions', label: 'Travel companions' },
    { key: 'lodgingStyle', label: 'Lodging style' },
    { key: 'wishlistDestinations', label: 'Wishlist destinations' },
];

const PRETTY: Record<string, string> = { midRange: 'Mid-range' };

function pretty(value: string): string {
    return PRETTY[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

function formatValue(value: FieldValue): string {
    if (value === null) return 'nothing';
    if (Array.isArray(value)) return value.length ? value.map(pretty).join(', ') : 'nothing';
    return pretty(value);
}

function valuesOf(profile: TravelProfile, key: FieldKey): string[] {
    const value = profile[key];
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
}

/** Fields whose displayed value or conflict state differs, so we can flash them. */
function changedKeys(prev: TravelProfile, next: TravelProfile): string[] {
    const keys: string[] = [];
    if (prev.displayName !== next.displayName) keys.push('displayName');
    for (const { key } of SECTIONS) {
        if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) keys.push(key);
    }
    for (const c of next.pendingConflicts) {
        if (!prev.pendingConflicts.some((p) => p.field === c.field && JSON.stringify(p) === JSON.stringify(c))) {
            keys.push(c.field);
        }
    }
    return keys;
}

function Conflict({ conflict }: { conflict: PendingConflict }) {
    return (
        <div className="conflict">
            <span className="badge">needs confirmation</span>
            <span className="conflict-diff">
                was: {formatValue(conflict.oldValue)} → now: {formatValue(conflict.newValue)}
            </span>
        </div>
    );
}

export function ProfileSidebar({ profile, ready }: { profile: TravelProfile; ready: boolean }) {
    // Derived-state pattern (compare during render) avoids a setState-in-effect cascade.
    const [seen, setSeen] = useState({ profile, ready });
    const [flash, setFlash] = useState<string[]>([]);
    if (seen.profile !== profile || seen.ready !== ready) {
        // Skip the first load so the whole sidebar doesn't light up on reload.
        if (seen.ready && ready) setFlash(changedKeys(seen.profile, profile));
        setSeen({ profile, ready });
    }

    useEffect(() => {
        if (!flash.length) return;
        const timer = setTimeout(() => setFlash([]), 1600);
        return () => clearTimeout(timer);
    }, [flash]);

    return (
        <aside className="sidebar">
            <h1 className={`sidebar-title${flash.includes('displayName') ? ' flash' : ''}`}>
                {profile.displayName ?? 'Your travel profile'}
            </h1>
            {profile.displayName && <p className="sidebar-sub">Your travel profile</p>}
            {SECTIONS.map(({ key, label }) => {
                const values = valuesOf(profile, key);
                const conflicts = profile.pendingConflicts.filter((c) => c.field === (key as ConflictableField));
                return (
                    <section key={key} className={`field${flash.includes(key) ? ' flash' : ''}`}>
                        <h2>{label}</h2>
                        {values.length ? (
                            <div className="chips">
                                {values.map((v) => (
                                    <span key={v} className="chip">
                                        {pretty(v)}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="muted">Not yet known</p>
                        )}
                        {conflicts.map((c) => (
                            <Conflict key={c.sourceMessageId + c.field} conflict={c} />
                        ))}
                    </section>
                );
            })}
        </aside>
    );
}
