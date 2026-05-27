# Deployment

Footnote deploys as one server container.

## Runtime Paths

- Root quickstart: [README Quickstart](../README.md#quickstart)
- User CLI path (primary): download `footnote` binary, run `footnote start`.
- Deployment compose path: use `deploy/compose.yml` (GHCR image default).
- Developer repo path: `git clone` + `pnpm start`.

## Prerequisites

- Node.js 22+
- `pnpm` (repo uses `pnpm@10.27.0`)

Install `pnpm` with one of:

```bash
corepack enable && corepack prepare pnpm@10.27.0 --activate
```

```bash
npm i -g pnpm@10.27.0
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

4. Validate env:

```bash
pnpm validate-env --target server
```

5. Start:

```bash
docker compose -f deploy/compose.yml up
```

For local source builds during development:

```bash
docker compose -f deploy/compose.yml -f deploy/compose.dev-build.yml up --build
```

## Volume Name Migration Note

The compose volume identifier changed from `footnote-data` (old) to
`footnote_data` (new). This is a breaking naming change for existing Docker
hosts.

If you already have data in `footnote-data`, choose one of these paths:

1. Migrate data to `footnote_data`:
   Create the new volume, then run a one-time copy using a temporary container
   that mounts both volumes and copies all files from `footnote-data` into
   `footnote_data`.
2. Keep the old volume name for backwards compatibility:
   Add a compose override that maps `/data` to `footnote-data` so existing data
   continues to be used without migration.

Use the exact identifiers `footnote_data` and `footnote-data` when updating
compose files and operational runbooks.

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

Behavior:

- optional bot missing credentials: disabled with explicit log reason
- required bot missing credentials: startup fails
- no `discord-bots`: fail-open startup with zero bots

## Fly.io

Single-app deploy:

- `./deploy/fly/deploy.sh`
- `./deploy/fly/deploy.ps1`

Manual deploy:

```bash
fly deploy -c deploy/fly/server.toml
```
