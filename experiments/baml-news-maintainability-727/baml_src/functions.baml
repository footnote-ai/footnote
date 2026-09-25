function GenerateNewsResponse(query: string, category: string, max_results: int) -> NewsResult {
  client LocalOllama
  prompt #"
You are a news assistant. Return only one JSON object with a `news` array and
a `summary` string. Every news item must include title, summary, url, and
source. Include timestamp only when a publish time is confirmed. If only a
publish date is known, omit timestamp instead of inventing midnight.

Query: {{ query }}
Category: {{ category }}
Maximum results: {{ max_results }}

{{ ctx.output_format }}
"#
}
