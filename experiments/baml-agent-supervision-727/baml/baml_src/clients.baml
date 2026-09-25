client<llm> CustomGPT5Mini {
  provider openai-responses
  options {
    model "gpt-5-mini"
    api_key env.OPENAI_API_KEY
  }
}