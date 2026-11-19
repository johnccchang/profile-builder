# Decision log

Decisions made in the design discussion before any code was written, in order. Each line is a decision the engineer made; the "why" is the trade-off that was weighed. PROCESS.md has the annotated prompts behind the important ones.

## Product and UX
1. **Hybrid proactivity.** Casual chat, quiet extraction, at most one follow-up per turn aimed at the biggest profile gap or the destination data. Why: an interview feels like a form; draft-and-correct makes guessed fields that pollute conflict detection.
2. **Eight fields:** `displayName`, `dietaryRestrictions`, `budgetTier`, `interests`, `preferredSeasons`, `travelCompanions`, `lodgingStyle`, `wishlistDestinations`. Why: four of them map directly onto `getDestinationInfo` (`budget`, `knownFor`, `bestSeasons`), so follow-ups can use real tool data; `dietaryRestrictions` is the cleanest conflict case.
3. **`displayName`** is optional, last-write-wins and exempt from conflicts. Why: "Samuel" after "Sam" is a nickname, not a contradiction.
4. **Static, client-rendered greeting** (no LLM call on load). Why: instant, free, works with missing credentials.
5. The system prompt tells the model the user was already greeted. Why: simpler than injecting a fake assistant turn.
6. **Layout:** read-only profile sidebar on the left, ChatGPT-style chat on the right.
7. **Conflicts** surface twice: the assistant asks in chat and the sidebar field shows a "needs confirmation" badge with old and new values. The old value stays until the user answers.

## LLM integration
8. **One streamed call; line 1 is JSON, the rest is prose.** Why: lowest latency, and no dependence on native tool calling, which free models do unreliably. Accepted costs: weaker guarantees than a pre-pass, tolerant parser needed.
9. **Cut-and-continue for destinations.** Line 1 lists `destinations`; if non-empty the server cancels the stream, runs `getDestinationInfo` (unknown returns `null`) and starts a reply-only call with the results injected. Why: tool use is guaranteed and the `null` case is explicit; the extra latency lands only on turns that mention a place.
10. The same cut-and-continue triggers on a conflict detected by app code. Why: the chat question and the sidebar badge then come from one source.
11. **Models:** primary `nvidia/nemotron-3.5-lightning:free`, fallback `inclusionai/ling-3.2-flash:free`, both via env. Chosen for speed and different vendors; neither was verified for the line-1 format before the build.
12. **Context per call:** system prompt + stored profile JSON + last 20 messages, owned by the backend. The client sends only the new message.

## Streaming and state
13. A failed turn stores the user message only (enables retry). 14. No clear-conversation action. 15. `pendingConflicts` lives in the profile.
16. The client sends a `messageId`; the server dedups retries against the last stored message.
17. Line 1 may carry `resolutions: [{field, keep}]`; the server applies it and clears the pending entry.
18. **JSON-file persistence** behind a `Store` interface, atomic temp-then-rename writes, in-process mutex, zod validation on load. Why: zero native dependencies keeps setup under five minutes; one user and two small documents do not need a database.
19. **Failure handling** is a table of typed error codes (see `src/contract/events.ts`): missing and invalid credentials are non-retryable; rate limits and 5xx fall back to the second model once; a malformed line 1 gets one repair retry and then degrades to reply-only with a warning.

## Architecture
20. Single Next.js app: `src/contract` (shared zod), `src/server` (logic, no HTTP types), thin route handlers, `src/components`, `src/hooks`.
21. **Merge semantics:** lists additive; `interests` and `wishlistDestinations` never conflict; `dietaryRestrictions`, `budgetTier`, `preferredSeasons`, `travelCompanions`, `lodgingStyle` can. `set`/`remove` are compared against the stored profile in one module, `conflicts.ts`; an empty stored field is set directly.

## Implementation strategy
22. Contract first on the main thread, then three parallel subagent streams on disjoint files (server core, domain and storage, UI). Subagents write but do not commit; the main thread reviews and commits in small units.
23. Local repo first; 24. the 2-hour clock includes the design discussion; 25. repo at `~/workplace/profile-builder`.
