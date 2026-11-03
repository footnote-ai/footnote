# Voice persona evaluation

Updated: 2026-11-02 · [Issue #974](https://github.com/footnote-ai/footnote/issues/974)

## Where we are

The invoking bot's persona is now pinned for the whole call ([#976](https://github.com/footnote-ai/footnote/pull/976)), and GPT-Live receives its behavioral instructions at startup ([#977](https://github.com/footnote-ai/footnote/pull/977)). [#979](https://github.com/footnote-ai/footnote/pull/979) also improved the default answer limits and recovery budget.

The synthetic tests cover persona selection, Workflow approval, speech handoff, interruption and cleanup. We still need to hear how Standard and Live behave in Discord. No provider calls or listening evaluations have been run for this issue.

There are a few things to pay particular attention to:

- **Persona:** Footnote, Danny, Myuri and Winter receive their configured behavior and expression strength. We don't yet know how recognizable they sound, especially when GPT-Live responds on its own.
- **Reviewed answers:** Standard passes approved text to TTS. GPT-Live can paraphrase approved commentary or speak independently. There is currently no way for the listener to tell where a Live response came from.
- **Cancellation:** A replacement turn may arrive while the previous Workflow still holds the process-wide execution slot. The new run can be rejected as `occupied`. Synthetic cancellation tests cannot establish when a real provider stops.
- **Usage:** Workflow records usage and cost where available. Transcription usage is logged when supplied, Standard TTS has no usage response, and GPT-Live currently records duration. We cannot yet reconcile the full cost of a call.

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

## What comes next

Use the pilot to decide what needs fixing before [#973](https://github.com/footnote-ai/footnote/issues/973). Speech origin in Live, cancellation under occupied capacity, and Voice cost accounting are the main candidates. Keep #974 open until the provider comparison and listening checks have been done.
