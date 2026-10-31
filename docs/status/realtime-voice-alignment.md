# Realtime Voice alignment

Updated: 2026-10-30. Baseline: merged #961 at `e4ebb62`,
plus the synthetic final-response approval and controlled-delivery slice below. Owner:
[#558](https://github.com/footnote-ai/footnote/issues/558), still open.

This tracker records source/test evidence, not live-provider validation. Update
the affected rows and evidence with each implementation PR. Keep proposals
separate from implemented behavior. The
[current architecture](../architecture/realtime-voice.md) describes transport;
the [Talker–Reasoner proposal](../proposals/realtime-talker-reasoner.md) describes
the broader design. Call state and background Workflow execution have synthetic
implementation, including final-response approval, handoff and controlled playback reports; live provider wiring and audio delivery remain proposed.

## Alignment matrix

Paths in the evidence column are relative to `packages/`.
"Implemented" means present in code. Synthetic call-state tests exercise the new
foundation without a provider; they do not establish live voice behavior.
"Gap" means implementation is still required.

| Area                               | Ordinary chat baseline                                                                                                                                                                     | Realtime baseline / classification                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                           | Owner / next work                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation projection            | Normalization builds role-aligned messages plus participant/turn/visibility/authority metadata; recent windows retain 12 web / 24 Discord non-system messages.                             | **Implemented, synthetic only:** bounded call-local turns reuse the existing message projection and envelope after audience/consent checks. **Gap:** live provider input still has only startup roster and optional summary strings; finalized turn events are not connected.                                                                                                                                                                                                         | [conversationContextService.ts](../../packages/backend/src/services/conversationContextService.ts), [requestNormalization.ts](../../packages/backend/src/services/chatOrchestrator/requestNormalization.ts), [realtimePromptComposer.ts](../../packages/backend/src/services/prompts/realtimePromptComposer.ts); `backend/test/conversationContextService.test.ts` | #558 reuse projection; #559 governs transfer/retention.                                                                                                 |
| Identity and correlation           | `sessionId` maps to correlation `conversationId`; web keeps a component-local ID. Neither is a durable conversation entity.                                                                | **Implemented:** each response has a canonical Run, one Generate Step, provider Attempt and bounded Result; a private random session ID joins Runs. **Implemented, synthetic only:** stable call-local turn IDs and intent revisions share the private session correlation. **Gap:** live user-turn, reasoning-result and audible-delivery correlation.                                                                                                                               | [internalVoiceRealtime.ts](../../packages/backend/src/handlers/internalVoiceRealtime.ts); `backend/test/internalVoiceRealtimeHandler.test.ts` (distinct Runs, shared private correlation, disconnect idempotence)                                                                                                                                                  | #878 landed; #558 extends correlation locally; #559 owns cross-surface IDs.                                                                             |
| Async execution                    | `runChat` awaits the existing workflow and returns a final response; AbortSignal propagates to supported operations. This is not a durable background-job API.                             | **Implemented, synthetic only:** one process-owned pending reservation starts the existing Workflow without awaiting completion in the call-state event path. Reconnects cannot bypass unresolved work in that process. **Implemented, synthetic only:** one approved-answer slot with single-use request/handoff and ordered playback reports. **Gap:** live event wiring and speech delivery.                                                                                       | [chatOrchestrator.ts](../../packages/backend/src/services/chatOrchestrator.ts), [reviewedChatWorkflow.ts](../../packages/backend/src/services/workflowCore/reviewedChatWorkflow.ts), `backend/src/handlers/chat.ts`; [runtime interface](../../packages/agent-runtime/src/index.ts)                                                                                | #558: one pending handle and delivery slot, not another engine.                                                                                         |
| Review, policy, breakers           | Existing workflow applies Execution Contract limits, conditional assessment, revision, and fail-open outcomes; a named Result or completed Run is not necessarily assessed/approved.       | **Implemented, synthetic only:** background execution reuses Workflow policy, assessment and breaker decisions with narrower pre-execution voice admission. **Gap:** direct live provider answers still bypass that path; selected final-response eligibility and staging are implemented with synthetic evidence; speech remains unwired.                                                                                                                                            | `backend/src/services/workflowEngine/limits.ts`, `backend/src/services/workflowEngine/reviewDecision.ts`, `backend/src/services/workflowCore/reviewedChatWorkflow.ts`, `backend/src/handlers/internalVoiceRealtime.ts`                                                                                                                                             | #558 explicit speech eligibility; [#709](https://github.com/footnote-ai/footnote/issues/709) is closed for its tested boundaries, not voice coverage.   |
| Retrieval and source reporting     | Context Integrations execute bounded lookups; `buildModelInput` projects evidence as advisory user data with a generation-context manifest. Revision-aware `github_source` is implemented. | **Implemented, synthetic only:** answer-only execution admits weather and web-search Context Integrations at executor selection; provider-native search and other integrations are denied. Workflow model-input authority is reused. **Implemented, synthetic only:** approved text can be staged after selection/review checks. **Gap:** injection into live speech.                                                                                                                 | [Context Integrations](../architecture/context-integrations/README.md), [GitHub source retrieval](../architecture/context-integrations/github.md), [modelInput.ts](../../packages/backend/src/services/workflowEngine/modelInput.ts)                                                                                                                               | #558 reuse workflow; [#539](https://github.com/footnote-ai/footnote/issues/539) is closed. Its completion does not establish voice retrieval.           |
| Profile and speech selection       | Request/profile resolution and overlays; backend TTS selects effective model/voice/delivery.                                                                                               | **Implemented shared selection; intentional profile difference:** Realtime uses configured `runtimeConfig.profile`, not chat request profile resolution. Precedence is request/session → operator profile → deployment fallback. Invalid explicit choices are rejected; unsupported configured settings can fall back per setting.                                                                                                                                                    | [speechPresentation.ts](../../packages/backend/src/services/speechPresentation.ts), [internalVoiceTts.ts](../../packages/backend/src/services/internalVoiceTts.ts), `backend/test/speechPresentation.test.ts`, `backend/test/internalVoiceTtsService.test.ts`, `backend/test/internalVoiceRealtimeHandler.test.ts`                                                 | #831 landed. [#534](https://github.com/footnote-ai/footnote/issues/534) still owns human audition/default selection; no bundled voices assumed settled. |
| Audio, attention, speaker identity | Text input is attributed by surface metadata. Generated playback synthesizes supplied text rather than continuing a voice session.                                                         | **Intentional difference:** Discord captures/resamples speaker streams, injects silence tails for server VAD, and immediately streams playback. **Gap:** audio labels/IDs reach the backend but adapter audio append sends only bytes; text injection adds a label. No proven multi-speaker attribution or safe delivery window.                                                                                                                                                      | `discord-bot/src/voice/AudioCaptureHandler.ts`, `VoiceSessionManager.ts`, `AudioPlaybackHandler.ts`; [OpenAI adapter](../../packages/agent-runtime/src/openAiRealtimeVoiceRuntime.ts); `discord-bot/test/realtimeStreaming.test.ts`, `voiceSessionManager.test.ts`                                                                                                 | #558 normalized attention/input events; #559 participant/consent lifecycle.                                                                             |
| Interruptions and delivery         | HTTP disconnect requests cancellation; provider/tool stop is not guaranteed.                                                                                                               | **Implemented, synthetic only:** backend request/handoff and ordered playback reports preserve revocation separately from observed playback. **Gap:** VAD can auto-create/interrupt provider responses, but normalized contract lacks speech-start/stop, finalized transcript, explicit output cancellation/truncation, approved-result update, and local playback acknowledgement. Provider `response.done` is not audible delivery.                                                 | [voice types](../../packages/contracts/src/voice/types.ts), `agent-runtime/src/openAiRealtimeVoiceRuntime.ts`, `discord-bot/src/realtime/RealtimeEventHandler.ts`, `discord-bot/src/voice/AudioPlaybackHandler.ts`                                                                                                                                                 | #558: distinguish Run completion, delivery, partial playback, supersession and cancellation.                                                            |
| Provider capability                | Generation adapter supports configured text providers. Provider/model facts and adapter support must both be known.                                                                        | **Intentional distinct runtime:** `RealtimeVoiceRuntime` has `createSession`, `send`, `onEvent`, `close`; server constructs only OpenAI Realtime, gated by a direct OpenAI key. **Gap:** some generic VAD options still use OpenAI enums. OpenRouter audio HTTP/SSE is not proof of persistent Realtime.                                                                                                                                                                              | `agent-runtime/src/index.ts`, `backend/src/server.ts`, `contracts/src/voice/types.ts`; [provider research](../proposals/realtime-talker-reasoner.md#provider-feasibility-is-a-separate-decision)                                                                                                                                                                   | #558 minimal capability-driven boundary; separate bounded provider evaluation after approval.                                                           |
| Provenance and inspection          | Run → Step → Attempt → Result evidence feeds backend Trace/operator projections.                                                                                                           | **Implemented:** metadata-only response Runs include speech/provider selection, timing, available usage/cost; execution report exposes private session correlation. Public projection omits correlation/effective voice settings. **Implemented, synthetic only:** content-free reasoning Runs retain canonical IDs and a private initiating turn; authenticated pending inspection reports capacity and watchdog degradation. **Gap:** Reasoner-result→speech delivery relationship. | `backend/src/server.ts`, `backend/src/storage/traces/traceDisplayProjection.ts`; `backend/test/internalVoiceRealtimeHandler.test.ts`, `traceDisplayProjection.test.ts`, `operatorExecutionHandler.test.ts`                                                                                                                                                         | #878 landed; #558 reuse evidence without publishing call details.                                                                                       |
| Usage and cost                     | #955 adds provider-neutral text cache policy, measurements, cost completeness and read/write/reasoning accounting where reported. Explicit caching remains disabled by default.            | **Implemented with limits:** only optional aggregate prompt/completion counts, model/time/cost fields. Backend estimates/records cost only with both counts; absent differs from reported zero. No normalized cache, reasoning, or audio/text token breakdown.                                                                                                                                                                                                                        | `agent-runtime/src/openAiRealtimeVoiceRuntime.ts`, `backend/src/handlers/internalVoiceRealtime.ts`, `backend/src/services/llmCostRecorder.ts`; [cache status](./prompt-caching-status.md)                                                                                                                                                                          | #838/#955 landed; #558 richer voice evidence. #552/#957 own cache economics; no demonstrated incremental savings.                                       |
| Privacy and availability           | Text has explicit history/account-memory/trace paths; voice is optional to chat.                                                                                                           | **Implemented:** no transcript/audio/response bodies in Realtime Run persistence; #842 removes response/greeting text logging. **Implemented, synthetic only:** participant/consent changes discard retained context and invalidate freshness; close clears call state. **Gap:** live consent events, durable consent/session policy and continuity. Provider session failure ends voice; it does not silently retry as text.                                                         | `discord-bot/src/events/VoiceSubsystem.ts`, `discord-bot/test/loggingPrivacy.test.ts`, `backend/src/handlers/internalVoiceRealtime.ts`, `discord-bot/src/events/VoiceStateHandler.ts`                                                                                                                                                                              | #558 preserve content-free evidence and fail-open text availability; #559 decides retention/transfer.                                                   |

## Completed foundation

- [#831](https://github.com/footnote-ai/footnote/pull/831): shared speech
  presentation and effective selection; human audition explicitly deferred.
- [#838](https://github.com/footnote-ai/footnote/pull/838): incomplete Realtime
  token usage no longer becomes estimated complete cost.
- [#842](https://github.com/footnote-ai/footnote/pull/842): remove greeting and
  response text from Discord Realtime logs.
- [#878](https://github.com/footnote-ai/footnote/pull/878): per-response canonical
  Runs, private session correlation, operator inspection and privacy coverage.
- [#955](https://github.com/footnote-ai/footnote/pull/955): caching infrastructure
  and measurement, not demonstrated savings or Realtime cache instrumentation.
  Direct comparison and local packaging follow-ups remain #957/#958.

The earlier matrix in the architecture page was delivered by #803/#846; this
page is now its maintained successor. The context proposal predates the current
implementation: its speculative segment/cache model is not a live conversation
store. See its [implementation note](../proposals/conversation_context_boundary.md#implementation-and-realtime-follow-up).

## Synthetic call-state foundation

`backend/src/services/realtimeConversationState.ts` holds one call's transient
state beside the existing session correlation. It reuses
`projectConversationMessages` and the conversation envelope; text-chat assembly
and Run/Trace records are unchanged. No live handler calls it yet.

- Finalized turns receive stable IDs that survive projection and trimming.
  Intent revisions invalidate earlier questions after correction or cancellation.
  A freshness handle is scoped to one call instance, even if a correlation ID is
  accidentally reused. Freshness alone never establishes review or speech approval.
- The caller supplies trusted participant IDs and explicit processing consent for
  the whole human audience. Unknown speakers hold delivery without guessing an
  identity. Roster or consent changes discard prior context and invalidate old
  handles; rejoining or restoring consent cannot restore that content.
- The window retains at most 12 turns and 16 KiB of UTF-8 content. Participant
  metadata is separately bounded to 32 people and 128 characters per field.
  Oversized turns are rejected; rejected user content holds delivery rather than
  leaving an earlier answer eligible. Snapshots are detached from mutable state.
- Interruptions preserve the reasoning revision but revoke staged and late speech.
  An attributed continuation resumes intent, not revoked text. Closing is idempotent, clears retained content, and
  rejects later turns.

`backend/test/realtimeConversationState.test.ts` exercises these rules with
synthetic turns and participant events. This slice adds no provider connection,
speech delivery, transcript persistence, memory, or cross-session continuity.
The following slices add the bounded Workflow handoff and final-response staging;
controlled speech remains a separate gate.

## Synthetic Workflow execution

`RealtimeConversationState.startExecution` reserves one process-wide slot before
dispatching `chatOrchestrator.runRealtimeConversation`. That backend-only entry
uses `runChat` and the existing policy, planner, Context Integrations and Workflow
over the accepted projection. It does not call the public chat HTTP endpoint.
No live voice handler invokes this path yet.

- Completion requires an explicit receipt with response and canonical Run IDs,
  issued only after storage succeeds. Missing receipts/status and storage failures
  fail closed for voice; ordinary text storage keeps its existing fail-open behavior.
- Canonical Workflow execution is required even in `express` mode. Voice now
  reuses the configured runtime without an ephemeral-content capability gate.
  An intercepted real VoltAgent/AI SDK OpenRouter test covers structured planning,
  generation, assessment, exact approved selection, usage and SQLite receipts.
  Voice canonical content exclusions hold with Footnote model debug opt-in enabled;
  inherited capture sessions are bypassed. Provider free-text attribution is
  bounded to configured catalog labels in canonical receipts, including failure
  evidence and direct OpenAI planning; unrecognized labels are withheld.
- VoltAgent 2.11.0 local capture is allowed under the revised self-hosted policy.
  It is separate from Footnote's canonical store and opt-in model debug capture.
  Configured diagnostic logging can retain content in files, and configured
  VoltOps credentials can export it. Missing credentials or remote sampling do
  not disable local capture. Operators must disclose and control diagnostics and
  provider transmission; see the [data-handling contract](../architecture/realtime-voice.md#voice-data-handling).
  #963's separate HTTP executor, fixed model route and blanket fallback bans are
  superseded; shared profiles, caching, routing and supported retries remain.
- Execution admits text answers and only `weather_forecast` and `web_search`.
  Executor selection denies every other integration, including registry and
  fallback executors. Provider-native search is disabled at the runtime boundary;
  integration hints cannot widen the scope. Planner terminal actions, including
  reactions, images, silence and TTS, are denied before continuation execution.
- The scope is backend-only async context, never request/planner authority. It
  supplies no text session ID, account memories, attachments or private retrieval
  scope. Finalized turn IDs survive projection; canonical Workflow IDs bind when
  the Workflow starts, and final response IDs bind on metadata assembly.
- Voice persistence uses an explicit allowlist of canonical Run/Step/Attempt/Result
  identity, status, timing, usage, cost, limits and machine decisions. Prose is
  withheld, including planner/review text, retrieval queries, citations and bodies.
  Candidates, publication capabilities, model debug capture and free-form logs
  are excluded, even when operator debug capture is enabled. Tool short-circuits
  use the same projection. Public Trace omits session and initiating-turn identity.
- There is one pending handle and no queue. Duplicate intents are rejected.
  Supersession, consent/audience changes, cancellation and close request abort;
  interruptions preserve reasoning. Close clears call content and completion
  handles without releasing unresolved capacity. The shared Workflow restores
  the original AbortSignal after reading serialized plan Results.
- Work has a **60-second execution deadline**. Cancellation has an independent
  **5-second stop watchdog**. Expiry marks capacity degraded; admission rejects
  promptly while listening and call-state controls remain usable. Only settlement
  releases the slot and its watchdogs. There is no unverified force-release API.
- Administrators can read `/api/admin/executions/realtime-pending` for occupied
  capacity, age, deadlines, cancellation time, degradation reason and available
  canonical Run ID. This uses existing account/admin authentication and `no-store`.
  Completed executions use the ordinary response-ID report. Neither endpoint
  exposes voice prompts, transcripts, candidates or provider event bodies.

Capacity is process-local and independent of every call instance. Reconnects in
that backend process cannot bypass it. Multi-process admission, crash/restart
recovery and proof of remote stop remain gates before live wiring; restarting
does not prove a remote Run or billing stopped. This is not a durable job service.

`backend/test/realtimeWorkflowExecution.test.ts` uses deferred promises, fake
clocks, synthetic events and a truly never-settling Run. The real-orchestrator
tests use synthetic generation and HTTP boundaries plus disposable SQLite; the
operator tests verify auth, privacy and degraded inspection. Completion inspection retains identity, actual status and review disposition only;
approved text is isolated in the ephemeral slot described below.

## Synthetic final-response approval and staging

The [architecture mapping](../architecture/realtime-voice.md#final-response-approval-and-staging-synthetic-only)
describes the implemented dispositions. `realtimeWorkflowScope.ts` checks the
selected candidate, final text, produced draft/review Results and the successful
assessment of that exact draft. Only `finalize` with successful Run/Workflow
completion can approve speech. Persistence must finish first. Unassessed,
failed, revise/search and unsupported/ambiguous paths carry no answer text.
Ordinary text-chat fail-open behavior and the actual Run outcome are preserved.

`RealtimeConversationState.requestDelivery(handle)` reserves the ready answer
without returning text. `startDelivery(deliveryId)` rechecks turn, revision, call
instance, session, audience consent and deadline, then hands text off once.
`reportPlayback` records ordered adapter observations independently: a handoff
is neither a reported start nor a completed delivery. `deliveryStatus()` contains
metadata only, including whether a start was reported before interruption/failure.

The body is bounded to 16 KiB and cleared at handoff, expiry or revocation. The
30-second deadline runs from staging until start is reported, including pending
delivery time; a timely start report allows playback to finish after the deadline.
Clock checks enforce expiry even if timers run late. Interruptions,
ambiguous user input, corrections, cancellation, consent/roster changes and close
discard text and prevent prior callbacks from restaging it. Continuation cannot
restore revoked text. Revocation preserves playback observations without claiming
a stop. Ordered late reports about the last handoff cannot restore permission;
reports for replaced or closed slots are ignored. No persistence or public Trace
fields were added.

Evidence: `backend/test/realtimeWorkflowOrchestrator.test.ts` exercises the real
orchestrator with synthetic generation: approved initial/revised answers, rejected
actions, unassessed express responses, failed assessments, unresolved revision/search,
missing review Results, wrong draft links, storage failure and cancellation during
storage. `backend/test/realtimeWorkflowExecution.test.ts` uses controlled promises
and fake clocks for single consumption, wrong identity, late callbacks on both
sides of completion, audience/consent changes, expiry and disconnect. Controlled
playback reports cover request versus handoff versus start, duplicate/out-of-order
reports, expiry while waiting, interruption before/during playback, and late
completion after revocation. Run and review evidence remain unchanged.

This establishes synthetic backend approval and a controlled delivery lifecycle.
Provider event wiring, safe-turn scheduling, audio delivery/cancellation and
trustworthy live playback reports remain unimplemented. Adapter reports are not
proof that the audience heard anything or an exactly-once guarantee. The
conversational Talker is not complete. Broader permission for
unassessed or unresolved fallbacks remains an explicit policy decision.

## Proposed decisions and remaining gates

The proposal recommends a single-call ephemeral scope, one pending Run handle,
one result slot, explicit freshness/approval gates, and controlled speech of
approved text. The ephemeral call-state foundation below is implemented in
isolation. Pending execution and the controlled-delivery lifecycle are implemented above; live audio delivery remains proposed.
No general conversation coordinator is needed.

The target is a lightweight conversational Talker that listens, speaks naturally,
and manages turn-taking while reasoning proceeds independently. Fixed
acknowledgements and approved-text TTS validate infrastructure only; they do not
complete the conversational experience or demonstrate its latency advantage.
The model/adapter must enforce the boundary between conversational status and
approved substantive answers before target-mode rollout.

The initial single-slot limit requires a finite watchdog and observable degraded
behavior when cancellation does not settle: revoke delivery, report reasoning
unavailable, promptly reject new reasoning requests, and retain listening/call
controls. Record pending age, cancellation state and occupied capacity without
content. Reconnect must not bypass the held reservation; confirmed stop or
settlement restores admission, otherwise operator recovery is required. This is
implemented for the synthetic process-local boundary above, not a live-provider stop guarantee.

Before provider integration, settle broader fallback permission,
live speaker/consent events, deployment capacity/recovery ownership, and controlled
speech capability. The bounded Workflow admission/persistence and deadline
decisions above and the 30-second result TTL are implemented; audio buffering and call lifetime limits
belong to the later adapter and delivery slices.
The [ordered slices](../proposals/realtime-talker-reasoner.md#small-follow-up-sequence)
assign identity, asynchronous delivery, gating and adapter work to #558.
[#559](https://github.com/footnote-ai/footnote/issues/559) must separately approve
cross-surface consent, retention/deletion and historical playback policy.

Provider feasibility is unverified in Footnote: the operator reports an
OpenRouter key and no direct OpenAI key. No credentials, provider availability,
voice audition, audio quality, latency, or savings were tested in this pass.
Use fake runtimes/deferred Runs first; any later paid experiment needs separate
authorization. No new umbrella issues are needed.
