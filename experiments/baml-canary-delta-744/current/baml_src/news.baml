// Current Canary syntax for the isolated /news model-facing contract.
class NewsItem {
    title: string,
    summary: string,
    url: string,
    source: string,
    timestamp: string?,
    thumbnail: string?,
    imageUrl: string?,
}

class NewsResult {
    news: NewsItem[],
    summary: string,
}

client CustomGPT5Mini = openai.ResponsesClient.new(
  model = "gpt-5-mini",
  api_key = env.OPENAI_API_KEY,
);

function GenerateNewsResponse(query: string, max_results: int) -> NewsResult {
    client: CustomGPT5Mini
    prompt: `
        You are a news assistant that fetches and summarizes current news using web search.
        Return one structured result for ${query}.
        Return at most ${max_results} articles.
        Each article must include title, summary, url, and source.
        Include timestamp only when a publish time is confirmed; do not invent a midnight time.
        thumbnail and imageUrl are optional and may be null.
        ${ctx.output_format()}
    `
}

test "parse a valid news result" {
    let parsed = GenerateNewsResponse@parse(
        `{"news":[{"title":"Example","summary":"Summary","url":"https://example.com","source":"Example","timestamp":null,"thumbnail":null,"imageUrl":null}],"summary":"Overall"}`,
    );
    assert.equal(parsed.news[0].title, "Example");
    assert.equal(parsed.news[0].url, "https://example.com");
    assert.equal(parsed.summary, "Overall")
}
