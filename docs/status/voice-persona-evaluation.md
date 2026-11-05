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

The separate Standard TTS comparison reuses the synthetic
[`voiceCondensationEvaluation.json`](../../packages/backend/test/fixtures/voiceCondensationEvaluation.json)
answers. It sends the `originalAnswer` text byte-for-byte after checking that
the fixtures have no leading or trailing whitespace. It does not create new
answers, add speech tags, or change production approval state.

The matrix uses `simple-factual`, `evidence-limits`, `rationale-extent`, and
`caution-tradeoff` for Footnote and Winter, then repeats `caution-tradeoff`
once per persona/model. That is ten serial requests per model and **40 maximum
requests** across four alternatives. The current OpenAI Standard fallback is
not included as a control: its configured model is absent from the live
OpenRouter speech catalog, its model page is unavailable, and OpenRouter's
current guide and tutorial still include examples using that model. The live
catalog, OpenRouter's statement that no OpenAI speech model was listed in
September 2026, and those examples conflict, so the fallback is **not
confirmed operational** without a paid route check. Do not replace it with an
unauditioned candidate. No production correction is safe before a route is
verified and a control is obtained. If a separate authorized route check
confirms failure, recover the operational path under #534/#975 without
changing the audition's production default. The comparison remains incomplete
until a control is obtained under separate authorization; no direct OpenAI
request is part of this helper.

| Candidate                        | Footnote / Winter voice                                                | Audition format and delivery guidance                                                                       | PCM compatibility evidence                                                                                                                                                                                                                                                   | Current published price                           |
| -------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Google Gemini 3.8 Flash Lite TTS | `Kore` / `Charon`                                                      | PCM only; persona instructions are supported and used                                                       | Google documents raw 16-bit, 24 kHz mono PCM for the predecessor and WAV/PCM 16-bit, 24 kHz mono for 3.8; OpenRouter's endpoint documents PCM-only for Gemini TTS. The helper wraps that verified contract as WAV for listening. Confirm actual Discord playback separately. | $0.50/M input tokens and $6/M output audio tokens |
| Microsoft MAI-Voice-2.1-Flash    | `en-US-Harper:MAI-Voice-2.1-Flash` / `en-US-Grant:MAI-Voice-2.1-Flash` | MP3; natural-language delivery instructions are ignored, so none are sent                                   | The model page documents PCM at 24 kHz mono, but not sample encoding/endianness. Discord playback remains unverified.                                                                                                                                                        | $15/M characters                                  |
| Grok Voice TTS 1.0               | `eve` / `rex`                                                          | MP3; delivery instructions are ignored. Inline speech tags are deliberately omitted.                        | PCM is available at selectable/provider-supported rates spanning 8–48 kHz, but OpenRouter does not document a fixed rate for this request. Unresolved for Discord.                                                                                                           | $15/M characters                                  |
| Kokoro 82M                       | `af_heart` / `am_onyx`                                                 | MP3 requested; only save when the response is `audio/mpeg`; natural-language instructions are not supported | The OpenRouter route does not document a reliable PCM sample-rate/channel contract. Unresolved for Discord.                                                                                                                                                                  | $0.62/M characters                                |

Voice identifiers are model-specific. These are temporary audition settings,
not persona defaults. Only Gemini receives the existing short delivery
guidance: Footnote (“Clear, calm, grounded, conversational”) and Winter
(“Dry, direct, controlled, understated”). The other three candidates receive
the exact same approved text without substituted instructions.

All synthesis calls use OpenRouter's `/api/v1/audio/speech`, the existing
`OpenRouterVoiceService`, `provider.zdr: true`, one in-flight request, a
60-second per-request timeout, the adapter's 10 MiB response limit, and no
client retries. `provider.zdr: true` is sent on every synthesis request and
follows account and guardrail settings; it does not by itself prevent Safety
Retention endpoints when those settings allow them. OpenRouter documents
Google, SpaceXAI, and All other models as distinct ZDR enforcement scopes.
Configure ZDR-only for all three scopes used by this matrix. Safety Retention
settings apply specifically to Google and All other models, so disable them
for both groups; there is no separate SpaceXAI Safety Retention setting. The
guide documents `enforce_zdr_xai` for SpaceXAI, but the linked Guardrails API
reference is inconsistent: it lists the field in its schema and response
example, while its generic update example does not exercise it. Do not assume
that the live Guardrails API accepts and applies `enforce_zdr_xai` without
verification. The documented guardrail settings for the other scopes are
`enforce_zdr_google: true`, `enforce_zdr_other: true`,
`allow_safety_retention_google: false`, and
`allow_safety_retention_other: false`; verify `enforce_zdr_xai: true` before
relying on it. The helper cannot inspect account or guardrail settings, and
its execution flag only records operator attestation. Strict ZDR-only routing
may make Gemini unavailable. If OpenRouter returns the recognized
model-specific no-endpoint 404, the helper records it as unavailable and skips
that model without retrying; other failure types stop the audition. OpenRouter
describes ZDR as no routine storage after processing, with its documented
CSAM/legal-preservation exception. [Current ZDR policy and
settings](https://openrouter.ai/docs/guides/features/zdr), [Guardrails API](https://openrouter.ai/docs/api/api-reference/guardrails/update-a-guardrail).

The manifest records synthesis duration through complete response-body
consumption, model, voice, OpenRouter as the route, generation ID, HTTP status,
and only the `Content-Type` response header. OpenRouter documents
`X-Generation-Id` for correlation with a separate metadata lookup. Response
headers do not establish PCM rate/channels, selected upstream provider, or
billing. Synthesis time is not Discord playback time or approval-to-audible
latency. The fixed-text script has no Workflow approval event; actual Discord
playback is a separate check after a PCM contract is established.

After synthesis, run the separate metadata lookup against the existing
generation IDs:

```powershell
pnpm voice:audition:metadata -- "<audition-directory>"
```

It makes at most 40 `GET /api/v1/generation?id=...` requests, each with a
10-second timeout, a 64 KiB response cap, and no retry. It writes only `model`,
`provider_name`, actual `total_cost`, `upstream_inference_cost`, generation
time, and latency to `generation-metadata.json`; it never stores the endpoint's
prompt/completion content or full response. Missing generation IDs, a 404, or
missing cost/provider fields stay explicitly unavailable (`null`), not
estimated. The command does not synthesize audio or modify the source
manifest. [OpenRouter generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-request-%26-usage-metadata-for-a-generation).

The provider-side spending limit is **$1.00 total** on a dedicated OpenRouter
key with no automatic reset. The three character-priced models account for
about **$0.1316** as a published-rate estimate for 4,296 characters/model:
$0.06444 for MAI, $0.06444 for Grok, and $0.00266 for Kokoro. These are not
actual audition charges; use generation metadata where OpenRouter returns it.
Gemini's cost depends on input and generated audio tokens, and the synthesis
response does not guarantee usage metadata, so the key's $1.00 provider-side
limit is the hard ceiling. Reaching it can stop the matrix early. The helper
also fixes the request maximum at 40 and requires an execution flag plus
confirmation of the active key cap; it cannot inspect or enforce the account's
key setting by itself.

**No provider calls have been made.** Before synthesis, an operator must
explicitly authorize execution, create/check the dedicated $1.00 capped key,
set `OPENROUTER_API_KEY`, confirm the cap is active, and configure the
ZDR-only settings above. OpenRouter lists DeepInfra and Together as Kokoro
endpoints; provider routing may fail over inside one request, and the helper
makes no client-side retry. Only these synthetic fixture answers are sent.
Audio is written to an OS temporary directory with random sample names. The
listening order is randomized, but the comparison is **partially blinded**:
the WAV extension identifies Gemini while the other candidates use MP3. The
sheet does not include model or voice names. It contains the intended persona,
fixture ID, exact reference text, and scores for naturalness, intelligibility,
persona delivery, spoken fidelity, pronunciation, expressiveness, and repeat
consistency. Follow its `order` column, open each listed file with the system
audio player, and fill the scores. Do not inspect `manifest.json` or
`generation-metadata.json` until scoring is complete. Then join scores to the
manifest and metadata. Remove the temporary directory after recording the
synthetic ratings.

If OpenRouter returns a 404 whose bounded error message confirms that the
requested model has no endpoints or is unavailable, the helper records that
candidate as unavailable, skips its remaining samples, and continues to the
next model. It does not retry. Authorization, spending-limit, format, and
other errors stop the whole run and preserve partial results. Synthesis
attempts can therefore be fewer than 40, but cannot exceed 40.

Local, no-provider commands:

```powershell
pnpm test:voice-audition
pnpm voice:audition
```

Only after separate authorization, active key-cap confirmation, and
ZDR-only account/guardrail configuration, use:

```powershell
pnpm voice:audition -- --execute --confirm-openrouter-key-limit-usd=1 --confirm-openrouter-zdr-only
```

The helper skips only a confirmed model-specific 404 and stops on other
failures. It does not set an approval timestamp or send audio through the
Discord playback path.

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
[OpenRouter generation metadata API](https://openrouter.ai/docs/api/api-reference/generations/get-request-%26-usage-metadata-for-a-generation),
[pnpm argument forwarding](https://pnpm.io/cli/run).

## What comes next

Once provider testing is approved, run the private listening comparison and
record what people actually hear. Keep #974 open until those checks are
complete, and report model behavior separately from the verified startup and
Workflow wiring.
