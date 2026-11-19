import type { StoredMessage } from './api';
import type { DestinationInfo } from './destination';
import type { Extraction } from './extraction';
import type { PendingConflict, TravelProfile } from './profile';

/**
 * Interfaces the server streams code against, so they can be built in parallel.
 * Implementations live in src/server.
 */

/** JSON-file persistence today; swappable for a real database. */
export interface Store {
    getProfile(): Promise<TravelProfile>;
    saveProfile(profile: TravelProfile): Promise<void>;
    appendMessage(message: StoredMessage): Promise<void>;
    /** Oldest first, at most `limit` entries. */
    getRecentMessages(limit: number): Promise<StoredMessage[]>;
    /** Serializes read-modify-write sequences (double submit, retry overlap). */
    withLock<T>(fn: () => Promise<T>): Promise<T>;
}

export type ApplyResult = {
    /** Profile with additions merged, resolutions applied and new conflicts recorded. */
    profile: TravelProfile;
    /** Conflicts created by this extraction (not those that were already pending). */
    newConflicts: PendingConflict[];
};

/** Pure function: merges an extraction into a profile and detects contradictions. */
export type ApplyExtraction = (
    profile: TravelProfile,
    extraction: Extraction,
    sourceMessageId: string,
) => ApplyResult;

/** Stand-in for a real travel data API. Returns null for unknown destinations. */
export type GetDestinationInfo = (name: string) => Promise<DestinationInfo | null>;
