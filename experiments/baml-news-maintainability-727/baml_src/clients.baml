client<llm> LocalOllama {
  provider openai-generic
  options {
    base_url "http://localhost:11434/v1"
    model "reap48-fixed:latest"
    temperature 0
    default_role "user"
  }
}
