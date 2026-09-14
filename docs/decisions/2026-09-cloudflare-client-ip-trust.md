# Cloudflare client-IP trust for the Footnote web backend

## Decision

When `WEB_TRUST_PROXY=true`, Footnote accepts `CF-Connecting-IP` only after
`Fly-Client-IP` has been parsed and matched against the checked-in Cloudflare
edge CIDRs in `packages/backend/src/http/clientIp.ts`. The resolver accepts one
valid IP value only and ignores `X-Forwarded-For` for client identity.

When the Fly peer is not a Cloudflare address, Footnote uses `Fly-Client-IP`
and ignores Cloudflare and forwarded headers. If that header is absent or
invalid, it falls back to the socket address. A malformed or ambiguous
`CF-Connecting-IP` also falls back to the authenticated Fly identity.

The Cloudflare ranges are copied from the definitive list at
<https://www.cloudflare.com/ips/>. Update the checked-in list when Cloudflare
changes that page; request handling must not fetch the list from the network.

`WEB_TRUST_PROXY` no longer means Express's generic "trust arbitrary forwarded
headers" mode. Express's generic trust-proxy setting remains disabled, and
chat rate limiting, trace rate limiting, and Turnstile all consume the shared
resolver. The default remains `false` for direct or local deployments; set it
to `true` only when the application is intentionally deployed behind the
validated Cloudflare-to-Fly path.
