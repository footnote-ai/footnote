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

## Runtime Lifecycle Logs

Footnote writes two structured lifecycle events for its runtime paths:

- `footnote.runtime.starting` when a process begins startup.
- `footnote.runtime.ready` when that process reaches its own readiness point.

The readiness field has a specific meaning:

- `http_listener`: the backend is accepting HTTP requests.
- `discord_client`: the Discord client is ready and startup recovery is done.
- `docker_probe`: the launcher has passed its Docker readiness check.
- `supervision_active`: the supervisor is watching its child processes. This
  does not mean that every child is ready.

Each event identifies its service. Discord logs may also include the stable
node and profile IDs. These logs do not contain prompts, responses, secrets, or
user, guild, channel, or request IDs. Routine detail is kept at `debug` so the
normal `info` output stays easy to scan; warnings and errors remain visible.

Use `footnote logs` or the deployment platform's log viewer to search for the
event names when checking startup.

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

3. Set secrets in `.env` (or platform secrets). Features that document
   bootstrap environment values may also read them from the process environment.

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
pnpm compose:up
```

## Settings vs Secrets

- `footnote.yaml`: non-secret runtime behavior
- `.env` / process environment / Fly secrets: secret and documented bootstrap values

`footnote.yaml` can contain env var names for Discord bot credentials (for example `discord-token-env: DISCORD_TOKEN`) but must not contain secret values.

## Optional account sign-in

Account sign-in uses four backend environment values:

```text
OIDC_ISSUER_URL=https://identity.example/application/o/footnote/
OIDC_CLIENT_ID=footnote
OIDC_CLIENT_SECRET=<secret>
OIDC_REDIRECT_URI=https://footnote.example/api/auth/callback
```

Keep `OIDC_CLIENT_SECRET` in `.env` or the deployment platform's secret store.
Pass the other values as non-secret bootstrap environment variables. Compose
loads local values from the root `.env`; Fly operators may set deployment
environment values using their normal platform workflow.

See [Account Sign-In](../docs/auth/README.md) for validation rules and the
minimum Authentik setup.

The Fly wrappers also offer an optional Authelia profile. Run
`./deploy/fly/deploy.sh --auth-mode authelia` (or `-AuthMode authelia` in
PowerShell) to provision it before applying the four OIDC secrets. The default
and `preserve` mode leave the current authentication configuration unchanged.
See [Account Sign-In](../docs/auth/README.md#authelia-on-fly-profile)
for ownership, reruns, recovery, and teardown. This profile is single-instance
and non-HA; it is not a production identity-storage recommendation.

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
  pnpm context:bundle
  fly deploy -c deploy/fly/server.toml \
  --build-arg FOOTNOTE_CONTEXT_COMMIT_SHA=$(git rev-parse HEAD)
```

Local Compose source build and start:

```bash
pnpm compose:up
```

The wrapper packages the approved project documents and gives Docker the Git
commit they came from before starting Compose. Pass Compose flags after `--`,
for example `pnpm compose:up -- -d`.

The server image includes the approved project documents because it does not
contain `.git`. Always pass the source commit when deploying. That keeps
project-document citations tied to the exact content used to build the index.
GitHub Actions passes the commit through `github.sha`.

For Fly, `pnpm settings` and `pnpm reset` issue links through `fly ssh console`
against the app detected from `deployment.fly-app`, `FLY_APP_NAME`, or
`deploy/fly/server.toml`. The backend operator-link endpoint only accepts
loopback requests, so public web traffic cannot mint settings links.

### PC-hosted TrustGraph over Tailscale

The canonical Fly server can optionally join the same Tailscale network as a
PC-hosted TrustGraph 2.8 deployment. This uses the existing Footnote Fly
Machine; it does not create a second Fly Machine or expose TrustGraph publicly.
The image includes `tailscale` and `tailscaled`, while
`deploy/server-entrypoint.sh` starts them only when `TAILSCALE_AUTHKEY` is
present. If Tailscale is unavailable, Footnote starts normally and the
TrustGraph adapter remains fail-open.

#### One-time TrustGraph setup

Use the TrustGraph GUI to create a workspace named `footnote` and a
workspace-scoped API key. Do not use the bootstrap/admin token for Fly. Load
the reviewed context into that workspace from the Footnote checkout:

```powershell
$env:TRUSTGRAPH_URL = 'http://localhost:8888'
$env:TRUSTGRAPH_WORKSPACE = 'footnote'
$env:TRUSTGRAPH_FLOW_ID = 'default'
$env:TRUSTGRAPH_COLLECTION = 'footnote-repository-context'
$env:TRUSTGRAPH_TOKEN = '<workspace-scoped-key>'
pnpm context:repo:load
```

Keep TrustGraph reachable on the PC at port `8888`. In Windows Firewall,
allow TCP `8888` from the Tailscale range (`100.64.0.0/10`) and remove or
restrict any broader inbound rule for that port. In Tailscale access policy,
grant the Fly node tag (for example, `tag:footnote-fly`) access only to the PC
TrustGraph node and port `8888`.

#### Fly deployment values

The deploy wrappers require these values before deploying the TrustGraph-
enabled server. They read them from the untracked root `.env` when present or
prompt without echoing required values:

```text
TAILSCALE_AUTHKEY=<reusable, pre-authorized ephemeral auth key>
EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_API_TOKEN=<workspace-scoped-key>
EXECUTION_CONTRACT_TRUSTGRAPH_BASE_URL=http://<pc-magicdns-hostname>:8888
EXECUTION_CONTRACT_TRUSTGRAPH_FLOW=default
EXECUTION_CONTRACT_TRUSTGRAPH_COLLECTION=footnote-repository-context
EXECUTION_CONTRACT_TRUSTGRAPH_WORKSPACE_REF=footnote
```

The Fly deploy wrappers enable the HTTP adapter during deployment. The
adapter token is sent only as a bearer token to TrustGraph. The workspace
reference is diagnostic; TrustGraph authorization comes from the token.

Deploy with the normal wrapper:

```powershell
./deploy/fly/deploy.ps1
```

After deployment, verify `TAILSCALE_STATUS=ready` in the Fly logs and run one
chat request using the loaded repository context. Confirm the response trace
contains bounded TrustGraph metadata and source provenance. To disable remote
retrieval without changing the image, set
`EXECUTION_CONTRACT_TRUSTGRAPH_KILL_SWITCH=true` as a Fly environment value and
restart the Machine.

### Memory verification for multi-bot Machines

Capture a same-configuration baseline before deployment. After deployment, wait
ten minutes, complete one ordinary chat with each enabled bot, then wait five
more minutes before sampling. Replace the placeholders with the Fly app and
Machine ID:

```bash
fly machine list -a <app>
fly ssh console -a <app> -s <machine-id> -C "grep MemAvailable /proc/meminfo; ps -o pid,rss,comm -C node"
```

`MemAvailable` is in KiB; divide by 1024 for MiB. Record each Node process RSS
in KiB as well. For a three-bot 768 MB Machine, acceptance requires at least
128 MiB `MemAvailable` and at least 15% less used memory than the fresh,
same-config baseline. Also run the supported large image-generation case with
previews enabled and disabled; it must complete without an OOM kill or task
recovery.
