import { z } from 'zod';
import { BudgetTier, ConflictableField, LodgingStyle, Season, TravelCompanions } from './profile';

/**
 * Line 1 of every model response: a single-line JSON object describing what the
 * latest user message changed. Everything is optional so a sparse or lazy model
 * still parses; the server never trusts it beyond this schema.
 */
export const ExtractionSet = z.object({
    displayName: z.string().min(1).optional(),
    budgetTier: BudgetTier.optional(),
    travelCompanions: TravelCompanions.optional(),
    lodgingStyle: LodgingStyle.optional(),
});

export const ExtractionAdd = z.object({
    dietaryRestrictions: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    preferredSeasons: z.array(Season).optional(),
    wishlistDestinations: z.array(z.string()).optional(),
});

export const ExtractionRemove = z.object({
    dietaryRestrictions: z.array(z.string()).optional(),
    preferredSeasons: z.array(Season).optional(),
});

export const Resolution = z.object({
    field: ConflictableField,
    keep: z.enum(['old', 'new']),
});
export type Resolution = z.infer<typeof Resolution>;

export const Extraction = z.object({
    set: ExtractionSet.default({}),
    add: ExtractionAdd.default({}),
    remove: ExtractionRemove.default({}),
    destinations: z.array(z.string()).default([]),
    resolutions: z.array(Resolution).default([]),
});
export type Extraction = z.infer<typeof Extraction>;

export const emptyExtraction = (): Extraction => Extraction.parse({});
