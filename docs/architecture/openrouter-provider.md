# OpenRouter Provider Boundary

Footnote treats OpenRouter as a named backend provider. It is not configured as
an OpenAI base-URL override. Set `OPENROUTER_API_KEY`; the backend uses
`OPENROUTER_BASE_URL` only as that provider's endpoint, with the default
`https://openrouter.ai/api/v1`.

## Routing and fallbacks

Model profiles may use arbitrary OpenRouter model IDs and an optional
`providerRouting.openrouter` policy. The policy maps to OpenRouter's routing
controls: provider order or allowlist, fallback permission, data-collection
posture, and zero-data-retention request. The bundled DeepSeek profile uses
`deepseek/deepseek-v4-flash-0731` with low reasoning and does not pin an
upstream endpoint. Deployments with OpenRouter credentials can select it first
for planning and normal generation; the optional presentation flow can reuse
the same provider-neutral profile. The canonical Fly deployment sets both
`DEFAULT_PROFILE_ID` and `PLANNER_PROFILE_ID` to this profile so planner calls
do not depend on an exhausted OpenAI quota.

The profile's provider and model are the **backend request**, not proof of the
upstream inference provider or resolved model. When OpenRouter returns routing
metadata, Footnote displays it as upstream-reported information. Missing
metadata remains unavailable rather than inferred. See OpenRouter's
[provider routing](https://openrouter.ai/docs/features/provider-routing) and
[metadata](https://openrouter.ai/docs/features/metadata) documentation.

## Privacy and cost provenance

OpenRouter receives planner, normal generation, and optional
presentation-candidate requests and may route them to the selected upstream
provider. OpenRouter's retention and provider data
policies apply in addition to Footnote's own handling. Operators should review
[privacy policy](https://openrouter.ai/privacy) and provider data policy before
enabling this profile.

The backend still records its own token-based cost estimate. An upstream charge
is shown separately only when OpenRouter reports one. Neither field is treated
as proof of the other.

## Deployment

Set the secret with the backend deployment's normal secret mechanism, for
example `fly secrets set OPENROUTER_API_KEY=... -a <server-app>`. Do not put it
in browser configuration or bot-only configuration. The canonical Fly
configuration selects the bundled DeepSeek profile for planning and normal
generation and opts into presentation; fresh installs keep presentation
disabled by default. OpenAI planner and assessment profiles remain explicit
fallback routes rather than the primary deployment path.
If the key or profile is unavailable, routing fails open to the remaining
configured chain.
