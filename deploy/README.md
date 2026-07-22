# Deployment

Footnote deploys as one server container.

## Runtime Paths

- Root quickstart: [README Quickstart](../README.md#quickstart)
- User CLI path (primary): download `footnote` binary, run `footnote start`.
- Deployment compose path: use `deploy/compose.yml` (GHCR image default).
- Developer repo path: `git clone` + `pnpm start`.

## Prerequisites

- Node.js 22.13+
- `pnpm` (repo uses `pnpm@11.16.0`)

Install `pnpm` with one of:

```bash
corepack enable && corepack prepare pnpm@11.16.0 --activate
```

```bash
npm i -g pnpm@11.16.0
```

## Standalone CLI (v1)

Commands:

- `footnote start`: bootstrap missing config, pull GHCR image, start runtime, wait for readiness.
- `footnote stop`: stop/remove launcher-managed container only.
- `footnote status`: read-only status output (does not create config files).
- `footnote open`: open saved URL only when launcher-managed runtime is live.
- `footnote logs`: stream logs from launcher-managed container.

Useful flags:

- `footnote start --headless`
- `footnote start --tag <imageTag>` (persists as default tag)
- `footnote start --config-dir <path>`

Canonical artifacts:

- `deploy/Dockerfile.server`
- `deploy/server-entrypoint.sh`
- `deploy/compose.yml`
- `deploy/compose.dev-build.yml`
- `deploy/fly/server.toml`

## First Setup

1. Run local start once:

```bash
pnpm start
```

`pnpm start` will:

- create `.env` from `.env.example` if missing
- generate required local secrets if missing
- generate `footnote.yaml` if missing
- install dependencies if missing
- start backend + web

2. Keep or edit `footnote.yaml` (non-secret runtime settings):
    - default path: `./footnote.yaml`
    - advanced override: `FOOTNOTE_SETTINGS_PATH` env var

3. Set secrets only in `.env` (or platform secrets).

4. To open the temporary settings editor for the current deployment:

```bash
pnpm settings
```

`pnpm settings` auto-detects local vs Fly from `footnote.yaml`, Fly env, and
Fly manifests. Override detection when needed:

```bash
pnpm settings -- --target local
pnpm settings -- --target fly
```

5. To restart first setup with deployment defaults:

```bash
pnpm reset
```

`pnpm reset` creates an automatic backup of the current config before removing
the active config and opening a first-run setup link. It does not prompt.

6. Validate env:

```bash
pnpm validate-env --target server
```

7. Start:

```bash
docker compose -f deploy/compose.yml up
```

For local source builds during development:

```bash
docker compose -f deploy/compose.yml -f deploy/compose.dev-build.yml up --build
```

## Settings vs Secrets

- `footnote.yaml`: non-secret runtime behavior
- `.env` / Fly secrets: secret values

`footnote.yaml` can contain env var names for Discord bot credentials (for example `discord-token-env: DISCORD_TOKEN`) but must not contain secret values.

## Discord Bots

A Discord bot entry tells the server to run one bot process.
You can run multiple bots by adding multiple items in `discord-bots`.

Minimal example:

```yaml
version: 1

discord-bots:
    - id: 'main-discord'
      enabled: true
      required: false
      credentials:
          discord-token-env: 'DISCORD_TOKEN'
          discord-client-id-env: 'DISCORD_CLIENT_ID'
          discord-guild-ids-env: 'DISCORD_GUILD_IDS'
          discord-user-id-env: 'DISCORD_USER_ID'
          incident-secret-env: 'INCIDENT_PSEUDONYMIZATION_SECRET'
      profile:
          id: 'default'
          display-name: 'Footnote'
          mention-aliases: []
```

## Fly.io

Single-app deploy:

- `./deploy/fly/deploy.sh`
- `./deploy/fly/deploy.ps1`

Manual deploy:

```bash
fly deploy -c deploy/fly/server.toml
```

For Fly, `pnpm settings` and `pnpm reset` issue links through `fly ssh console`
against the app detected from `deployment.fly-app`, `FLY_APP_NAME`, `fly.toml`,
or `deploy/fly/server.toml`. The backend operator-link endpoint only accepts
loopback requests, so public web traffic cannot mint settings links.
