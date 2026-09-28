# Account Sign-In

Footnote can use one OpenID Connect provider for account sign-in.
Footnote supports the OIDC protocol, not a specific identity provider.
Deployment tooling may support particular providers, but the runtime receives
only the standard OIDC configuration values and does not know which provider
was selected. OIDC proves who signed in. Footnote maps that identity to a
stable internal account and makes the separate administrator authorization
decision.

## Connect a Discord account

Run `/account connect` in Discord. The bot uses the Discord interaction's user
ID and replies privately with a ten-minute connection link. The link's random
capability is placed in its URL fragment, exchanged once for an HttpOnly
browser cookie, and removed from the address bar. The browser signs in through
this same OIDC flow and asks for explicit approval. Approval displays an
eight-digit code; it does not persist the Discord mapping. Enter the code with
`/account confirm code:<code>` from the Discord account that started the flow.

The backend stores a separate Discord-ID-to-internal-account mapping in the
account SQLite database. A Discord ID is never an account ID or OIDC issuer.
One Discord identity cannot move between accounts; a conflict does not merge
or expose the other account. The connection transaction is process-local,
single-use, limited to one active request per Discord user, and expires after
ten minutes. Five incorrect codes invalidate it. A restart requires starting
again. `/account status` privately reports whether backend ownership resolution
finds a mapping.

The bot's trusted internal-service credential is required for start, status,
and confirmation. Account sign-in or Discord connection never claims historical
incidents. Ordinary Discord messages and chat context do not create or resolve
account ownership.

Connection capabilities and confirmation codes are never logged or persisted.
Only the Discord snowflake is stored as a unique external mapping to the
internal account; Discord usernames, display names, email, and provider tokens
are not retained for this flow. Browser writes use the account session's CSRF
token and no-store responses. Signing out the approving session invalidates its
pending transaction. A missing OIDC provider, trusted service credential, or
account store disables only connection operations; public chat remains
available. Connecting an account grants no administrator access and does not
claim a historical incident.

## Runtime behavior

- OIDC authorization code flow uses PKCE S256, state, and nonce.
- Footnote requests only `openid profile`.
- Login transactions live in backend memory for 10 minutes.
- Local account sessions live in backend memory for 8 hours.
- Restarting the backend signs every account out.
- Signing out ends only the Footnote session. It does not sign the account out
  of the identity provider.
- Provider tokens are validated during callback processing and are not retained.
- A successful OIDC callback resolves or creates a Footnote account before the
  local session is issued.
- `OIDC_ADMIN_IDENTITIES` grants administrator access only to listed
  `issuer|subject` pairs. Other admitted identities remain regular users.
- The account store contains only internal account records and external
  identity mappings. Email, display name, and broad provider claims are not
  account ownership data.
- When OIDC is disabled or unavailable, public Footnote keeps running.

## Configuration

Set the OIDC connection values in the backend process environment. Add the
administrator allowlist when this instance has OIDC administrators:

```text
OIDC_ISSUER_URL=https://identity.example/application/o/footnote/
OIDC_CLIENT_ID=footnote
OIDC_CLIENT_SECRET=<secret>
OIDC_REDIRECT_URI=https://footnote.example/api/auth/callback
OIDC_ADMIN_IDENTITIES=https://identity.example/application/o/footnote/|admin-subject
```

`OIDC_CLIENT_SECRET` is secret. The other four values are non-secret bootstrap
environment values and intentionally do not belong in `footnote.yaml`.

The issuer must use HTTPS. The redirect URI must use HTTPS except for local
loopback development, where `http://localhost`, `http://127.0.0.1`, and
`http://[::1]` are accepted. Its path must be exactly `/api/auth/callback`.

Unset all OIDC values to disable sign-in quietly. Partial or invalid
configuration disables sign-in and logs a warning containing key names only.

## Authentik test setup

Create an OAuth2/OpenID provider and application in Authentik:

1. Use a confidential client.
2. Enable the authorization code grant.
3. Set client authentication to `client_secret_basic`.
4. Add the exact `OIDC_REDIRECT_URI` as a strict redirect URI.
5. Include `openid` and `profile` scope mappings.
6. Require PKCE with S256.
7. Assign the application to the people admitted to Footnote.
8. Copy the provider issuer, client ID, and client secret into the Footnote
   environment.

Visit `/account` and choose **Sign in**. After callback validation, the page
shows the local identity and expiry. **Sign out** clears only the local session.
Leave `OIDC_ADMIN_IDENTITIES` empty to admit regular accounts without granting
them administrator access.

## Authorization and recovery boundaries

- Provider application assignment decides who may complete the sign-in flow.
- The Footnote account store resolves the validated issuer-and-subject mapping
  transactionally, so repeated first sign-ins cannot create duplicate accounts.
- The backend, not the `/admin` page, authorizes account sessions for selected
  `/api/admin/*` settings operations.
- Account-session writes require `x-auth-csrf`.
- The existing `SETTINGS_ADMIN_TOKEN` trusted-token path and short-lived
  setup/operator sessions remain available for bootstrap and recovery. They do
  not become permanent account access.
- Cookies contain only opaque random identifiers.
- Identity and provider tokens are not persisted. Administrator audit events
  may contain only a deterministic hash of `issuer + subject`, not raw claims.
- Future Footnote-owned data must reference the internal account ID, not the
  OIDC issuer or subject.
- The callback origin comes from `OIDC_REDIRECT_URI`, never the request `Host`.
- Failed and replayed callbacks create no session and expose only a generic
  failure message.

## Delivered Authelia-on-Fly profile

The Fly wrappers can optionally provision a small, single-instance Authelia
profile. The default remains the current authentication configuration:

```bash
./deploy/fly/deploy.sh
./deploy/fly/deploy.sh --auth-mode preserve
./deploy/fly/deploy.sh --auth-mode authelia
```

On PowerShell, use `-AuthMode preserve` or `-AuthMode authelia`. An empty
interactive choice means `preserve`. The provider app defaults to
`<footnote-app>-auth`, uses the server's `primary_region`, and exposes the
issuer at `https://<footnote-app>-auth.fly.dev`. The operator confirms the
Footnote public URL before the exact `/api/auth/callback` redirect is applied.

The profile pins Authelia `4.39.20` by OCI digest and owns:

- one always-running 512 MB Fly Machine;
- one 1 GB Fly volume named `authelia_data`;
- a static Authelia file user database at `/config/users.yml`;
- `/data` reserved for SQLite and notification state on the persistent volume;
- local SQLite data at `/data/authelia.sqlite3`;
- filesystem notifications at `/data/notifications.txt`.

Generated manifests, sanitized configuration, user and client-secret hashes,
and safe deployment metadata live in
`.footnote/deploy/auth/authelia/<app>/`, which is ignored by Git. Plaintext
credentials are kept in memory only long enough to send them through Fly's
secret import. They are not written to generated files or command arguments.

Reruns require the matching local state and preserve the administrator
password, signing key, HMAC secret, session secret, storage key, and client
secret. If the provider app exists without local state, or managed secret keys
are missing, the tool stops with recovery guidance instead of guessing. If
remote Footnote OIDC keys already exist, only their names are shown and the
operator must type `REPLACE` before the OIDC values are replaced together. Committed
OIDC keys in `server.toml` are an error and must be removed manually.

The managed Footnote OIDC values include `OIDC_ADMIN_IDENTITIES`. On a fresh
Authelia profile, provisioning generates a version-4 UUID, binds it to the
intended administrator with the pinned Authelia storage CLI, verifies the
binding, and writes `https://<footnote-app>-auth.fly.dev|<uuid>`. The UUID is
the provider-managed OIDC subject; the operator does not enter a username or
email as Footnote's identity key. The sanitized UUID is retained as stable
recovery state, not as a promise that interrupted provisioning can resume
automatically. A profile created before the administrator
allowlist existed must be upgraded explicitly. Obtain existing subjects with
the pinned provider's supported export command:

```bash
fly ssh console -a <footnote-app>-auth -C "authelia storage user identifiers export --file /tmp/identifiers.yml --config /config/configuration.yml --sqlite.path /data/authelia.sqlite3 && cat /tmp/identifiers.yml"
```

Use the exported OpenID identifier in the `issuer|sub` value before rerunning
the provisioning command. The tool stops if the value is absent, so an existing
administrator is not silently downgraded and no other admitted user is granted
administrator access.

Provisioning and health checks complete before Footnote authentication changes.
Failures keep existing Footnote authentication unchanged, retain created
Authelia resources for diagnosis, and print a cleanup command. To tear down a
profile after recording evidence, remove the Footnote OIDC secrets manually,
then run:

```bash
fly volumes list -a <footnote-app>-auth
fly apps destroy <footnote-app>-auth --yes
rm -rf .footnote/deploy/auth/authelia/<footnote-app>-auth
```

This first profile is limited and password-only. Password reset and MFA
enrollment are not supported. Do not treat the file backend, SQLite volume, or
single Machine as production or high-availability identity storage.
