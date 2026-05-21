# Feature Proposal: Desktop PWA Shell With Launcher Runtime Authority

**Last Updated:** 2026-05-21

---

## Overview

Footnote should offer an app-like desktop experience without introducing a
second frontend.

The near-term path is:

- use a desktop-installable PWA as the user-facing shell
- keep `packages/web` as the main product surface
- keep `footnote` launcher as runtime lifecycle authority
- defer native desktop helper/tray work to a later branch

This proposal is about reducing user friction now while preserving clean
architecture boundaries.

---

## Why This

The current standalone CLI path works, but most non-developer users still think
in terms of “open app icon” rather than “run command in terminal.”

A PWA gives us that install-like UX quickly:

- icon on taskbar/start menu
- dedicated app window
- same product UI already in `packages/web`

It does that without forking app behavior or adding a second desktop UI stack
before we have enough product signal to justify it.

---

## Current Context

Footnote already has runtime separation in place:

- user runtime lifecycle is handled by launcher commands (`start`, `stop`,
  `status`, `open`, `logs`)
- runtime contracts in `packages/launcher-core` include a future local/native
  seam (`RuntimeKind = 'docker' | 'local'`)
- web UX lives in `packages/web`

That means we can improve desktop usability now without collapsing boundaries.

---

## Proposed Model

Use a two-layer desktop shape:

1. UX shell: installable PWA serving the existing web app
2. Runtime authority: launcher-managed backend runtime

The PWA remains a UI shell. It should not become a second runtime supervisor.

---

## Scope For V1

V1 should include:

- PWA manifest and installability for desktop browsers
- app icon/name/start URL polish for installed experience
- clear local-runtime dependency messaging in UI where needed
- no product-route divergence from `packages/web`

V1 should not include:

- native tray process
- OS service registration
- desktop-native runtime bootstrap daemon
- a second app architecture for desktop

---

## Runtime Behavior

Desktop usage remains:

- backend runtime starts through `footnote start` (or equivalent launcher flow)
- web app communicates with local backend over localhost URL
- launcher remains source of truth for lifecycle and diagnostics

If runtime is not live, user guidance should point to launcher commands.

---

## Why Not Desktop Capacitor

Capacitor remains a strong fit for mobile packaging, but it is not the best fit
for Footnote desktop strategy.

For desktop, we already have:

- a web app surface
- a launcher runtime boundary
- release tooling for standalone launcher binaries

Adding a separate desktop wrapper stack through mobile-oriented tooling would
increase maintenance without immediate product gain.

---

## Native Desktop Follow-Up (Deferred)

A later branch may add a thin native desktop helper (for example tray/status
integration) if real usage shows a clear need.

That branch should stay thin:

- no duplicate product UI
- no relocation of product logic out of `packages/web`
- no bypass of launcher runtime authority

The helper should orchestrate launcher behavior, not replace it.

---

## Decision Gates For Native Helper

Only proceed with native helper/tray work when at least one is true:

- repeated support friction around startup/runtime state in PWA flow
- clear demand for tray controls and startup-at-login behavior
- strong need for OS-native integration beyond browser/PWA affordances

If those signals are weak, keep the PWA + launcher model.

---

## Risks And Failure Modes

Main risks:

- users assume PWA automatically starts backend runtime
- support confusion when app window opens but runtime is down
- ad hoc desktop-specific conditionals drift into core web behavior

Mitigations:

- explicit runtime-state messaging in the desktop UX path
- keep launcher commands as canonical remediation path
- keep desktop-specific concerns out of core app logic unless justified

---

## Proposed Direction

Footnote should adopt a desktop PWA shell now and defer native desktop helper
work to a later branch.

This gives users install-like desktop UX with minimal architectural risk and
preserves optionality for deeper desktop integration later.

