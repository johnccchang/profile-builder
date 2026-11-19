import type { DestinationLookup } from '@/contract/destination';
import type { PendingConflict, TravelProfile } from '@/contract/profile';
import type { LlmMessage } from './openrouter';

const PERSONA = `You are a friendly, casual travel-planning companion chatting with a user while quietly building their travel profile.
Tone: warm and relaxed, short replies, no bullet-point walls. Ask AT MOST ONE follow-up question per turn.
The user was ALREADY greeted and asked for their name before this conversation started, so never greet them again and never re-ask for their name.`;

function greetingNote(profile: TravelProfile): string {
    return profile.displayName
        ? `They were greeted as "${profile.displayName}".`
        : 'They have not told you their name yet; do not push for it, just carry on naturally.';
}

function profileBlock(profile: TravelProfile): string {
    return `Stored profile (JSON, the source of truth):\n${JSON.stringify(profile)}`;
}

const SCHEMA = `LINE 1 FORMAT. Output ONLY a single-line JSON object on line 1: no code fence, no commentary. Then a newline, then your reply to the user. Schema (every key optional, omit what did not change):
{"set":{"displayName":string,"budgetTier":"budget"|"midRange"|"luxury","travelCompanions":"solo"|"partner"|"family"|"friends","lodgingStyle":"hostel"|"hotel"|"boutique"|"rental"|"resort"},
 "add":{"dietaryRestrictions":string[],"interests":string[],"preferredSeasons":("spring"|"summer"|"fall"|"winter")[],"wishlistDestinations":string[]},
 "remove":{"dietaryRestrictions":string[],"preferredSeasons":("spring"|"summer"|"fall"|"winter")[]},
 "destinations":string[],
 "resolutions":[{"field":"dietaryRestrictions"|"budgetTier"|"preferredSeasons"|"travelCompanions"|"lodgingStyle","keep":"old"|"new"}]}

Semantics:
- add: new information the user just gave (list fields).
- set: scalar fields (name, budget tier, companions, lodging style).
- remove: ONLY when the user explicitly retracts something ("actually I'm not vegetarian anymore").
- destinations: every place the user mentions this turn that you could look up, even in passing.
- resolutions: ONLY when the user is answering a pending conflict listed under pendingConflicts in the stored profile. keep "old" = they keep the stored value, "new" = they switch to the proposed one.
- Normalise list items to short lowercase strings (e.g. "vegetarian", "street food"). Capitalise nothing in lists except destination names inside "destinations".
- Only extract what the user actually said in their LATEST message. If nothing changed, output {} on line 1.

Example (user: "I'm Sam, I love hiking and I'm vegetarian. Thinking about Lisbon in spring"):
{"set":{"displayName":"Sam"},"add":{"interests":["hiking"],"dietaryRestrictions":["vegetarian"],"preferredSeasons":["spring"]},"destinations":["Lisbon"]}
Lovely to hear, Sam! ...your reply continues here as plain text.`;

/** First call: line-1 JSON, then prose. */
export function buildExtractionSystemPrompt(profile: TravelProfile): string {
    return [
        PERSONA,
        greetingNote(profile),
        'Ask your one follow-up about the biggest gap in the stored profile (e.g. an empty field) unless the user asked something specific.',
        profileBlock(profile),
        SCHEMA,
    ].join('\n\n');
}

function describeValue(value: PendingConflict['oldValue']): string {
    if (value === null) return 'nothing';
    return Array.isArray(value) ? value.join(', ') || 'nothing' : value;
}

function destinationBlock(lookups: DestinationLookup[]): string {
    if (lookups.length === 0) return '';
    const entries = lookups.map((l) =>
        l.info
            ? `- ${l.query}: ${JSON.stringify(l.info)}`
            : `- ${l.query}: no data available`,
    );
    return `Destination lookup results:\n${entries.join('\n')}\nUse ONLY these facts about the destinations. Where it says "no data available", say you do not have details on it yet. Do NOT invent facts, prices, seasons or visa rules.`;
}

function conflictBlock(conflicts: PendingConflict[]): string {
    if (conflicts.length === 0) return '';
    const entries = conflicts.map(
        (c) =>
            `- ${c.field}: stored value "${describeValue(c.oldValue)}" vs what they just said "${describeValue(c.newValue)}"`,
    );
    return `The user's latest message contradicts the stored profile:\n${entries.join('\n')}\nAsk the user ONE natural, casual question about this (do not mention fields or systems). The stored (old) value stays until they answer, so do not treat the new one as settled.`;
}

/** Second call after destinations/conflicts: prose only, grounded in tool results. */
export function buildReplySystemPrompt(
    profile: TravelProfile,
    lookups: DestinationLookup[],
    conflicts: PendingConflict[],
): string {
    return [
        PERSONA,
        greetingNote(profile),
        profileBlock(profile),
        destinationBlock(lookups),
        conflictBlock(conflicts),
        conflicts.length > 0
            ? 'Your single follow-up question for this turn is the conflict question above.'
            : 'If it fits, your single follow-up question can build on the destination info or the biggest profile gap.',
        'Reply with prose only. Do NOT output any JSON line, code fence or list of fields; that was already handled.',
    ]
        .filter(Boolean)
        .join('\n\n');
}

/** Appended on the single repair retry when line 1 was unusable. */
export const REPAIR_REMINDER: LlmMessage = {
    role: 'user',
    content:
        'Reminder: your reply MUST start with line 1 = one single-line JSON object exactly matching the schema (no code fence), then a newline, then your reply. Answer my last message again in that format.',
};
