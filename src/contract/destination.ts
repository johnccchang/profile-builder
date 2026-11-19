import type { Season } from './profile';

/** Shape returned by the destination tool. Name and fields follow the assignment contract. */
export type DestinationInfo = {
    name: string;
    bestSeasons: Season[];
    knownFor: string[];
    averageDailyBudgetUSD: { budget: number; midRange: number; luxury: number };
    visaNotes?: string;
};

/** One entry per name the user mentioned; `info` is null when the destination is unknown. */
export type DestinationLookup = {
    query: string;
    info: DestinationInfo | null;
};
