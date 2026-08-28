# Response comparison

Use this workflow to compare how models express the same answers. It keeps
style separate from facts, uncertainty, sources, authority, and safety. It
does not change production settings or choose a winner.

## Run a comparison

1. Edit `response-comparison.yaml`.
2. Check it without generating responses:

    ```text
    pnpm responses:compare --check
    ```

3. Run it:

    ```text
    pnpm responses:compare
    ```

4. Open `response-comparison-<run-id>.html`.
5. Review responses while the report is blind, then reveal run details.

Check mode validates profiles, credentials, the automatic reviewer, and
provider support. It reports combinations that cannot be tested without
calling providers. The live command records supported, unsupported, and
failed attempts and continues after individual failures. If interrupted, the
same comparison resumes its active checkpoint. Completed runs are not reused.

## Configure it

- Catalog profile IDs use the real model catalog. Raw `name`/`provider`/`model`
  entries are temporary candidates and do not belong in that catalog.
- Each `settings` entry is one variant. The runner does not build an implicit
  Cartesian product. `default` uses provider and model defaults.
- `cases: core` loads the maintained suite from
  `packages/backend/test/fixtures/responseComparisonCore.yaml`.
- Personas and expression strength use existing backend persona settings.
- `mustKeep` lists the facts and limits every response should preserve.

Unsupported settings are skipped and recorded with their reason. The report
keeps settings requested by the campaign, sent by Footnote, skipped, and
reported by the provider separate. It also records model attribution, status,
timing, usage, cost, and output length when available.

## Review the report

Blind mode shows the source, persona guidance, requirements, and response. It
hides model, provider, settings, timing, cost, automatic review, and saved
human-review details. Reviewer identity and blind judgments can still be
saved. Revealing details is recorded locally, and exporting a reviewed report
creates a new file without changing the original.

Automatic review supports human judgment; it does not replace it. Human and
automatic scores stay separate, and the report does not calculate a combined
winner.

The workflow does not expose a generic end-user temperature slider. Model
strength escalation remains separate in #564. Do not commit presentation
defaults or close #571 until the fixed suite, human review, and a holdout run
support the recommendation.
