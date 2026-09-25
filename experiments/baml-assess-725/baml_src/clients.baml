client<llm> CustomGPT5Mini {
  provider openai-responses
  options {
    model "gpt-5-mini"
    api_key env.OPENAI_API_KEY
  }
}

client<llm> LocalOllama {
  provider openai-generic
  options {
    base_url "http://localhost:11434/v1"
    model "reap48-fixed:latest"
    temperature 0
    default_role "user"
  }
}
