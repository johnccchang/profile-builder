import type { Extraction } from '@/contract/extraction';
import type { ApplyExtraction } from '@/contract/ports';
import type {
    BudgetTier,
    ConflictableField,
    FieldValue,
    LodgingStyle,
    PendingConflict,
    Season,
    TravelCompanions,
    TravelProfile,
} from '@/contract/profile';

type ScalarField = 'budgetTier' | 'travelCompanions' | 'lodgingStyle';
type ListField = 'dietaryRestrictions' | 'preferredSeasons';

const norm = (value: string): string => value.trim().toLowerCase();

/** Case-insensitive, trimmed, order-preserving de-duplication. */
function mergeUnique(existing: string[], incoming: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of [...existing, ...incoming]) {
        const key = norm(item);
        if (key && !seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    }
    return out;
}

/** Single pending entry per field: a newer conflict supersedes the older one. */
function upsertPending(list: PendingConflict[], conflict: PendingConflict): PendingConflict[] {
    return [...list.filter((c) => c.field !== conflict.field), conflict];
}

function writeField(profile: TravelProfile, field: ConflictableField, value: FieldValue): void {
    // Values come from our own conflict records, so the casts only restore the narrowed enum types.
    switch (field) {
        case 'dietaryRestrictions':
            profile.dietaryRestrictions = Array.isArray(value) ? value : [];
            break;
        case 'preferredSeasons':
            profile.preferredSeasons = Array.isArray(value) ? (value as Season[]) : [];
            break;
        case 'budgetTier':
            profile.budgetTier = (typeof value === 'string' ? value : undefined) as BudgetTier | undefined;
            break;
        case 'travelCompanions':
            profile.travelCompanions = (typeof value === 'string' ? value : undefined) as
                | TravelCompanions
                | undefined;
            break;
        case 'lodgingStyle':
            profile.lodgingStyle = (typeof value === 'string' ? value : undefined) as LodgingStyle | undefined;
            break;
    }
}

function applyResolutions(profile: TravelProfile, extraction: Extraction): void {
    for (const { field, keep } of extraction.resolutions) {
        const pending = profile.pendingConflicts.find((c) => c.field === field);
        if (!pending) continue;
        if (keep === 'new') writeField(profile, field, pending.newValue);
        profile.pendingConflicts = profile.pendingConflicts.filter((c) => c.field !== field);
    }
}

function applyAdditions(profile: TravelProfile, extraction: Extraction): void {
    const { add } = extraction;
    if (add.dietaryRestrictions) {
        profile.dietaryRestrictions = mergeUnique(profile.dietaryRestrictions, add.dietaryRestrictions);
    }
    if (add.preferredSeasons) {
        profile.preferredSeasons = mergeUnique(profile.preferredSeasons, add.preferredSeasons) as Season[];
    }
    if (add.interests) profile.interests = mergeUnique(profile.interests, add.interests);
    if (add.wishlistDestinations) {
        profile.wishlistDestinations = mergeUnique(profile.wishlistDestinations, add.wishlistDestinations);
    }
}

function applyScalar(
    profile: TravelProfile,
    field: ScalarField,
    incoming: string | undefined,
    sourceMessageId: string,
    created: PendingConflict[],
): void {
    if (!incoming) return;
    const current = profile[field];
    if (!current) {
        writeField(profile, field, incoming);
    } else if (current !== incoming) {
        created.push({ field, oldValue: current, newValue: incoming, sourceMessageId });
    }
}

function applyRemoval(
    profile: TravelProfile,
    field: ListField,
    items: string[] | undefined,
    sourceMessageId: string,
    created: PendingConflict[],
): void {
    if (!items) return;
    const current: string[] = profile[field];
    const toRemove = new Set(items.map(norm));
    const next = current.filter((c) => !toRemove.has(norm(c)));
    // Nothing stored matched: the user is retracting something we never recorded.
    if (next.length === current.length) return;
    created.push({ field, oldValue: [...current], newValue: next, sourceMessageId });
}

export const applyExtraction: ApplyExtraction = (input, extraction, sourceMessageId) => {
    // Deep-ish copy so callers' objects are never mutated.
    const profile: TravelProfile = structuredClone(input);
    const created: PendingConflict[] = [];

    applyResolutions(profile, extraction);

    const { set, remove } = extraction;
    if (set.displayName) profile.displayName = set.displayName.trim();
    applyAdditions(profile, extraction);
    applyScalar(profile, 'budgetTier', set.budgetTier, sourceMessageId, created);
    applyScalar(profile, 'travelCompanions', set.travelCompanions, sourceMessageId, created);
    applyScalar(profile, 'lodgingStyle', set.lodgingStyle, sourceMessageId, created);
    applyRemoval(profile, 'dietaryRestrictions', remove.dietaryRestrictions, sourceMessageId, created);
    applyRemoval(profile, 'preferredSeasons', remove.preferredSeasons, sourceMessageId, created);

    for (const conflict of created) {
        profile.pendingConflicts = upsertPending(profile.pendingConflicts, conflict);
    }
    return { profile, newConflicts: created };
};
