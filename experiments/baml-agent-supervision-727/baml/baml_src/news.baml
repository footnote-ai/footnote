// Experimental copy of the real internal news output shape.
// Footnote's strict URL/date validation remains outside this source.
class NewsItem {
  title string
  summary string
  url string
  source string
  timestamp string?
  thumbnail string?
  imageUrl string?
}

class NewsResult {
  news NewsItem[]
  summary string
}

function GenerateNewsResponse(query: string, max_results: int) -> NewsResult {
  client CustomGPT5Mini
  prompt #"
You are a news assistant that fetches and summarizes current news using web search.
Return only one structured result.
Find recent, relevant articles for this query:
{{ query }}
Return at most {{ max_results }} articles.
Each article must include title, summary, url, and source.
Include timestamp only when a publish time is confirmed; do not invent a midnight time.
thumbnail and imageUrl are optional and may be null.
Write a concise summary of the overall findings.
"#
}