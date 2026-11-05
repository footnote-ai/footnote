# Voice persona evaluation

Updated: 2026-11-05 · [Issue #974](https://github.com/footnote-ai/footnote/issues/974) · [Issue #534](https://github.com/footnote-ai/footnote/issues/534) · [Issue #975](https://github.com/footnote-ai/footnote/issues/975)

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
Discord. No paid-provider or listening tests have been run for this issue.

The listening comparison should look closely at four areas:

- **Persona:** Do Footnote, Danny, Myuri and Winter sound distinct and recognizable, especially when GPT-Live speaks without delegating?
- **Reviewed answers:** Standard sends approved text to TTS. GPT-Live can paraphrase approved commentary or answer on its own, and listeners currently have no reliable indication of which happened.
- **Cancellation:** A new turn may arrive while the previous Workflow still occupies the process-wide execution slot, causing the replacement to be rejected as `occupied`. We haven't measured when a real provider stops after cancellation.
- **Usage:** Workflow records usage and cost when available. Transcription logs usage if the provider supplies it; Standard TTS returns no usage data, and GPT-Live records duration. We still can't reconcile the full cost of a call.

The delivery ceilings are 400 estimated tokens for Live and 1,600 estimated tokens plus 3,686 code points for Standard. We'll need to check whether the resulting answers sound natural and fit within the call.

## Start with a pilot

Try Footnote and Winter first. Use ordinary text as the reference, then run the same short conversation in Standard and Live at balanced expression. One consenting listener and a private Discord channel are enough for this pass.

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

No paid testing is approved yet. The earlier estimate of **$6.54–$15.43** covers Live, Whisper, TTS text input and assumed Workflow charges. It excludes TTS audio output and depends on the selected routes. The proposed **$20 budget** is a planning figure; Footnote doesn't enforce a total-dollar cap.

Before any provider calls, check the actual model and route prices, search costs, retry behavior, provider retention settings and available spending controls. The relevant published rates are [GPT-Live](https://developers.openai.com/api/docs/models/gpt-live-1), [Whisper](https://openrouter.ai/openai/whisper-1/pricing) and [OpenAI TTS](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts). The current TTS route may be overridden by the configured profile. If we cannot limit spending and execution counts before dispatch, keep the evaluation on hold.

Testing will need the configured OpenAI, OpenRouter, Workflow and search credentials, an authorized operator session, and access to the private Discord test channel. Load credentials privately after approval. Do not log or commit them.

## Fixed-text Standard TTS audition (#534 and #975)

This smaller audition compares four OpenRouter text-to-speech models before we
choose new defaults for Standard Voice. It uses temporary voice selections for
Footnote and Winter, with the same text sent to every candidate. The output is
for offline listening; this does not test Discord playback or change production
voice settings.

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

| Candidate                 | Footnote / Winter voice                                                | Listening format   | Delivery guidance      | Published price                         |
| ------------------------- | ---------------------------------------------------------------------- | ------------------ | ---------------------- | --------------------------------------- |
| Gemini 3.8 Flash Lite TTS | `Kore` / `Charon`                                                      | PCM wrapped as WAV | Supported; included    | $0.50/M text tokens + $6/M audio tokens |
| MAI-Voice-2.1-Flash       | `en-US-Harper:MAI-Voice-2.1-Flash` / `en-US-Grant:MAI-Voice-2.1-Flash` | MP3                | Not supported; omitted | $15/M characters                        |
| Grok Voice TTS 1.0        | `eve` / `rex`                                                          | MP3                | Not supported; omitted | $15/M characters                        |
| Kokoro 82M                | `af_heart` / `am_onyx`                                                 | MP3                | Not supported; omitted | $0.62/M characters                      |

These voice IDs are audition choices, not bundled persona defaults. Gemini
receives the short delivery guidance already proposed for Footnote ("Clear,
calm, grounded, conversational") and Winter ("Dry, direct, controlled,
understated"). The other models ignore OpenRouter's natural-language
`instructions` field, so the helper leaves it out. Grok's inline speech tags
are also excluded to keep the source text identical.

For offline listening, Gemini's raw PCM is wrapped as WAV using the documented
24 kHz mono, 16-bit signed little-endian contract. Google's format guidance
covers the preceding model and WAV/PCM output for Gemini 3.8; the actual
OpenRouter response still needs to be heard and checked. MAI documents 24 kHz
mono PCM but not enough encoding detail for the existing Discord path. Grok
supports several PCM sample rates, and Kokoro has no verified PCM rate/channel
contract through this route. Those three models use MP3 for this audition;
the helper accepts their files only when OpenRouter responds with
`audio/mpeg`. **None of these candidates has passed a Discord playback test.**
Unknown PCM must not be treated as 24 kHz audio.

### Authorization, privacy, and cost

**No paid requests have been made or authorized.** Before running the
audition, explicitly approve it and verify a dedicated OpenRouter key with a
**$1 lifetime spending limit and no reset**. Set `OPENROUTER_API_KEY`
privately. The script requires confirmation flags, but cannot read or enforce
the key's limit or account privacy settings itself.

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

At published character rates, the planned text costs approximately
**$0.06444 for MAI**, **$0.06444 for Grok**, and **$0.00266 for Kokoro**
(4,296 characters per model), about **$0.1316 combined**. Gemini is billed
by input and generated audio tokens, so its actual cost is unknown until
metadata is available. The $1 provider-side limit is the ceiling, not a cost
estimate; reaching it may end the run early.

### Run and review the samples

The local checks and dry run use no provider calls:

```powershell
pnpm test:voice-audition
pnpm voice:audition
```

After separate authorization and verification of the key cap and ZDR
configuration, the execution command is:

```powershell
pnpm voice:audition -- --execute --confirm-openrouter-key-limit-usd=1 --confirm-openrouter-zdr-only
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
are distinguishable from the MP3 samples. Keep audio out of the evaluation
notes and delete the temporary files after recording the ratings.

The manifest records each model and voice, HTTP status, generation ID,
`Content-Type`, and time spent waiting for the full synthesis response. It
does not store provider text responses or raw audio in metadata. That timing
is not time to first audio, Discord playback latency, or the delay after
Workflow approval. This fixed-text audition has no approval event.

After synthesis, retrieve any available provider and cost information using
the saved generation IDs:

```powershell
pnpm voice:audition:metadata -- "<audition-directory>"
```

This separate command performs at most 40 serial `GET
/api/v1/generation?id=...` lookups, with a 10-second timeout, 64 KiB
response limit, and no retries. It writes only available model, provider,
actual cost, upstream inference cost, generation time, and latency fields to
`generation-metadata.json`; missing values stay `null`. It neither
synthesizes new audio nor saves prompts or completions. Review this file and
the manifest after blind scoring, then delete the temporary audio directory
once the ratings and relevant synthetic observations are recorded.

### What remains unresolved

The configured Standard Voice fallback,
`openai/gpt-4o-mini-tts-2025-12-15`, is absent from OpenRouter's live speech
catalog and has no available model page. OpenRouter's older guide and tutorial
still use it as an example, despite the provider's September 2026 statement
that no OpenAI speech models were listed. Its live availability therefore
remains **unconfirmed**; there has been no paid route check. The production
default stays unchanged while that route is investigated, and a separate
authorization is needed for an OpenAI control. We should not choose a
permanent replacement based on these samples alone.

The audition also does not verify the PCM contracts needed for Discord,
persona consistency during live conversation, or interruption behavior.
Those belong to the later Voice evaluation.

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

## What comes next

Once provider testing is approved, run the private listening comparison and
record what people actually hear. Keep #974 open until those checks are
complete, and report model behavior separately from the verified startup and
Workflow wiring.
