# Realtime Voice System

## Summary

The realtime voice system is the part of Footnote that lets the Discord bot have a live spoken conversation in a voice channel.

At a high level, the Discord bot handles the Discord-specific work: joining the channel, listening for speech, and playing audio back into the room. The backend handles the AI-specific work: building instructions, opening the provider session, translating provider events, and recording usage.

That split is the main point of the design. The bot does not talk to the OpenAI realtime API directly. It opens a trusted websocket to Footnote's backend at `/api/internal/voice/realtime`, and the backend owns the provider connection from there.

## High-Level Flow

```mermaid
sequenceDiagram
    participant User as User in Discord
    participant VoiceState as VoiceStateHandler
    participant Session as RealtimeSession
    participant Capture as AudioCaptureHandler
    participant Manager as VoiceSessionManager
    participant Backend as /api/internal/voice/realtime
    participant Prompt as Realtime prompt composer
    participant Runtime as OpenAI realtime runtime
    participant OpenAI as OpenAI realtime websocket
    participant Events as RealtimeEventHandler
    participant Playback as AudioPlaybackHandler

    User->>VoiceState: Starts /call and joins voice
    VoiceState->>Session: Start realtime session
    Session->>Backend: session.start
    Backend->>Prompt: Build instructions
    Prompt-->>Backend: Instructions
    Backend->>Runtime: Open provider session
    Runtime->>OpenAI: session.update

    loop User turn
        User->>Capture: Speaks
        Capture->>Manager: PCM chunks
        Manager->>Session: input_audio.append
        Session->>Backend: Forward audio
        Backend->>Runtime: Forward audio
        Runtime->>OpenAI: Append input audio
        Capture-->>Manager: speakerSilence
        Manager-->>Session: Optional silence tail for server VAD
    end

    OpenAI-->>Runtime: Audio + text + completion events
    Runtime-->>Backend: Normalized realtime events
    Backend-->>Session: Forwarded realtime events
    Session-->>Events: Output events
    Events-->>Playback: Audio deltas
    Playback-->>User: Spoken reply
    Events-->>VoiceState: response.done / errors
```

## Settings

These are the main settings that change realtime voice behavior.

| Setting                           | Default             | Allowed Values                                                                               | Purpose                                                                                                                              |
| --------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `REALTIME_DEFAULT_MODEL`          | `gpt-realtime-mini` | Enum (valid realtime model IDs from the shared provider catalog)                             | Default provider model for realtime voice sessions.                                                                                  |
| `REALTIME_DEFAULT_VOICE`          | `echo`              | Enum (`alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`) | Default output voice when a call does not override it.                                                                               |
| `REALTIME_GREETING`               | `Hey, {bot} here.`  | String (non-empty, supports `{bot}`)                                                         | Greeting text sent when the session starts.                                                                                          |
| `REALTIME_TURN_DETECTION`         | `server_vad`        | Enum (`server_vad`, `semantic_vad`)                                                          | Selects provider-side turn handling strategy.                                                                                        |
| `REALTIME_VAD_THRESHOLD`          | provider default    | Number (`0`-`1`)                                                                             | Optional server VAD sensitivity threshold.                                                                                           |
| `REALTIME_VAD_SILENCE_MS`         | provider default    | Integer (`>= 0`)                                                                             | Optional provider silence window used to close a turn. Also used by Discord-side silence-tail injection when `server_vad` is active. |
| `REALTIME_VAD_PREFIX_MS`          | provider default    | Integer (`>= 0`)                                                                             | Optional provider prefix padding so the provider keeps some audio before speech start.                                               |
| `REALTIME_VAD_CREATE_RESPONSE`    | provider default    | Boolean (`true` or `false`)                                                                  | When true, provider auto-creates a response after a detected turn.                                                                   |
| `REALTIME_VAD_INTERRUPT_RESPONSE` | provider default    | Boolean (`true` or `false`)                                                                  | When true, new user speech can interrupt an in-flight response.                                                                      |
| `REALTIME_VAD_EAGERNESS`          | provider default    | Enum (`low`, `medium`, `high`, `auto`)                                                       | Optional semantic VAD eagerness for `semantic_vad`.                                                                                  |
| `/call voice`                     | per-call override   | Enum (same values as `REALTIME_DEFAULT_VOICE`)                                               | Overrides the default voice for one call session.                                                                                    |

## System Breakdown

## 1. Discord Entry and Session Start

The Discord entrypoint is the `/call` slash command in [call.ts](../../packages/discord-bot/src/commands/call.ts). That command joins the target voice channel, records the initiating user, and optionally records a per-call voice override.

The actual realtime session does not start just because the bot joined the channel. The bot waits for the initiating user to join and start the conversation. That orchestration lives in [VoiceStateHandler.ts](../../packages/discord-bot/src/events/VoiceStateHandler.ts).

When conversation start is triggered, `VoiceStateHandler`:

- builds participant context
- creates the Discord-side realtime session wrapper
- attaches audio playback listeners
- initializes Discord audio capture
- sends the configured greeting

This keeps the session lifecycle tied to real human participation instead of opening a provider session while the bot is sitting alone in a voice channel.

## 2. Discord-Side Realtime Session

The Discord-side session wrapper lives in [realtimeService.ts](../../packages/discord-bot/src/utils/realtimeService.ts). Its job is to hide the backend websocket protocol from the rest of the Discord bot.

This layer:

- connects to the trusted backend websocket
- sends `session.start` with voice options and participant context
- streams PCM audio as `input_audio.append`
- sends greeting and other text turns
- normalizes backend events into local audio/text/completion events

This is intentionally not the provider boundary. It is only the Discord-to-backend transport layer.

## 3. Audio Capture and Turn Closing

Discord audio capture lives in [AudioCaptureHandler.ts](../../packages/discord-bot/src/voice/AudioCaptureHandler.ts). It subscribes to Discord voice receiver streams, decodes Opus to PCM, resamples the audio, and emits `audioChunk` events to the session manager.

Discord voice activity mode can stop sending audio immediately when the user stops speaking. That means the provider may not observe enough trailing silence to close a turn on its own.

To compensate, [VoiceSessionManager.ts](../../packages/discord-bot/src/voice/VoiceSessionManager.ts) listens for `speakerSilence` events and appends a short silence tail when `server_vad` is active. The silence length is derived from `REALTIME_VAD_SILENCE_MS`, clamped to a safe range. That design lets provider-side VAD stay authoritative while adapting to Discord's voice-activity behavior.

The invariant is simple: Discord streams audio continuously while the user is speaking, but the provider still decides when the turn is complete.

## 4. Backend Trusted Boundary

The backend websocket handler lives in [internalVoiceRealtime.ts](../../packages/backend/src/handlers/internalVoiceRealtime.ts). This is Footnote's trusted internal boundary for Discord realtime sessions.

Its responsibilities are:

- authenticate the trusted websocket upgrade
- validate client events against `@footnote/contracts/voice`
- create and own one backend realtime session
- forward normalized events back to Discord
- record backend-owned usage and cost data on `response.done`

This is the main architectural seam. If the Discord bot needs realtime voice, it goes through this handler instead of opening a provider websocket directly.

## 5. Prompt Composition

Realtime prompt composition lives in [realtimePromptComposer.ts](../../packages/backend/src/services/prompts/realtimePromptComposer.ts). The backend builds one instruction string for the provider session using:

- the shared conversational system layer
- the realtime voice surface layer
- one active persona layer (profile overlay when present, otherwise shared Footnote persona plus the realtime persona supplement)
- the current participant roster
- optional recent transcript summary

Realtime reuses the shared prompt-layer renderer and profile-overlay formatter, but it does not use normal chat's full request context, Context Steps, or model-input assembly. Its active profile is the backend's configured bot profile for the session.

## 6. Provider Runtime Adapter

The provider adapter lives in [openAiRealtimeVoiceRuntime.ts](../../packages/agent-runtime/src/openAiRealtimeVoiceRuntime.ts). This adapter is responsible for:

- opening the OpenAI realtime websocket
- sending the initial `session.update`
- applying the configured voice and turn-detection settings
- waiting for the provider session to become ready
- translating provider events into Footnote-owned normalized events

This is the only place that should know the provider websocket details for realtime voice. Discord and the backend boundary work in Footnote-owned contracts, not provider-native payloads.

## 7. Event Return Path and Playback

Provider events are normalized by the runtime, forwarded through the backend websocket handler, and consumed by Discord's realtime event layer in [RealtimeEventHandler.ts](../../packages/discord-bot/src/realtime/RealtimeEventHandler.ts).

That event layer emits streamed audio chunks immediately so playback can begin before the full response completes. Playback is then handled by [AudioPlaybackHandler.ts](../../packages/discord-bot/src/voice/AudioPlaybackHandler.ts), which keeps a guild-local playback pipeline alive long enough to avoid clipping between chunks or turns.

The result is a streamed path in both directions:

- user audio goes Discord -> backend -> provider
- model audio goes provider -> backend -> Discord playback

## 8. Observability and Logging

Realtime voice uses structured logging across Discord, backend, and runtime layers. The logging favors:

- session lifecycle logs
- speaking start/end signals
- response completion logs
- warnings and errors

It avoids noisy per-chunk logs and keeps the default debug output focused on lifecycle and failure signals.

The backend remains the authoritative owner of realtime usage and cost recording. Discord may display or log completion metadata, but provider cost accounting is backend-owned.

## 9. Design Constraints

The current system is built around a few explicit constraints:

- Discord owns Discord UX, not provider session semantics.
- Backend owns the trusted voice control-plane boundary.
- Provider-specific websocket logic stays inside the runtime adapter.
- Server VAD remains authoritative for turn completion in the normal path.
- Discord voice-activity behavior is accommodated with silence-tail injection instead of moving turn closure back into Discord logic.

That gives realtime voice the same ownership story as the rest of the migration work: product-facing code uses Footnote-owned boundaries, and provider-specific behavior sits behind those boundaries.

## Alignment with normal chat

Realtime is a separate streaming session, not another route through
`POST /api/chat`. The maintained [alignment tracker](../status/realtime-voice-alignment.md)
records implemented behavior, intentional differences, gaps, evidence, and issue
ownership relative to ordinary chat.

The proposed [conversation with background reasoning](../proposals/realtime-talker-reasoner.md)
reuses the existing Workflow and conversation projection boundaries. It is a
proposal under #558. Backend-local call state and background Workflow execution
now have synthetic implementation, using the existing orchestrator with enforced
answer/read-only scope and content-free execution records. Final-response approval
and one ephemeral delivery slot are also implemented; live provider events and
speech delivery remain disconnected. A process-owned reservation
survives call teardown; its 60-second deadline and 5-second cancellation watchdog
make unresolved work observably degraded without releasing capacity.
Voice admission fails closed unless the runtime guarantees no content retention;
the current VoltAgent adapter cannot provide that guarantee and remains blocked.
The tracker describes process-local and deployment-recovery limits. Cross-surface
continuity, consent, and retention remain under #559.

## Final-response approval and staging (synthetic only)

Workflow completion and voice delivery are separate decisions. The backend uses
the existing candidate selection, assessment signals and named Result references
in `realtimeWorkflowScope.ts`. `chatService.ts` supplies the normalized selected
text before discarding candidate bodies; `chatOrchestrator.ts` checks it against
the response actually returned by `runChat`. Ordinary text-chat behavior is unchanged.

The receipt becomes available only after metadata persistence succeeds. Approval
requires one selected candidate from a Generate or revision Step, an exact text
match, its produced `draft` Result and candidate artifact link, and the final
successful Assess Step consuming that same draft. The assessment must have a
produced `review` Result and say `finalize`. The Run and Workflow must both be
completed with `goal_satisfied`. Approval means that assessment accepted the text;
it does not certify factual truth or provider privacy.

| Observed evidence                                              | Voice disposition        |
| -------------------------------------------------------------- | ------------------------ |
| Selected final draft with all required evidence                | `approved`               |
| No assessment, including assessment skipped by mode/policy     | `unassessed`             |
| Failed, unparseable or incomplete assessment evidence          | `assessment_failed`      |
| Last assessment asks for revision                              | `revision_requested`     |
| Last assessment asks for more retrieval                        | `search_requested`       |
| Missing/ambiguous candidate selection, text or draft linkage   | `selection_unverified`   |
| Finalized draft but Run/Workflow did not complete successfully | `workflow_not_completed` |
| Non-answer, terminal action or unsupported candidate stage     | `unsupported_response`   |

Only `approved` carries text. These dispositions do not replace Run status or
Workflow termination reasons. A revision needs its own final assessment; an
earlier accepted draft cannot approve later text. Budget-limited, failed and
fail-open paths retain their actual evidence and cannot authorize an answer.
Tool clarification and status copy do not enter this reviewed-answer slot.
Whether any unassessed or unresolved fallback should later be spoken remains
unresolved; this implementation withholds it. Trace alignment describes metadata
alignment, not a second content approval decision.

`RealtimeConversationState` holds at most one answer, bounded to 16 KiB of UTF-8
text and **30 seconds from staging**. It binds the initiating turn, intent revision,
call instance, private session ID, audience IDs, Run, response, candidate and
assessment/generation Steps. `completedExecution()` exposes only identity, Run
status and disposition. `takeDelivery(handle)` rechecks current intent, instance,
session, audience consent and expiry, then consumes the slot once. It is an
internal backend seam, not a transport event or proof of audible playback.

Interruptions and ambiguous user input discard the slot and revoke that
execution's ability to stage later text, while reasoning may continue. An explicit
continuation resumes intent but cannot restore revoked speech; a new question is
needed. Corrections, cancellation, roster/consent changes and disconnect also
discard the slot. Captured execution revisions and a delivery revocation counter
prevent late callbacks from restoring it. Expiration clears the body and leaves
the completed Run outcome intact. Cancellation remains a request until settlement;
it does not prove remote work or billing stopped.

Future playback code must take the answer at its safe delivery boundary and
handle interruption after handoff; holding a returned object is not continuing
authorization. No provider, Talker, audio generation, playback acknowledgement,
durable delivery/replay, transcript retention, memory or public Trace extension
is implemented here. The existing VoltAgent tracing restriction, process-local
capacity and recovery gates remain in force.
