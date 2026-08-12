# Output Testing

Run the basic output check from a source checkout:

```sh
pnpm test:output
```

The command installs the required Playwright Chromium browser when needed.

For the broader approach, see the
[Platform Experience Standard](./architecture/platform-experience-standard.md).

It checks one fixed text answer on the web chat page and in the Discord `/chat`
command. The web check verifies the request, answer, citation, provenance, and
trace link, then captures a screenshot in the Playwright test output for human
inspection. The Discord check verifies the request, answer, usable provenance
controls, and trace-card attachment without freezing Discord.js serialization
details.

To add a case later, add another JSON file beside
`test/basic-output-check/fixtures/ordinary-text-answer.json` and add focused web
and Discord assertions that use it.

Current limits: this covers Chromium at one desktop viewport, one success case,
and Discord command data. It does not cover live Discord, mobile layouts,
accessibility sweeps, failures, ranking, or CI enforcement.
