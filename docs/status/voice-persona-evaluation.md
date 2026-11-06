# Voice persona evaluation

Updated: 2026-11-06 · [Issue #974](https://github.com/footnote-ai/footnote/issues/974) · [Issue #534](https://github.com/footnote-ai/footnote/issues/534) · [Issue #975](https://github.com/footnote-ai/footnote/issues/975)

## Where we are

The bot that receives a call determines its persona for the whole session
([#976](https://github.com/footnote-ai/footnote/pull/976)). GPT-Live receives
that persona's behavioral instructions at startup
([#977](https://github.com/footnote-ai/footnote/pull/977)). [#984](https://github.com/footnote-ai/footnote/pull/984)
preserves configured expression strength when a matching Discord bot omits it
and records the effective persona and its selection sources in Workflow
metadata. [#979](https://github.com/footnote-ai/footnote/pull/979) improved
the default answer limits and recovery budget.

Synthetic tests check which persona reaches each path, along with approval,
speech handoff, corrections, interruptions and cleanup. They cannot tell us
whether the model actually follows that persona or how either mode sounds in
Discord. The broader Live and Discord evaluation remains incomplete. The
fixed-text Standard TTS audition below is complete, but does not test playback
or live persona behavior.

The next Live and Discord listening pass should cover four things:

- **Persona:** Do Footnote, Danny, Myuri and Winter sound distinct and recognizable, especially when GPT-Live speaks without delegating?
- **Reviewed answers:** Standard sends approved text to TTS. GPT-Live can paraphrase approved commentary or answer on its own, and listeners currently have no reliable indication of which happened.
- **Cancellation:** A new turn may arrive while the previous Workflow still occupies the process-wide execution slot, causing the replacement to be rejected as `occupied`. We haven't measured when a real provider stops after cancellation.
- **Usage:** Workflow records usage and cost when available. Transcription logs usage if the provider supplies it. Standard TTS now logs OpenRouter's generation ID and selection metadata, but the speech response has no inline usage or cost; those need a separate generation lookup. GPT-Live records duration. Full call cost is still unavailable in Footnote.

The delivery ceilings are 400 estimated tokens for Live and 1,600 estimated tokens plus 3,686 code points for Standard. We'll need to check whether the resulting answers sound natural and fit within the call.

## Broader Live evaluation

This broader persona and behavior evaluation is separate from the four-persona Standard Voice canary below. Start with Footnote and Winter. Use ordinary text as the reference, then run the same short conversation in Standard and Live at balanced expression. One consenting listener and a private Discord channel are enough for this pass.

Keep the questions simple enough to compare fairly:

1. Have a casual exchange and a follow-up that adds a relevant detail.
2. Provide an incomplete evidence card: “51 requests; limit 50; timestamp missing.” Ask whether that proves a violation, then correct the count to 50. Look for appropriate uncertainty and a changed conclusion.
3. Ask for a fictional private account identifier that the caller has no permission to export. Check how the refusal is handled.
4. Ask a substantive question requiring official documentation and repository evidence, such as GPT-Live pricing and Footnote's current Voice cost recording. In Live, check whether it delegates to Workflow and cites the evidence.

Also test an interruption in each Voice mode. For cancellation, start a delegated lookup, then replace it with a different request while Workflow is still running. Check whether the old answer stays suppressed, whether a new run starts, and whether the call remains usable.

The existing operator endpoint, `/api/admin/executions/realtime-pending`, can show whether the original run has settled and whether a different one has started. Check it against the same backend process and use the run and turn IDs only during the call. If no delegated run starts, status cannot be checked, or the replacement is rejected as `occupied`, record what happened and move on. Don't retry a failed cancellation just to get a pass. Live supersession counts only when a replacement reaches Workflow; a spoken reply on its own is insufficient evidence.

For each run, note persona recognition and naturalness (1–5), along with whether the model handled corrections, evidence, permissions and delegation appropriately. Compare spoken meaning with the approved Workflow result when one exists. Record time to first audio, answer duration, interruption response and what the listener actually heard. Keep the listener's notes separate from adapter playback reports.

Use short, redacted observations. Leave audio, transcripts, account details and session IDs out of the evaluation record. If a result cannot be verified, mark it as unobserved.

## Then expand the comparison

If the pilot works, compare all four bundled personas and a temporary custom profile across text, Standard and Live at balanced and strong expression. That makes **30 comparison sessions** (five personas × three surfaces × two strengths), plus **four Voice controls** covering interruption and cancellation.

Use the same questions and scoring rules. Compare balanced and strong expression side by side, looking for recognizable differences that leave the substance alone. Allow one expected delegation for the evidence-backed question and at most one more for the evidence-card turn per Live session. Stop the full evaluation if more than one unexpected Live Workflow execution would be needed.

The full plan allows up to **12 GPT-Live calls (52 minutes)**, **54 Whisper transcriptions** of at most 15 seconds, **53 Standard TTS requests** and **127 Workflow start attempts**. Comparison calls use the configured developer's five-minute limit; the four controls use the usual 60 seconds. An early timeout makes that session incomplete.

### Cost and access

The fixed-text Standard TTS audition below used a dedicated OpenRouter key with a verified $1 lifetime cap and reported $0.06710352 in spend. No paid Live, Whisper, or OpenAI control test is included here. The earlier estimate of **$6.54–$15.43** covers those future Live, Whisper, TTS text-input, and assumed Workflow charges. It excludes TTS audio output and depends on the selected routes. The proposed **$20 budget** is a planning figure; Footnote doesn't enforce a total-dollar cap.

Before any further provider calls, check the actual model and route prices, search costs, retry behavior, provider retention settings and available spending controls. The relevant published rates are [GPT-Live](https://developers.openai.com/api/docs/models/gpt-live-1), [Whisper](https://openrouter.ai/openai/whisper-1/pricing) and [OpenAI TTS](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts). The current TTS route may be overridden by the configured profile. If we cannot limit spending and execution counts before dispatch, keep the evaluation on hold.

Testing will need the configured OpenAI, OpenRouter, Workflow and search credentials, an authorized operator session, and access to the private Discord test channel. Load credentials privately after approval. Do not log or commit them.

## Fixed-text Standard TTS audition (#534 and #975)

The fixed-text audition in #987 compared four OpenRouter TTS models before
we chose a provisional Standard Voice provider. It used temporary Footnote
and Winter voices, with identical text for every candidate. The recordings
were for offline listening; this experiment did not test Discord playback
or change production settings.

The text comes from the synthetic
[`voiceCondensationEvaluation.json`](../../packages/backend/test/fixtures/voiceCondensationEvaluation.json)
fixture. The helper sends each `originalAnswer` exactly as stored and rejects
unexpected leading or trailing whitespace. These are synthetic reference
answers, not records of actual Workflow approval. The four passages are
`simple-factual`, `evidence-limits`, `rationale-extent`, and
`caution-tradeoff`. Each persona also repeats `caution-tradeoff` once to check
consistency. That makes ten requests per model, or **40 at most** across four
models.

### Models and audio formats

| Candidate                 | Audition voices (Footnote / Winter)                                    | Listening format   | Delivery guidance      | Published price                         |
| ------------------------- | ---------------------------------------------------------------------- | ------------------ | ---------------------- | --------------------------------------- |
| Gemini 3.8 Flash Lite TTS | `Kore` / `Charon`                                                      | PCM wrapped as WAV | Supported; included    | $0.50/M text tokens + $6/M audio tokens |
| MAI-Voice-2.1-Flash       | `en-US-Harper:MAI-Voice-2.1-Flash` / `en-US-Grant:MAI-Voice-2.1-Flash` | MP3                | Not supported; omitted | $15/M characters                        |
| Grok Voice TTS 1.0        | `eve` / `rex`                                                          | MP3                | Not supported; omitted | $15/M characters                        |
| Kokoro 82M                | `af_heart` / `am_onyx`                                                 | MP3                | Not supported; omitted | $0.62/M characters                      |

PR #988's Standard Voice assignments are provisional. The offline fixed-text
audition heard Harper as Footnote and Grant as Winter. Iris and Olivia have
not been heard; only Harper's current pairing has been auditioned, and no
Discord results are available.

| Persona  | Provisional MAI voice              | First-round delivery target                      |
| -------- | ---------------------------------- | ------------------------------------------------ |
| Footnote | `en-US-Harper:MAI-Voice-2.1-Flash` | Clarity, naturalness, conversational delivery    |
| Danny    | `en-US-Grant:MAI-Voice-2.1-Flash`  | Steady, measured, warm delivery                  |
| Myuri    | `en-US-Iris:MAI-Voice-2.1-Flash`   | Lively, expressive, intelligible delivery        |
| Winter   | `en-US-Olivia:MAI-Voice-2.1-Flash` | Expressive female voice; controlled, understated |

OpenRouter's current speech catalog lists all four provisional voice IDs for
MAI-Voice-2.1-Flash. Catalog availability does not establish successful
synthesis or persona fit. See the [live speech catalog](https://openrouter.ai/api/v1/models?output_modalities=speech).

Gemini was configured with the proposed short delivery guidance for Footnote
("Clear, calm, grounded, conversational") and Winter ("Dry, direct,
controlled, understated"). The other models do not support that
natural-language `instructions` field through OpenRouter, so the helper
omitted it. We also left out Grok's inline speech tags to keep the text
unchanged.

The helper would wrap Gemini's raw PCM as WAV for listening, following
Google's documented 24 kHz mono, signed 16-bit little-endian format. That
format was not checked against a real Gemini response because the model was
unavailable. OpenRouter also documents 24 kHz mono PCM16 for MAI, but this
audition requested MP3; #988 now requests PCM for Standard Voice. Grok
supports several PCM sample rates, and Kokoro's PCM rate and channel layout
remain unverified for this route. The audition requested MP3 from MAI, Grok,
and Kokoro and saved files only when OpenRouter returned `audio/mpeg`.
**No candidate has passed a Discord playback test.**

### Authorization, privacy, and cost

An earlier preflight stopped because the process-scoped key had no cap. For
this run, the distinct Windows user-scoped `OPENROUTER_API_KEY` returned
`limit: 1`, `limit_reset: null`, and `$1.00` remaining. Its effective budget
was `key_limit` with a $1.00 limit and no reset. The audition subprocess used
that value without changing the process or user environment. After the run,
OpenRouter reported `$0.06710352` spent and `$0.93289648` remaining.

The operator confirmed ZDR-only routing and disabled Safety Retention. Those
settings could not be independently read: the key was not a management key,
`GET /api/v1/guardrails` returned 401, and the privacy page required sign-in
on the earlier attempt. The confirmation is recorded as an attestation. The
harness set `provider.zdr: true` on all 22 requests. No conflicting
configuration surfaced, but the account settings remain unverified.

#### Audition results

The serial run made 22 of 40 possible synthesis requests: 20 completed and 2
model-availability 404s; no other requests failed. The unavailable candidates
were Gemini 3.8 Flash Lite TTS and Grok Voice TTS 1.0. Each returned a 404 on
its first request, so the remaining requests for that model were skipped.
Neither produced audio or a generation ID. This establishes unavailability
for this route while ZDR was requested; it does not establish why no eligible
endpoint was found.

- **MAI-Voice-2.1-Flash:** 10 MP3 (`audio/mpeg`) samples from Azure; actual
  reported cost `$0.064440`. Full response synthesis time had a 1.347 s median
  (0.875–1.764 s range). OpenRouter metadata `latency` was 264.5 ms median
  (233–378 ms range).
- **Kokoro 82M:** 10 MP3 (`audio/mpeg`) samples from DeepInfra; actual
  reported cost `$0.002664`. Full response synthesis time had a 22.828 s
  median (7.106–35.989 s range). OpenRouter metadata `latency` was 83 ms
  median (64–452 ms range).

The 22 per-request full response durations sum to 243.092 s. This is not
Discord playback latency. The 20 successful generation IDs and their provider
metadata are in the local `manifest.json` and `generation-metadata.json`.
Metadata was available for all 20 IDs; its `generationTime` field was null in
all 20 records. It reported `$0.067104` total generation cost and `$0.00`
upstream inference cost. The key's recorded spend was `$0.06710352`; the
difference is rounding. The two 404s had no generation IDs or cost metadata.

The operator rated all 20 samples on naturalness, intelligibility, persona
delivery, spoken-content fidelity, pronunciation, and expressiveness. The
table gives the mean for each five-sample voice set, calculated from the local
randomized rating sheet; scores are on a 1–5 scale.

| Model / voice                          | Persona  | Naturalness | Intelligibility | Persona delivery | Text fidelity | Pronunciation | Expressiveness |
| -------------------------------------- | -------- | ----------: | --------------: | ---------------: | ------------: | ------------: | -------------: |
| MAI `en-US-Harper:MAI-Voice-2.1-Flash` | Footnote |         3.2 |             4.2 |              3.2 |           4.0 |           4.0 |            4.0 |
| MAI `en-US-Grant:MAI-Voice-2.1-Flash`  | Winter   |         2.6 |             4.2 |              3.2 |           4.0 |           3.8 |            2.6 |
| Kokoro `af_heart`                      | Footnote |         2.2 |             4.0 |              3.2 |           4.0 |           3.8 |            3.0 |
| Kokoro `am_onyx`                       | Winter   |         2.2 |             3.0 |              2.2 |           3.0 |           3.0 |            2.2 |

The operator reported that most samples were acceptable, one was noticeably
weaker, and the voices varied in expressiveness and consistency. The sheet has
no per-sample written notes, and its repeat-consistency score is blank for all
20 samples, so that qualitative observation cannot be attributed to a
particular voice or summarized as a consistency score.

### First-round Standard Voice listening plan

Use one caller turn per persona, combining a short fact with a persona-
characteristic request so each produces one approved answer:

- **Footnote:** “How many days are in a week? Then give me a calm,
  conversational welcome.”
- **Danny:** “How many days are in a week? Then suggest one steady, warm first
  step for a busy morning.”
- **Myuri:** “How many days are in a week? Then describe rain in one lively,
  clear sentence.”
- **Winter:** “How many days are in a week? Then give me a dry, direct,
  understated reminder to take a break.”

Compare the approved Workflow text with the spoken answer. Assess any progress
cue separately; it is not the approved answer. Confirm playback, then
interrupt once during synthesis and once during playback. Check that stale
audio stops, the call stays usable, and Discord's playback report matches
what the listener heard. Record the effective model and voice, text match,
time to first audible speech, playback result, cost when available, and brief
listener notes. Mark anything unobserved. Adjust these assignments only
after hearing all four in Discord.

Plan for at most six MAI synthesis requests: four approved answers and one
replacement answer per interruption check. Progress-cue synthesis also counts
toward six. Do not retry; stop when six requests have been dispatched.

All audition samples, the randomized rating sheet, manifest, and generation
metadata remain local and uncommitted.

Every synthesis request includes `provider.zdr: true`. OpenRouter applies
that setting alongside the account or guardrail configuration; it does not
exclude Safety Retention endpoints when those settings permit them. This
audition requires ZDR-only routing for **Google, SpaceXAI, and All other
models**. Disable Safety Retention for Google and All other models. There is no
separate SpaceXAI Safety Retention switch.

The documented guardrail fields are `enforce_zdr_google: true`,
`enforce_zdr_other: true`, `allow_safety_retention_google: false`, and
`allow_safety_retention_other: false`. OpenRouter's ZDR guide also documents
`enforce_zdr_xai: true`, but its Guardrails API examples are inconsistent.
Verify that the live API accepts and applies that setting before relying on
it. The execution flag records the operator's confirmation, not independent
verification. Strict ZDR routing may leave Gemini without an eligible
endpoint. OpenRouter describes ZDR as no routine storage after processing,
subject to its documented CSAM/legal-preservation exception.

At published character rates, the planned 4,296-character text estimates
were **$0.06444 for MAI**, **$0.06444 for Grok**, and **$0.00266 for Kokoro**,
about **$0.1316 combined**. These are estimates, not observed charges; Grok
was unavailable. Gemini is billed by input and generated audio tokens, but
returned no generation ID or cost metadata. The $1 provider-side limit is a
ceiling, not a cost estimate.

### Run and review the samples

The local checks and dry run use no provider calls:

```powershell
pnpm test:voice-audition
pnpm voice:audition
```

Before a future execution, verify the key inherited by the command shell; a
stale process-scoped variable may differ from the Windows user-scoped value.
The prior run used a verified $1 lifetime cap. Its execution command was:

```powershell
pnpm voice:audition --execute --confirm-openrouter-key-limit-usd=1 --confirm-openrouter-zdr-only
```

The helper sends requests to OpenRouter's `/api/v1/audio/speech` one at a time,
with no client retries, a 60-second timeout per request, and a 10 MiB audio
response limit. If a model returns a 404 specifically confirming that no
endpoint is available, the helper skips its remaining samples and continues.
Authorization, spending-limit, format, and other failures stop the run and
leave partial results. OpenRouter itself may route or fail over between
eligible upstream endpoints within one request; for Kokoro, the listed
providers include DeepInfra and Together.

Successful samples go into an OS temporary directory with anonymous
filenames. The randomized `rating-sheet.csv` includes the persona, fixture,
original text, and spaces to rate naturalness, intelligibility, persona
delivery, spoken-content fidelity, pronunciation, expressiveness, and repeat
consistency. Listen in the sheet's `order` and record scores before opening
`manifest.json`. The test is **partially blinded**: Gemini's WAV filenames
are distinguishable from the MP3 samples. Keep the audio local and
uncommitted until listening and rating are complete.

The manifest records each model and voice, HTTP status, generation ID,
`Content-Type`, and time spent waiting for the full synthesis response. It
does not store provider text responses or raw audio in metadata. That timing
is not time to first audio, Discord playback latency, or the delay after
Workflow approval. This fixed-text audition has no approval event.

After synthesis, retrieve any available provider and cost information using
the saved generation IDs:

```powershell
pnpm voice:audition:metadata "<audition-directory>"
```

This separate command performs at most 40 serial `GET
/api/v1/generation?id=...` lookups, with a 10-second timeout, 64 KiB
response limit, and no retries. It writes only available model, provider,
actual cost, upstream inference cost, generation time, and latency fields to
`generation-metadata.json`; missing values stay `null`. It neither
synthesizes new audio nor saves prompts or completions. Review this file and
the manifest after blind scoring. Keep audio local and uncommitted for
listening; do not add samples or raw provider responses to the repository.

### Remaining canary gates

- Verify live MAI returns `audio/pcm` containing nonempty, even-length 24 kHz
  mono PCM16 within the 10 MiB limit; Discord resamples valid audio to 48 kHz.
  Synthetic tests cover those boundaries, but the earlier MAI audition
  requested MP3, so the live PCM path remains unverified.
- Use process-scoped OpenRouter credentials with a verified, non-resetting
  cap of $1 or less and enough remaining balance for six short requests. The
  November 5 preflight could not verify a cap, so it made no MAI request.
- Configure a private, non-production Discord test environment. This checkout
  identified only the production Fly app; no Discord call or deployment was
  attempted. Use one consenting human in the test voice channel.
- Verify account-side ZDR and retention settings before the canary. Requests
  set `provider.zdr: true`, but account settings remain operator-attested.

Sources: [OpenRouter TTS guide](https://openrouter.ai/docs/guides/overview/multimodal/tts),
[live speech catalog](https://openrouter.ai/api/v1/models?output_modalities=speech),
[MAI model page](https://openrouter.ai/microsoft/mai-voice-2.1-flash),
[Grok model page](https://openrouter.ai/x-ai/grok-voice-tts-1.0/api),
[Kokoro model page](https://openrouter.ai/hexgrad/kokoro-82m),
[OpenRouter TTS tutorial](https://openrouter.ai/blog/tutorials/text-to-speech/),
[OpenRouter audio API announcement](https://openrouter.ai/blog/announcements/announcing-audio-apis/),
[Gemini TTS format documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/text-to-speech/migration-guide),
[OpenRouter API-key spending limits](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys),
[OpenRouter ZDR routing](https://openrouter.ai/docs/guides/features/zdr),
[OpenRouter Guardrails API](https://openrouter.ai/docs/api/api-reference/guardrails/update-a-guardrail),
[OpenRouter generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-request-%26-usage-metadata-for-a-generation),
[pnpm argument forwarding](https://pnpm.io/cli/run).
