# Planner strict-output comparison

This file contains redacted transport metrics only. Raw prompts, model outputs,
secrets, and hidden reasoning are never written.

The comparison harness is available at `scripts/planner-comparison.mts` and can
be run with `pnpm eval:planner -- --live` when provider credentials are present.

| Mode               | Status  | Valid transport | Normalization/fallback | Latency ms | Tokens (prompt/completion/total) | Cost USD | Actual provider/model | Upstream provider/model | Fallback frequency |
| ------------------ | ------- | --------------: | ---------------------: | ---------: | -------------------------------- | -------: | --------------------- | ----------------------- | -----------------: |
| deepseek_strict    | not run |             n/a |                    n/a |        n/a | n/a                              |      n/a | n/a                   | n/a                     |                n/a |
| deepseek_text_json | not run |             n/a |                    n/a |        n/a | n/a                              |      n/a | n/a                   | n/a                     |                n/a |
| luna_strict        | not run |             n/a |                    n/a |        n/a | n/a                              |      n/a | n/a                   | n/a                     |                n/a |

No live-provider evidence was available during this implementation. DeepSeek
remains the configured planner preference.
