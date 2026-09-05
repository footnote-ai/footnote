# Testing chat through the backend

Agents should test backend chat behavior through the same `POST /api/chat`
boundary used by web and Discord. This keeps agent tests on the same request,
routing, provenance, and response path as the product.

## Authentication

Trusted agent calls use the `AGENT_API_TOKEN` deployment secret in the
`X-Agent-Token` header. The token authenticates the caller, while `surface`
remains `web` or `discord` according to the behavior being exercised.

The credential currently authorizes chat submission only. Trace, incident,
settings, and provider access remain separate concerns, so future permissions
can be added explicitly without changing this endpoint.

## Send a prompt

For a quick request, put the deployment values in the repo's `.env` file and
run:

```powershell
pnpm agent:chat -- --prompt 'Explain the current routing behavior in two sentences.' --surface discord --trigger-kind direct --mode-id grounded
```

The command loads `.env` automatically. Values already present in the process
environment take precedence, and `--base-url` can override the configured
backend URL for one request.

The command waits for the HTTP response and prints the complete JSON response
body. It reports the HTTP status, elapsed time, and response ID on stderr. Each
invocation makes one backend request.

## Reproduce a web or Discord request exactly

Put the complete serializable `PostChatRequest` in a JSON file, then run:

```powershell
pnpm agent:chat -- --request-file .\tmp\chat-request.json
```

Request-file mode validates the body against the shared contract before sending
it. Use this mode for optional fields such as addressing, attachments,
capabilities, profile overrides, `traceTarget`, and surface context.

The backend response includes the normal `message`, `react`, `ignore`, or
`image` action shape. The response metadata contains the `responseId` used for
later trace inspection by a caller that has separate trace access.

## Fly and process-local tests

For process-local state on Fly, point `BACKEND_BASE_URL` at the target machine
and keep related requests on that same target. This matters for temporary
provider availability, where the first request establishes the state observed
by the second.

## Agent operating rule

The normal loop is:

1. Construct or load a complete `PostChatRequest`.
2. Submit it with `pnpm agent:chat`.
3. Wait for completion and read the complete response body. If the shell
   reports a running process, poll that same process instead of submitting
   another request.
4. Record the response ID and inspect the trace only when the task requires it.
5. Ask the human for help when credentials, deployment access, or a
   surface-specific UI action is unavailable.

Keep the agent token in the environment and keep captured prompts and responses
in ephemeral local output unless a task explicitly requires a checked-in
fixture.
