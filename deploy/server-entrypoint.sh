#!/bin/sh
set -eu

start_tailscale() {
  if [ -z "${TAILSCALE_AUTHKEY:-}" ]; then
    echo "TAILSCALE_STATUS=disabled (reason=missing_auth_key)"
    return 0
  fi

  local state_dir='/data/tailscale'
  local socket_path='/var/run/tailscale/tailscaled.sock'
  local hostname="${TAILSCALE_HOSTNAME:-footnote-fly}"
  local tags="${TAILSCALE_TAGS:-tag:footnote-fly}"

  mkdir -p "$state_dir" /var/run/tailscale /var/cache/tailscale
  /usr/local/bin/tailscaled \
    --state="$state_dir/tailscaled.state" \
    --socket="$socket_path" \
    >/proc/1/fd/1 2>/proc/1/fd/2 &
  local tailscaled_pid=$!

  if ! timeout 30s /usr/local/bin/tailscale up \
    --auth-key="$TAILSCALE_AUTHKEY" \
    --hostname="$hostname" \
    --advertise-tags="$tags" \
    --accept-dns=true; then
    echo "TAILSCALE_STATUS=unavailable (reason=authentication_or_network_failure)"
    kill "$tailscaled_pid" 2>/dev/null || true
    return 0
  fi

  if ! /usr/local/bin/tailscale status >/dev/null 2>&1; then
    echo "TAILSCALE_STATUS=unavailable (reason=status_check_failed)"
    kill "$tailscaled_pid" 2>/dev/null || true
    return 0
  fi

  echo "TAILSCALE_STATUS=ready (hostname=$hostname)"
}

start_tailscale

RESOLUTION_JSON="$(node /usr/local/bin/trace-token-resolver.mjs)"
TRACE_API_TOKEN="$(printf '%s' "$RESOLUTION_JSON" | node -e "let d='';process.stdin.on('data',(c)=>d+=c);process.stdin.on('end',()=>{const parsed=JSON.parse(d);if(typeof parsed.token!=='string'||parsed.token.trim().length===0){process.exit(1);}process.stdout.write(parsed.token);});")"
TRACE_TOKEN_SOURCE="$(printf '%s' "$RESOLUTION_JSON" | node -e "let d='';process.stdin.on('data',(c)=>d+=c);process.stdin.on('end',()=>{const parsed=JSON.parse(d);const source=typeof parsed.source==='string'?parsed.source:'unknown';const tokenPath=typeof parsed.path==='string'?parsed.path:'';process.stdout.write(tokenPath?source+' ('+tokenPath+')':source);});")"
export TRACE_API_TOKEN
echo "TRACE_TOKEN_SOURCE=${TRACE_TOKEN_SOURCE}"

exec node /app/packages/discord-bot/dist/supervisor/serverNodeSupervisor.js
