# Engineering Process — Travel Profile Builder

## Approach and tools

I used an engineer-led, agent-assisted workflow: I drove the product and architectural decisions through discussion, then authorized implementation after agreeing on the main contracts and boundaries. I wanted a conversational experience, low perceived latency, and a small architecture I could explain.

The implementation session used Claude Code. The export identifies Sonnet 5.5 as the main model and records an Opus 5.5 advisor being configured. After the shared contracts were established, three subagents worked on separate areas: server orchestration and LLM integration, domain logic and storage, and the UI. The main agent integrated their work and created focused commits. I later used Codex to check whether any major requirements were missing and to help prepare documentation.

## Transcript and time spent

The [Claude session export](files/2026-11-19-201357-local-command-caveatthe-command-below-was-run-d.txt) records the design discussion, implementation, subagent completion reports, integration fixes, and initial verification. Some tool calls and outputs are collapsed. The subagent reports are summaries, not complete exports of their internal conversations. Later manual testing and the subsequent Codex requirement check are outside this Claude export; this document summarizes those activities without presenting them as part of that transcript.

Approximately **2 hours 37 minutes** were spent in total:

- **About 20 minutes:** reading the requirements page and preparing the initial prompt before the recorded Claude session.
- **About 77 minutes:** the recorded design discussion and implementation, approximately 11:53 PM on November 18 to 1:10 AM on November 19, 2026, Pacific time.
- **About one additional hour:** post-implementation testing, review, and documentation.

## Annotated interaction highlights

These highlights come from the Claude export. Quoted excerpts retain the original wording, including typing errors.

### 1. Keep the conversation casual

- **Prompt excerpt:** “Let's do hybrid as I would like the users feel like it's a causal chat with the assistant”

- **Goal:** Build a profile without making the user complete a questionnaire.

- **Response:** Claude proposed quiet extraction and at most one follow-up per turn, aimed at a profile gap or destination information.

- **Decision:** I accepted that balance because it gave the assistant direction without dominating the conversation.

### 2. Personalize without introducing accounts

- **Prompt excerpt:** “Okay, let's add displayName as an optional field. Then, we should let the assistant to start with some greeting to collect the user's name”

- **Goal:** Make a single-user app feel personal.

- **Response:** Claude proposed an optional display name, latest-value-wins behavior, and an exemption from conflict confirmation for nickname changes.

- **Decision:** I accepted that behavior, selected a static greeting, and asked to put the already-greeted fact in the system prompt. This avoided a model request on page load.

### 3. Challenge the two-call recommendation

- **Prompt excerpt:** “what if a single call and we force the profile item as the first event and then the chat stream event?”

- **Goal:** Update the sidebar before the visible reply while reducing unnecessary LLM round trips.

- **Response:** Claude initially preferred extraction followed by a separate streamed reply for reliability, but explained how first-line JSON followed by prose could work.

- **Decision:** I chose the JSON-first stream. It saves a round trip and repeated input on ordinary turns, while accepting format risk and the time needed to generate extraction before prose appears.

### 4. Accept an extra call where grounding requires it

- **Prompt excerpts:** “let's do 2” and “yes the trigger should include conflicts”

- **Goal:** Keep the ordinary single-call path while letting destination results and conflict decisions inform the reply.

- **Response:** Claude proposed stopping after extraction when a destination appeared, calling the destination tool, and starting a reply-only generation with the result.

- **Decision:** I accepted this and included conflicts in the trigger. The extra call was worthwhile on these turns because the reply could use application-provided facts and clarification instructions. This still depends on successful extraction.

### 5. Move history ownership to the backend

- **Prompt excerpt:** “the history should be owned by the backend”

- **Goal:** Give the server responsibility for constructing consistent model context.

- **Response:** Claude had leaned toward client-owned history because only profile persistence was essential.

- **Decision:** I changed that to server-owned history, with the stored profile and last 20 messages sent to the model. This kept the client request small, bounded context, and allowed chat restoration after reload.

### 6. Define failed-turn and resolution behavior

- **Prompt excerpt:** “we could store user message only for now as it could be used to resend the request to LLM once failure is gone.”

- **Goal:** Support retry without saving incomplete assistant responses.

- **Response:** Claude proposed client-generated message IDs, deduplication against the latest stored user message, and explicit conflict resolutions using `keep: old | new`.

- **Decision:** I accepted those mechanisms and stored pending conflicts inside the profile. The old preference stays until confirmation. Retry deduplication is deliberately narrow, not a general idempotency system.

### 7. Choose storage for the actual scope

- **Prompt excerpt:** “yes, let's use JSON files”

- **Goal:** Keep local setup simple for one profile and a small message history.

- **Response:** Claude compared JSON files with SQLite and recommended a storage interface, atomic replacement, validation, and an in-process lock.

- **Decision:** I accepted JSON storage to avoid database setup. The trade-off is limited concurrency and deployment flexibility; atomic file replacement does not replace correct serialization of read-modify-write operations.

### 8. Cut model evaluation consciously

- **Prompt excerpt:** “let's use these two for now as we have limited time”

- **Goal:** Limit time spent on model selection.

- **Response:** Claude shortlisted Nemotron and Ling while explicitly saying their JSON-first-line behavior had not been verified, and suggested a comparison script.

- **Decision:** I accepted the models provisionally and deferred the separate benchmark in favor of application testing. This was a time-budget decision, not evidence that both models had been evaluated systematically.

### 9. Establish contracts before parallel work

- **Prompt excerpts:** “Establish shared contracts and clear file ownership before delegation.” and “Never commit the entire implementation in one single commit.”

- **Goal:** Get useful parallelism without incompatible interfaces or a single opaque code drop.

- **Response:** Claude proposed shared Zod contracts first, followed by three streams with separate file ownership; subagents would write but not commit.

- **Decision:** I approved that split and the main agent's integration role. The implementation produced 19 focused commits covering contracts, domain logic, storage, UI, streaming, and integration.

## Integration and verification

- **Agent checks:** typechecking, linting, a production build, and 33 targeted tests passed. HTTP smoke tests covered invalid requests and missing credentials.
- **My verification:** I drove the design and manually tested the app, including profile updates, unknown-destination handling, and dietary conflict confirmation. Implementation code review was primarily agent-assisted.
- **Remaining gaps:** both models were not systematically benchmarked, and automated browser and turn-orchestration tests are not included. Destination-grounding and concurrent-write limitations are documented in the README.

## Reflection and deliberate stopping point

Planning first helped me make the important decisions myself, especially extraction ordering, conditional second calls, and backend-owned history. Delegating against shared contracts made implementation fast. However, the design discussion consumed much of the visible session, and several short decisions could have been settled while an initial end-to-end slice was being built.

The most useful lesson was that local tests do not prove the composition is safe. The storage subagent explicitly warned that `appendMessage` required caller locking, and the main agent flagged it for review, yet the assistant append remained outside the lock. I would turn such warnings into tracked verification tasks instead of relying on a later read-through.

I also accepted a specific trade-off in extraction failure: one repair attempt, then continuing with prose and a warning. Later review showed that this preserves conversation flow but can bypass destination grounding. The same review found that assistant-introduced destination suggestions can escape the lookup path. I chose to keep the current implementation and document those limitations rather than expand scope before finishing the submission materials.

With another day, I would prioritize orchestration tests and the grounding/concurrency gaps, then compare both models using the same extraction and contradiction examples. I would improve recovery messages before adding features. The README records the current behavior and known limitations.

## At 10,000 requests per hour

- **Measure first:** collect concurrency, model latency, extraction failure and fallback rates, tokens per completed turn, and cost. Request volume alone does not determine the concurrency budget.
- **Use shared transactional storage:** replace JSON files, coordinate profile/history updates, and add durable request deduplication across server instances.
- **Evaluate models and prompts:** maintain examples for preference extraction, implicit contradictions, resolutions, known and unknown destinations, malformed output, and interruptions. Compare JSON-first streaming with separate structured extraction using measured accuracy, latency, and cost.
- **Strengthen the schema where evidence warrants it:** constrain conflict proposals and resolutions more precisely, and verify that extraction failures cannot bypass destination grounding.
- **Bound operational load:** add concurrency limits, provider-aware retries, explicit cancellation and timeouts, and monitoring tied to request IDs. Preserve the separation between transport, orchestration, domain logic, and storage.
