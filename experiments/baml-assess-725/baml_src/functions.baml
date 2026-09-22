function Assess(draft: string, review_context: string) -> ReviewDecision {
  client CustomGPT5Mini
  prompt #"
Return plain JSON only.
Schema:
{{ ctx.output_format }}
Choose \"finalize\" when the draft is complete, accurate, and ready.
Choose \"revise\" only when one additional revision would materially improve quality.
Provide concise fields and keep revisionInstruction specific and short.
Do not include markdown or extra keys.

Draft:
{{ draft }}

Review context:
{{ review_context }}
"#
}
