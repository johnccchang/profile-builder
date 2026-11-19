import { z } from 'zod';

export const BudgetTier = z.enum(['budget', 'midRange', 'luxury']);
export type BudgetTier = z.infer<typeof BudgetTier>;

export const Season = z.enum(['spring', 'summer', 'fall', 'winter']);
export type Season = z.infer<typeof Season>;

export const LodgingStyle = z.enum(['hostel', 'hotel', 'boutique', 'rental', 'resort']);
export type LodgingStyle = z.infer<typeof LodgingStyle>;

export const TravelCompanions = z.enum(['solo', 'partner', 'family', 'friends']);
export type TravelCompanions = z.infer<typeof TravelCompanions>;

/**
 * Fields that can contradict an already-stored value and therefore go through
 * conflict detection. `displayName` (last-write-wins) and the grow-only lists
 * (`interests`, `wishlistDestinations`) are deliberately not in this set.
 */
export const ConflictableField = z.enum([
    'dietaryRestrictions',
    'budgetTier',
    'preferredSeasons',
    'travelCompanions',
    'lodgingStyle',
]);
export type ConflictableField = z.infer<typeof ConflictableField>;

/** A stored or proposed value of a conflictable field: scalar, list, or empty. */
export const FieldValue = z.union([z.string(), z.array(z.string()), z.null()]);
export type FieldValue = z.infer<typeof FieldValue>;

/**
 * A contradiction waiting for the user's answer. The stored profile keeps
 * `oldValue` until a matching resolution arrives; `newValue` is what the
 * conversation proposed.
 */
export const PendingConflict = z.object({
    field: ConflictableField,
    oldValue: FieldValue,
    newValue: FieldValue,
    sourceMessageId: z.string(),
});
export type PendingConflict = z.infer<typeof PendingConflict>;

export const TravelProfile = z.object({
    displayName: z.string().optional(),
    dietaryRestrictions: z.array(z.string()).default([]),
    budgetTier: BudgetTier.optional(),
    interests: z.array(z.string()).default([]),
    preferredSeasons: z.array(Season).default([]),
    travelCompanions: TravelCompanions.optional(),
    lodgingStyle: LodgingStyle.optional(),
    wishlistDestinations: z.array(z.string()).default([]),
    pendingConflicts: z.array(PendingConflict).default([]),
});
export type TravelProfile = z.infer<typeof TravelProfile>;

export const emptyProfile = (): TravelProfile => TravelProfile.parse({});
