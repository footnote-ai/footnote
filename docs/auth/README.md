# Account Sign-In

Footnote can use one OpenID Connect provider for administrator account sign-in.
The first slice proves identity only. It does not grant access to `/admin` or
change the existing setup/admin-settings authentication rules.

## Runtime behavior

- OIDC authorization code flow uses PKCE S256, state, and nonce.
- Footnote requests only `openid profile`.
- Login transactions live in backend memory for 10 minutes.
- Local account sessions live in backend memory for 8 hours.
- Restarting the backend signs every account out.
- Signing out ends only the Footnote session. It does not sign the account out
  of the identity provider.
- Provider tokens are validated during callback processing and are not retained.
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

## Security boundaries

- Provider application assignment decides who may complete this first sign-in
  flow.
- A signed-in account is not yet authorized for `/api/admin/*`.
- Cookies contain only opaque random identifiers.
- Identity and provider tokens are not persisted.
- The callback origin comes from `OIDC_REDIRECT_URI`, never the request `Host`.
- Failed and replayed callbacks create no session and expose only a generic
  failure message.
