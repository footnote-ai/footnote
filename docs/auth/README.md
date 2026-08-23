# Account Sign-In

Footnote can use one OpenID Connect provider for administrator account sign-in
and access.
Footnote supports the OIDC protocol, not a specific identity provider.
Deployment tooling may support particular providers, but the runtime receives
only the standard OIDC configuration values and does not know which provider
was selected. OIDC proves who signed in. Footnote makes the separate
administrator authorization decision.

## Runtime behavior

- OIDC authorization code flow uses PKCE S256, state, and nonce.
- Footnote requests only `openid profile`.
- Login transactions live in backend memory for 10 minutes.
- Local account sessions live in backend memory for 8 hours.
- Restarting the backend signs every account out.
- Signing out ends only the Footnote session. It does not sign the account out
  of the identity provider.
- Provider tokens are validated during callback processing and are not retained.
- During the administrator-only stage, every identity admitted by the configured
  provider may use the selected administrator settings operations. This is a
  temporary policy, not an administrator flag on the identity/session model.
- When OIDC is disabled or unavailable, public Footnote keeps running.

## Configuration

Set all four values in the backend process environment:

```text
OIDC_ISSUER_URL=https://identity.example/application/o/footnote/
OIDC_CLIENT_ID=footnote
OIDC_CLIENT_SECRET=<secret>
OIDC_REDIRECT_URI=https://footnote.example/api/auth/callback
```

`OIDC_CLIENT_SECRET` is secret. The other three values are non-secret bootstrap
environment values and intentionally do not belong in `footnote.yaml`.

The issuer must use HTTPS. The redirect URI must use HTTPS except for local
loopback development, where `http://localhost`, `http://127.0.0.1`, and
`http://[::1]` are accepted. Its path must be exactly `/api/auth/callback`.

Unset all four values to disable sign-in quietly. Partial or invalid
configuration disables sign-in and logs a warning containing key names only.

## Authentik test setup

Create an OAuth2/OpenID provider and application in Authentik:

1. Use a confidential client.
2. Enable the authorization code grant.
3. Set client authentication to `client_secret_basic`.
4. Add the exact `OIDC_REDIRECT_URI` as a strict redirect URI.
5. Include `openid` and `profile` scope mappings.
6. Require PKCE with S256.
7. Assign the application only to the administrator allowed to test Footnote.
8. Copy the provider issuer, client ID, and client secret into the Footnote
   environment.

Visit `/account` and choose **Sign in**. After callback validation, the page
shows the local identity and expiry. **Sign out** clears only the local session.

## Authorization and recovery boundaries

- Provider application assignment decides who may complete this first sign-in
  flow.
- The backend, not the `/admin` page, authorizes account sessions for selected
  `/api/admin/*` settings operations.
- Account-session writes require `x-auth-csrf`.
- The existing `SETTINGS_ADMIN_TOKEN` trusted-token path and short-lived
  setup/operator sessions remain available for bootstrap and recovery. They do
  not become permanent account access.
- Cookies contain only opaque random identifiers.
- Identity and provider tokens are not persisted. Administrator audit events
  may contain only a deterministic hash of `issuer + subject`, not raw claims.
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
operator must type `REPLACE` before all four are replaced together. Committed
OIDC keys in `server.toml` are an error and must be removed manually.

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
