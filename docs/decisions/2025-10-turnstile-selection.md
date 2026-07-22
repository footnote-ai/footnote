# Decision Record: Cloudflare Turnstile Selection

**Decision:** Adopt **Cloudflare Turnstile** as the human verification mechanism for Footnote web interactions.  
**Date:** 2025-10-27

---

## 1. Context

Footnote's public endpoints (e.g., API gateway, registration forms, demo interface) require protection against automated abuse.  
A human-verification mechanism is needed to prevent spam, brute-force attempts, and scripted probes while staying consistent with the project's ethical commitments to transparency, user dignity, and privacy.

Candidate solutions evaluated:

- Google reCAPTCHA v2/v3
- Cloudflare Turnstile
- Self-hosted hCaptcha (declined on licensing grounds)

---

## 2. Decision

**Cloudflare Turnstile** will be implemented as the default verification mechanism for all public web interactions requiring human validation.  
Turnstile will run an invisible challenge by default. If that background challenge errors or times out, Footnote will replace it with a visible managed widget so the user can complete verification directly.

---

## 3. Rationale

| Criterion            | reCAPTCHA                                               | Turnstile                                       | Ethical Commentary                                |
| -------------------- | ------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| **Privacy**          | Collects behavioral telemetry, cookies, and identifiers | No tracking or profiling; anonymous attestation | Meets HL3 privacy expectations                    |
| **Transparency**     | Closed heuristic models                                 | Public technical overview, no user scoring      | Easier to audit and document                      |
| **User Experience**  | Frequent “image grid” puzzles                           | Invisible or minimal                            | Reduces cognitive friction; dignified interaction |
| **Self-hosting fit** | Requires Google scripts                                 | Works with CDN or custom backend                | Compatible with decentralized deployments         |
| **Licensing**        | Proprietary                                             | Free under Cloudflare ToS                       | No conflict with MIT + HL3 dual license           |

Footnote's ethical stance prioritizes user autonomy and minimal data collection.  
Turnstile verifies _browser integrity_ rather than _personal identity_, aligning with the project’s guiding principle: **verify function, not essence**.

---

## 4. Alternatives Considered

**reCAPTCHA:** Technically mature but inconsistent with transparency and privacy principles; conflicts with community self-hosting goals.  
**hCaptcha:** More privacy-aware than reCAPTCHA but monetizes user attention and carries commercial license restrictions incompatible with the project's open philosophy.

---

## 5. Consequences

- Introduces a limited dependency on Cloudflare infrastructure, mitigated by modular design and future pluggable verification options.
- Improves UX and accessibility for users.
- Reduces telemetry exposure and simplifies compliance documentation.
- Opens a future path toward a **Footnote-native attestation system** modeled on Turnstile's privacy design.

## 6. Implementation Notes

**Mode Selection: Invisible With Managed Fallback**

- **Chosen Mode**: Cloudflare's invisible widget with manual execution, followed by a normal-size managed widget only after failure.
- **Why Hybrid Mode**: The common path stays silent and preserves the page layout. Privacy-focused browsers still have a visible recovery path when the background challenge cannot finish.
- **Implementation Details**:
    - Uses `onSuccess` to store the token before enabling submission
    - Executes the invisible widget after it reports that it has loaded
    - Falls back on widget error, execution rejection, timeout, or rejected server verification
    - Does not mount the managed widget until fallback is required
    - Keeps the invisible widget absolutely positioned at zero size so it never participates in layout
    - Uses an explicit English language setting instead of browser auto-detection
    - Shows a direct Brave Shields hint if the challenge reports an error
- **Technical Constraints**: Browser privacy protections can still block Cloudflare resources. The managed fallback must remain absent from the document flow until needed, then stay visible long enough for the user to retry.
- **Token Characteristics**:
    - Production tokens: ~200+ characters
    - Single-use only
    - 5-minute expiry
    - Generated when either widget completes
- **Error Handling**: Invisible failures mount the managed fallback. Managed-widget errors remain visible beside the challenge so users can adjust site-level browser protections and retry.

---

## 7. Provenance

- **Discussion thread:** _TBD_ (link to GitHub issue or Discord discussion)
- **Author(s):** Jordan
- **Approved by:** policy maintainers
- **Implementation PR:** _TBD_

---
