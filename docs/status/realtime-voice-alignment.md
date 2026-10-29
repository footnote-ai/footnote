# Realtime Voice alignment

Updated: 2026-10-29. Baseline: `d072a85695185aed57048789c6c8cf2ec08dde67`
on `main`, including merged #955 and #959, plus the synthetic call-state slice below. Owner:
[#558](https://github.com/footnote-ai/footnote/issues/558), still open.

This tracker records source/test evidence, not live-provider validation. Update
the affected rows and evidence with each implementation PR. Keep proposals
separate from implemented behavior. The
[current architecture](../architecture/realtime-voice.md) describes transport;
the [Talker–Reasoner proposal](../proposals/realtime-talker-reasoner.md) describes
the broader design. Its first call-state slice now has synthetic implementation;
provider and Workflow integration remain proposed.

## Alignment matrix

Paths in the evidence column are relative to `packages/`.
"Implemented" means present in code. Synthetic call-state tests exercise the new
foundation without a provider; they do not establish live voice behavior.
"Gap" means implementation is still required.

| Area                               | Ordinary chat baseline                                                                                                                                                                     | Realtime baseline / classification                                                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                                                                                                                                                                                                                                                           | Owner / next work                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation projection            | Normalization builds role-aligned messages plus participant/turn/visibility/authority metadata; recent windows retain 12 web / 24 Discord non-system messages.                             | **Implemented, synthetic only:** bounded call-local turns reuse the existing message projection and envelope after audience/consent checks. **Gap:** live provider input still has only startup roster and optional summary strings; finalized turn events are not connected.                                                                                                                                                 | [conversationContextService.ts](../../packages/backend/src/services/conversationContextService.ts), [requestNormalization.ts](../../packages/backend/src/services/chatOrchestrator/requestNormalization.ts), [realtimePromptComposer.ts](../../packages/backend/src/services/prompts/realtimePromptComposer.ts); `backend/test/conversationContextService.test.ts` | #558 reuse projection; #559 governs transfer/retention.                                                                                                 |
| Identity and correlation           | `sessionId` maps to correlation `conversationId`; web keeps a component-local ID. Neither is a durable conversation entity.                                                                | **Implemented:** each response has a canonical Run, one Generate Step, provider Attempt and bounded Result; a private random session ID joins Runs. **Implemented, synthetic only:** stable call-local turn IDs and intent revisions share the private session correlation. **Gap:** live user-turn, reasoning-result and audible-delivery correlation.                                                                       | [internalVoiceRealtime.ts](../../packages/backend/src/handlers/internalVoiceRealtime.ts); `backend/test/internalVoiceRealtimeHandler.test.ts` (distinct Runs, shared private correlation, disconnect idempotence)                                                                                                                                                  | #878 landed; #558 extends correlation locally; #559 owns cross-surface IDs.                                                                             |
| Async execution                    | `runChat` awaits the existing workflow and returns a final response; AbortSignal propagates to supported operations. This is not a durable background-job API.                             | **Gap:** provider streaming is asynchronous, but no Workflow invocation or background Run-to-call delivery exists.                                                                                                                                                                                                                                                                                                            | [chatOrchestrator.ts](../../packages/backend/src/services/chatOrchestrator.ts), [reviewedChatWorkflow.ts](../../packages/backend/src/services/workflowCore/reviewedChatWorkflow.ts), `backend/src/handlers/chat.ts`; [runtime interface](../../packages/agent-runtime/src/index.ts)                                                                                | #558: one pending handle and delivery slot, not another engine.                                                                                         |
| Review, policy, breakers           | Existing workflow applies Execution Contract limits, conditional assessment, revision, and fail-open outcomes; a named Result or completed Run is not necessarily assessed/approved.       | **Gap:** direct provider answers bypass that workflow/review path. Recording a Generate Run does not add review evidence.                                                                                                                                                                                                                                                                                                     | `backend/src/services/workflowEngine/limits.ts`, `backend/src/services/workflowEngine/reviewDecision.ts`, `backend/src/services/workflowCore/reviewedChatWorkflow.ts`, `backend/src/handlers/internalVoiceRealtime.ts`                                                                                                                                             | #558 explicit speech eligibility; [#709](https://github.com/footnote-ai/footnote/issues/709) is closed for its tested boundaries, not voice coverage.   |
| Retrieval and source reporting     | Context Integrations execute bounded lookups; `buildModelInput` projects evidence as advisory user data with a generation-context manifest. Revision-aware `github_source` is implemented. | **Gap:** Realtime has no integration execution, source manifest, or reviewed retrieval-result injection.                                                                                                                                                                                                                                                                                                                      | [Context Integrations](../architecture/context-integrations/README.md), [GitHub source retrieval](../architecture/context-integrations/github.md), [modelInput.ts](../../packages/backend/src/services/workflowEngine/modelInput.ts)                                                                                                                               | #558 reuse workflow; [#539](https://github.com/footnote-ai/footnote/issues/539) is closed. Its completion does not establish voice retrieval.           |
| Profile and speech selection       | Request/profile resolution and overlays; backend TTS selects effective model/voice/delivery.                                                                                               | **Implemented shared selection; intentional profile difference:** Realtime uses configured `runtimeConfig.profile`, not chat request profile resolution. Precedence is request/session → operator profile → deployment fallback. Invalid explicit choices are rejected; unsupported configured settings can fall back per setting.                                                                                            | [speechPresentation.ts](../../packages/backend/src/services/speechPresentation.ts), [internalVoiceTts.ts](../../packages/backend/src/services/internalVoiceTts.ts), `backend/test/speechPresentation.test.ts`, `backend/test/internalVoiceTtsService.test.ts`, `backend/test/internalVoiceRealtimeHandler.test.ts`                                                 | #831 landed. [#534](https://github.com/footnote-ai/footnote/issues/534) still owns human audition/default selection; no bundled voices assumed settled. |
| Audio, attention, speaker identity | Text input is attributed by surface metadata. Generated playback synthesizes supplied text rather than continuing a voice session.                                                         | **Intentional difference:** Discord captures/resamples speaker streams, injects silence tails for server VAD, and immediately streams playback. **Gap:** audio labels/IDs reach the backend but adapter audio append sends only bytes; text injection adds a label. No proven multi-speaker attribution or safe delivery window.                                                                                              | `discord-bot/src/voice/AudioCaptureHandler.ts`, `VoiceSessionManager.ts`, `AudioPlaybackHandler.ts`; [OpenAI adapter](../../packages/agent-runtime/src/openAiRealtimeVoiceRuntime.ts); `discord-bot/test/realtimeStreaming.test.ts`, `voiceSessionManager.test.ts`                                                                                                 | #558 normalized attention/input events; #559 participant/consent lifecycle.                                                                             |
| Interruptions and delivery         | HTTP disconnect requests cancellation; provider/tool stop is not guaranteed.                                                                                                               | **Gap:** VAD can auto-create/interrupt provider responses, but normalized contract lacks speech-start/stop, finalized transcript, explicit output cancellation/truncation, approved-result update, and local playback acknowledgement. Provider `response.done` is not audible delivery.                                                                                                                                      | [voice types](../../packages/contracts/src/voice/types.ts), `agent-runtime/src/openAiRealtimeVoiceRuntime.ts`, `discord-bot/src/realtime/RealtimeEventHandler.ts`, `discord-bot/src/voice/AudioPlaybackHandler.ts`                                                                                                                                                 | #558: distinguish Run completion, delivery, partial playback, supersession and cancellation.                                                            |
| Provider capability                | Generation adapter supports configured text providers. Provider/model facts and adapter support must both be known.                                                                        | **Intentional distinct runtime:** `RealtimeVoiceRuntime` has `createSession`, `send`, `onEvent`, `close`; server constructs only OpenAI Realtime, gated by a direct OpenAI key. **Gap:** some generic VAD options still use OpenAI enums. OpenRouter audio HTTP/SSE is not proof of persistent Realtime.                                                                                                                      | `agent-runtime/src/index.ts`, `backend/src/server.ts`, `contracts/src/voice/types.ts`; [provider research](../proposals/realtime-talker-reasoner.md#provider-feasibility-is-a-separate-decision)                                                                                                                                                                   | #558 minimal capability-driven boundary; separate bounded provider evaluation after approval.                                                           |
| Provenance and inspection          | Run → Step → Attempt → Result evidence feeds backend Trace/operator projections.                                                                                                           | **Implemented:** metadata-only response Runs include speech/provider selection, timing, available usage/cost; execution report exposes private session correlation. Public projection omits correlation/effective voice settings. **Gap:** no Reasoner-result→speech delivery relationship.                                                                                                                                   | `backend/src/server.ts`, `backend/src/storage/traces/traceDisplayProjection.ts`; `backend/test/internalVoiceRealtimeHandler.test.ts`, `traceDisplayProjection.test.ts`, `operatorExecutionHandler.test.ts`                                                                                                                                                         | #878 landed; #558 reuse evidence without publishing call details.                                                                                       |
| Usage and cost                     | #955 adds provider-neutral text cache policy, measurements, cost completeness and read/write/reasoning accounting where reported. Explicit caching remains disabled by default.            | **Implemented with limits:** only optional aggregate prompt/completion counts, model/time/cost fields. Backend estimates/records cost only with both counts; absent differs from reported zero. No normalized cache, reasoning, or audio/text token breakdown.                                                                                                                                                                | `agent-runtime/src/openAiRealtimeVoiceRuntime.ts`, `backend/src/handlers/internalVoiceRealtime.ts`, `backend/src/services/llmCostRecorder.ts`; [cache status](./prompt-caching-status.md)                                                                                                                                                                          | #838/#955 landed; #558 richer voice evidence. #552/#957 own cache economics; no demonstrated incremental savings.                                       |
| Privacy and availability           | Text has explicit history/account-memory/trace paths; voice is optional to chat.                                                                                                           | **Implemented:** no transcript/audio/response bodies in Realtime Run persistence; #842 removes response/greeting text logging. **Implemented, synthetic only:** participant/consent changes discard retained context and invalidate freshness; close clears call state. **Gap:** live consent events, durable consent/session policy and continuity. Provider session failure ends voice; it does not silently retry as text. | `discord-bot/src/events/VoiceSubsystem.ts`, `discord-bot/test/loggingPrivacy.test.ts`, `backend/src/handlers/internalVoiceRealtime.ts`, `discord-bot/src/events/VoiceStateHandler.ts`                                                                                                                                                                              | #558 preserve content-free evidence and fail-open text availability; #559 decides retention/transfer.                                                   |

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
- Interruptions hold delivery while preserving the reasoning revision. An explicit
  attributed continuation resumes it. Closing is idempotent, clears retained content, and
  rejects later turns.

`backend/test/realtimeConversationState.test.ts` exercises these rules with
synthetic turns and participant events. This slice adds no provider connection,
Workflow invocation, speech delivery, transcript persistence, memory, or
cross-session continuity. The next slice needs an answer-only/read-only Workflow
admission boundary, voice-safe persistence, and one pending execution handle;
final-result approval and controlled speech remain separate gates.

## Proposed decisions and remaining gates

The proposal recommends a single-call ephemeral scope, one pending Run handle,
one result slot, explicit freshness/approval gates, and controlled speech of
approved text. The ephemeral call-state foundation below is implemented in
isolation. Pending execution, result approval, and speech delivery remain proposed.
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
proposed behavior awaiting implementation, not an existing watchdog guarantee.

Before Workflow or provider integration, settle the exact final-review eligibility mapping,
voice-safe persistence exclusions and answer-only/read-only action admission
when reusing chat services, in-call speaker and audience rules, numeric resource
limits, and controlled speech capability.
The [ordered slices](../proposals/realtime-talker-reasoner.md#small-follow-up-sequence)
assign identity, asynchronous delivery, gating and adapter work to #558.
[#559](https://github.com/footnote-ai/footnote/issues/559) must separately approve
cross-surface consent, retention/deletion and historical playback policy.

Provider feasibility is unverified in Footnote: the operator reports an
OpenRouter key and no direct OpenAI key. No credentials, provider availability,
voice audition, audio quality, latency, or savings were tested in this pass.
Use fake runtimes/deferred Runs first; any later paid experiment needs separate
authorization. No new umbrella issues are needed.
