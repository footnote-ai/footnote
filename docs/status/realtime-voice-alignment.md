# Realtime Voice alignment

Updated: 2026-10-31. PR #965 adds synthetic Standard and Live voice paths to the
earlier call-state, Workflow and controlled-delivery slices. Owner:
[#558](https://github.com/footnote-ai/footnote/issues/558), still open.

This page tracks what the code does and which tests cover it. PR #965 connects
Discord Standard and Live modes to the bounded Workflow and approval state.
Synthetic tests cover the adapters and call path; live provider use and real
Discord playback remain unverified. The [architecture guide](../architecture/realtime-voice.md)
describes the current modes, while the [Talker–Reasoner proposal](../proposals/realtime-talker-reasoner.md)
tracks remaining evaluation and consent work.

## Alignment matrix

| Area                      | Current implementation in PR #965                                                                                                                                                                                                            | Evidence / remaining limit                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Standard                  | OpenRouter transcription → existing Workflow → approved exact-text synthesis; Discord streams PCM and reports local playback state.                                                                                                          | Backend adapter/handler and Discord synthetic tests. Paid provider behavior, usage completeness and human audibility are unverified.                 |
| Live                      | Backend-owned GPT-Live session accepts only the initiating caller's audio. Client delegation is matched to bounded transcript context and current turn before starting the same Workflow; only an approved result is appended as commentary. | Synthetic WebSocket and handler tests. Transcript timing, independent model speech, paraphrase, provider retention, cost and latency are unverified. |
| Selection and limits      | `/call mode` selects standard/live; `VOICE_DEFAULT_MODE` supplies the default. Calls are 60 seconds; configured developer may request five minutes. One human is admitted.                                                                   | Config, command and handler tests. Deployment configuration and real Discord participant events remain unverified.                                   |
| Interruption and playback | Caller audio interrupts local playback; disconnect, caller mute/deafen/leave, or another human joining closes the call. Standard reports local start/end/failure; Live audio has no reviewed-text delivery receipt.                          | Discord synthetic tests. Local playback state cannot prove a listener heard audio or remote generation stopped.                                      |
| Privacy and capacity      | Transcript and audio remain transient; call closes clear state and cancel/revoke local work. Process-local Workflow capacity remains occupied until work settles. Provider failure does not switch modes.                                    | Backend privacy/cancellation tests. Provider retention and deployment recovery are unverified.                                                       |

The detailed matrix below records the pre-PR #965 baseline through #964. Its
older `Gap` entries are historical and are superseded by the current matrix
above; remaining work is listed after the foundation sections.

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
| Interruptions and delivery         | HTTP disconnect requests cancellation; provider/tool stop is not guaranteed.                                                                                                               | **Implemented, synthetic only:** Standard reports local playback state and stops on interruption; Live interruption is forwarded to GPT-Live and Discord stops active playback. Live commentary append is only a handoff; its generated audio has no exact-text delivery receipt. Local closure does not confirm remote generation or billing stopped.                                                                                                                                | [voice types](../../packages/contracts/src/voice/types.ts), `backend/src/handlers/internalVoiceRealtime.ts`, `discord-bot/src/realtime/RealtimeEventHandler.ts`, `discord-bot/src/voice/AudioPlaybackHandler.ts`                                                                                                                                                   | #558: distinguish Run completion, commentary handoff, observed playback, supersession and cancellation.                                                 |
| Provider capability                | Generation adapter supports configured text providers. Provider/model facts and adapter support must both be known.                                                                        | **Implemented with separate modes:** Standard uses OpenRouter transcription/TTS around the existing Workflow; Live uses a backend-owned GPT-Live session with Workflow delegation. The exported legacy `RealtimeVoiceRuntime` adapter remains package-tested but is not wired into `/call`; missing GPT-Live fails closed.                                                                                                                                                            | `agent-runtime/src/index.ts`, `backend/src/server.ts`, `backend/src/handlers/internalVoiceRealtime.ts`, `contracts/src/voice/types.ts`; [provider research](../proposals/realtime-talker-reasoner.md#provider-feasibility-is-a-separate-decision)                                                                                                                  | #558 minimal capability-driven boundary; separate bounded provider evaluation after approval.                                                           |
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

This is the maintained alignment matrix following #803/#846. The older context
proposal's segment/cache design is not a working conversation store; see its
[implementation note](../proposals/conversation_context_boundary.md#implementation-and-realtime-follow-up).

## Call-state foundation

`backend/src/services/realtimeConversationState.ts` holds one call's transient
state beside the existing session correlation. It reuses
`projectConversationMessages` and the conversation envelope; text-chat assembly
and Run/Trace records are unchanged. PR #965 connects one-caller Live transcript
and delegation events to this state; Standard finalizes caller turns after STT.

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
Background Workflow execution and answer staging are covered below. Live
speech delivery is still separate.

## Synthetic Workflow execution

`RealtimeConversationState.startExecution` reserves one process-wide slot before
dispatching `chatOrchestrator.runRealtimeConversation`. That backend-only entry
uses `runChat` and the existing policy, planner, Context Integrations and Workflow
over the accepted projection. It does not call the public chat HTTP endpoint.
PR #965 invokes it from Standard after transcription and from Live only after
matching a client delegation to bounded transcript context and the current turn.

- Completion requires an explicit receipt with response and canonical Run IDs,
  issued only after storage succeeds. Missing receipts/status and storage failures
  fail closed for voice; ordinary text storage keeps its existing fail-open behavior.
- Canonical Workflow execution is required even in `express` mode. Voice Workflow
  uses the configured generation runtime and model profiles. Intercepted real
  VoltAgent/AI SDK OpenRouter and OpenAI tests, including direct OpenAI structured
  planning, cover generation, assessment, exact approved selection, usage and
  SQLite receipts. They verify canonical content exclusions with Footnote debug
  opt-in enabled, inherited debug-session bypass, and canonical label filtering
  on success and failure. Recognized normalized model identities are retained.
- Canonical storage and operator-accessible SDK diagnostics have separate
  boundaries; see the [data-handling contract](../architecture/realtime-voice.md#voice-data-handling).
  Provider retention and configured diagnostic exports have not been verified
  with live providers.
- Execution admits text answers and only `weather_forecast` and `web_search`.
  Executor selection denies every other integration, including registry and
  fallback executors. Provider-native search is disabled at the runtime boundary;
  integration hints cannot widen the scope. Planner terminal actions, including
  reactions, images, silence and TTS, are denied before continuation execution.
- The backend establishes the Voice scope; requests and planner output cannot
  set it. Voice does not inherit a text session ID, account memories, attachments
  or private retrieval. Turn IDs survive context trimming. The Workflow receives
  its Run ID when it starts and its response ID when metadata is assembled.
- Voice records store only approved fields: Run/Step/Attempt/Result IDs, status,
  timing, usage, cost, limits and validated machine decisions. They exclude
  planner and review prose, retrieval queries and bodies, citations, candidates,
  publication tokens, model debug output and free-form logs. The same rules apply
  when a tool ends the Workflow early. Public Trace does not expose the call's
  session or initiating-turn ID.
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

The pending-work limit belongs to the backend process, so reconnecting to that
process does not reset it. Multi-process coordination and restart recovery still
need work before live use. Restarting the server does not prove that a remote
request stopped or that billing ended. This is not a durable job queue.

`backend/test/realtimeWorkflowExecution.test.ts` uses deferred promises, fake
clocks, synthetic events and a truly never-settling Run. Other tests exercise the real orchestrator with intercepted provider calls and
a temporary SQLite database. Operator tests check authentication, privacy and
degraded-state inspection. Completed-execution inspection exposes only IDs,
status and review disposition. Approved text stays in the delivery slot.

## Final-response approval and staging

The [architecture mapping](../architecture/realtime-voice.md#final-response-approval-and-staging)
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

Backend and Discord tests cover answer approval, handoff, playback-report
ordering, local playback and interruption. Provider events and audio are
connected through synthetic adapters; no real provider/Discord call has been
verified. A playback report cannot prove a listener heard the answer or that
delivery happened exactly once. Unassessed or unresolved fallback answers
remain ineligible for Standard speech.

## Voice modes and remaining gates

PR #965 implements both speech paths around one shared Workflow. Standard is
the default: OpenRouter transcribes, Workflow reviews, then OpenRouter TTS
synthesizes only the approved exact text. Live is opt-in: OpenAI GPT-Live handles
conversation and client delegation, while Footnote invokes the same Workflow
and appends only an approved result as commentary. GPT-Live may speak on its own
or paraphrase a reviewed answer; that is not exact approved playback.

The `/call` mode option and `VOICE_DEFAULT_MODE` select standard/live before
connection. Calls have a 60-second default cap and configured developer-only
five-minute override. The call cap is distinct from the 60-second Workflow
execution deadline. Only the initiating human's audio is forwarded; another
human joining or the caller muting, deafening or leaving closes the session.
The older OpenAI Realtime path remains as a compatibility/test fallback, not a
silent provider or mode fallback.

`voice.max-answer-tokens` defaults to 160 and sets a per-answer delivery ceiling
separate from generation tokens. A provider-neutral estimate handles Unicode
without English word splitting; provider headroom caps Live at 400 estimated
tokens and Standard at 1,600 estimated tokens plus 3,686 code points. Generation
keeps the selected TRACE posture, and over-limit answers receive
`answer_too_long` without a delivery handoff. The estimate is not exact
provider-token accounting. Intelligent answer condensation is deliberately
deferred to [#968](https://github.com/footnote-ai/footnote/issues/968) and is not
required to review or merge #965.

Tests use synthetic providers. Live credentials, deployment configuration,
provider retention, transcript timing, latency, voice quality, usage/cost
completeness and real Discord playback have not been verified. Multi-person
consent and history transfer belong to #559.

## Remaining decisions and gates

The single-call ephemeral scope, one pending Run handle, one result slot,
freshness/approval gates and controlled Standard speech are connected in PR #965.
Live commentary remains a model-mediated presentation and is not proof of the
exact approved words reaching a listener. No general conversation coordinator
was added.

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

Before paid/live rollout, verify provider behavior and retention, deployment
capacity/recovery ownership and local playback on real Discord. The bounded
Workflow admission/persistence, 30-second result TTL, audio path and call
lifetime limits are implemented with synthetic evidence.
The [ordered slices](../proposals/realtime-talker-reasoner.md#small-follow-up-sequence)
assign identity, asynchronous delivery, gating and adapter work to #558.
[#559](https://github.com/footnote-ai/footnote/issues/559) must separately approve
cross-surface consent, retention/deletion and historical playback policy.

Provider behavior is unverified in Footnote. OpenRouter STT/TTS and OpenAI
GPT-Live client delegation have synthetic adapter tests, but no live audio,
latency, voice quality, retention or complete cost measurement has been checked.
Paid experiments need separate approval.
