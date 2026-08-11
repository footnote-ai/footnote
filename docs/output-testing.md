# Output Testing

Run the basic output check from a source checkout:

```sh
pnpm test:output
```

The command installs the required Playwright Chromium browser when needed.

It checks one fixed text answer on the web chat page and in the Discord `/chat`
command. The web check verifies the request, answer, citation, provenance, trace
link, and screenshot. The Discord check verifies the request and serialized reply
payload, including provenance controls and the trace-card attachment.

To add a case later, add another JSON file beside
`test/basic-output-check/fixtures/ordinary-text-answer.json` and add focused web
and Discord assertions that use it.

Current limits: this covers Chromium at one desktop viewport, one success case,
and serialized Discord data. It does not cover live Discord, mobile layouts,
accessibility sweeps, failures, ranking, or CI enforcement.
