# Turnstile browser integration testing

The focused browser suite uses Cloudflare's official dummy credentials against
an isolated local backend. It loads the real Turnstile client and sends the
real browser token through `/api/chat` to Cloudflare Siteverify; it does not
mock Siteverify or use production credentials.

Cloudflare documents the test keys and dummy token behavior at
<https://developers.cloudflare.com/turnstile/troubleshooting/testing/>.

Run the positive and negative paths separately:

```text
pnpm test:e2e:turnstile:pass
pnpm test:e2e:turnstile:fail
```

The suite uses temporary settings fixtures and a localhost-only deterministic
OpenRouter-compatible provider so a successful CAPTCHA response can reach the
normal chat response boundary without an LLM account. The production-settings
guard ensures the canonical `footnote.yaml` does not contain any official
dummy site or secret key.
