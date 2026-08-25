#!/usr/bin/env bash
set -euo pipefail

# Deploys the canonical server Fly app, ensuring required secrets are set.

auth_mode=""
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || "$1" != "--auth-mode" || ("$2" != "preserve" && "$2" != "authelia") ]]; then
    echo "Usage: $0 [--auth-mode preserve|authelia]" >&2
    exit 1
  fi
  auth_mode="$2"
fi

if ! command -v fly >/dev/null 2>&1; then
  echo "Fly CLI is required. Install from https://fly.io/docs/flyctl/install/"
  exit 1
fi

get_app_name() {
  local config_path="$1"
  # Extract app name from server.toml to keep scripts DRY.
  local line
  line=$(grep -E "^app\\s*=" "$config_path" | head -n 1 || true)
  if [[ -z "$line" ]]; then
    echo "Unable to find app name in $config_path" >&2
    exit 1
  fi
  echo "$line" | sed -E "s/^app\\s*=\\s*['\\\"]([^'\\\"]+)['\\\"].*/\\1/"
}

ensure_app() {
  local config_path="$1"
  # Create app if missing; no-op when it already exists.
  local app_name
  app_name=$(get_app_name "$config_path")
  set +e
  output=$(fly apps create "$app_name" 2>&1)
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    if echo "$output" | grep -qiE "already exists|already taken|name has already been taken"; then
      echo "Fly app already exists: $app_name"
      return
    fi
    echo "$output"
    exit 1
  fi
  echo "Created Fly app: $app_name"
}

get_secret_names() {
  local app_name="$1"
  # Read existing secrets so we only prompt for missing values.
  fly secrets list -a "$app_name" 2>/dev/null | awk 'NR>1 {print $1}'
}

run_env_validation() {
  local target="$1"
  local app_name="$2"
  local assumed_present
  assumed_present=$(get_secret_names "$app_name" | paste -sd, -)

  echo "Validating env for $target..."
  if [[ -n "$assumed_present" ]]; then
    pnpm validate-env --target "$target" --assume-present "$assumed_present"
  else
    pnpm validate-env --target "$target"
  fi
}

get_env_value() {
  local env_path="$1"
  local key="$2"
  # Load a specific key from .env, if present.
  [[ -f "$env_path" ]] || return 1
  local line
  line=$(grep -E "^${key}=" "$env_path" | head -n 1 || true)
  if [[ -z "$line" ]]; then
    return 1
  fi
  echo "${line#*=}"
}

get_or_create_trace_token() {
  local env_path="$1"
  local existing
  existing=$(get_env_value "$env_path" "TRACE_API_TOKEN" || true)
  if [[ -n "$existing" ]]; then
    echo "$existing"
    return
  fi

  local token
  token=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")
  echo "Generated TRACE_API_TOKEN for deployment."

  if [[ -f "$env_path" ]]; then
    if grep -q "^TRACE_API_TOKEN=" "$env_path"; then
      sed -i "s/^TRACE_API_TOKEN=.*/TRACE_API_TOKEN=${token}/" "$env_path"
    else
      echo "TRACE_API_TOKEN=${token}" >> "$env_path"
    fi
  else
    echo "TRACE_API_TOKEN=${token}" > "$env_path"
  fi

  echo "$token"
}

read_required_secret() {
  local secret="$1"
  local app_name="$2"
  local value
  read -r -s -p "Enter value for $secret (required for $app_name): " value
  printf '\n' >&2
  printf '%s' "$value"
}

ensure_secrets() {
  local app_name="$1"
  shift
  local required_secrets=("$@")
  # Prompt only for missing secrets; prefer .env values when available.
  echo "Checking secrets for $app_name..."
  local existing
  existing=$(get_secret_names "$app_name")
  local env_path="${SCRIPT_DIR}/../../.env"

  for secret in "${required_secrets[@]}"; do
    if ! echo "$existing" | grep -qx "$secret"; then
      echo "Setting required secret $secret for $app_name..."
      value=$(get_env_value "$env_path" "$secret" || true)
      if [[ -n "$value" ]]; then
        echo "Using $secret from $env_path."
      elif [[ "$secret" == "TRACE_API_TOKEN" ]]; then
        value=$(get_or_create_trace_token "$env_path")
      else
        value=$(read_required_secret "$secret" "$app_name")
      fi
      if [[ -z "$value" ]]; then
        echo "Missing required secret $secret for $app_name"
        exit 1
      fi
      fly secrets set "$secret=$value" -a "$app_name" >/dev/null
      echo "Set $secret for $app_name."
    fi
  done
}

ensure_optional_secrets() {
  local app_name="$1"
  shift
  local optional_secrets=("$@")
  echo "Checking optional secrets for $app_name..."
  local existing
  existing=$(get_secret_names "$app_name")
  local env_path="${SCRIPT_DIR}/../../.env"

  for secret in "${optional_secrets[@]}"; do
    if ! echo "$existing" | grep -qx "$secret"; then
      echo "Setting optional secret $secret for $app_name..."
      value=$(get_env_value "$env_path" "$secret" || true)
      if [[ -n "$value" ]]; then
        echo "Using $secret from $env_path."
      else
        read -r -p "Enter value for $secret (optional for $app_name, leave blank to skip): " value
      fi
      if [[ -n "$value" ]]; then
        fly secrets set "$secret=$value" -a "$app_name" >/dev/null
        echo "Set $secret for $app_name."
      else
        echo "Skipped $secret for $app_name."
      fi
    fi
  done
}

enable_trustgraph_runtime() {
  local app_name="$1"
  echo "Enabling TrustGraph HTTP retrieval for $app_name..."
  fly secrets set \
    EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED=true \
    EXECUTION_CONTRACT_TRUSTGRAPH_KILL_SWITCH=false \
    EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_MODE=http \
    -a "$app_name" >/dev/null
}

upload_settings_yaml() {
  local app_name="$1"
  local settings_path="$REPO_ROOT/footnote.yaml"
  if [[ ! -f "$settings_path" ]]; then
    echo "No footnote.yaml found at $settings_path; skipping remote settings upload."
    return
  fi

  echo "Uploading canonical footnote.yaml to /data/config/footnote.yaml..."
  set +e
  fly ssh console -a "$app_name" -C "mkdir -p /data/config && cat > /data/config/footnote.yaml" < "$settings_path"
  status=$?
  set -e
  if [[ $status -ne 0 ]]; then
    echo "Warning: unable to upload footnote.yaml to $app_name. Continuing deploy."
    return
  fi
  echo "Uploaded footnote.yaml to $app_name."
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Fly/Depot uses current working directory as Docker build context.
# Force repo root so Dockerfiles can COPY workspace files reliably.
cd "$REPO_ROOT"

SERVER_CONFIG_PATH="$SCRIPT_DIR/server.toml"
server_app_name=$(get_app_name "$SERVER_CONFIG_PATH")

echo "Ensuring Fly app exists ($server_app_name)..."
ensure_app "$SERVER_CONFIG_PATH"

echo "Choosing authentication setup..."
auth_provision_args=(
  exec tsx "$REPO_ROOT/scripts/fly-authelia-provision.ts"
  --repository-root "$REPO_ROOT"
  --server-config "$SERVER_CONFIG_PATH"
)
if [[ -n "$auth_mode" ]]; then
  auth_provision_args+=(--mode "$auth_mode")
fi
pnpm "${auth_provision_args[@]}"

echo "Configuring server secrets..."
ensure_secrets "$server_app_name" INCIDENT_PSEUDONYMIZATION_SECRET TAILSCALE_AUTHKEY EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_API_TOKEN EXECUTION_CONTRACT_TRUSTGRAPH_BASE_URL EXECUTION_CONTRACT_TRUSTGRAPH_FLOW EXECUTION_CONTRACT_TRUSTGRAPH_COLLECTION EXECUTION_CONTRACT_TRUSTGRAPH_WORKSPACE_REF
ensure_optional_secrets "$server_app_name" OPENAI_API_KEY OLLAMA_API_KEY TRACE_API_TOKEN REFLECT_SERVICE_TOKEN TURNSTILE_SECRET_KEY DISCORD_TOKEN CLOUDINARY_API_KEY CLOUDINARY_API_SECRET GITHUB_WEBHOOK_SECRET
enable_trustgraph_runtime "$server_app_name"
run_env_validation fly-server "$server_app_name"
upload_settings_yaml "$server_app_name"

echo "Deploying server..."
context_commit_sha=$(git -C "$REPO_ROOT" rev-parse --verify HEAD^{commit})
if [[ ! "$context_commit_sha" =~ ^[0-9a-f]{7,64}$ ]]; then
  echo "Unable to resolve a valid project-context revision." >&2
  exit 1
fi
node "$REPO_ROOT/scripts/prepare-project-context-bundle.mjs"
fly deploy -c "$SERVER_CONFIG_PATH" --build-arg "FOOTNOTE_CONTEXT_COMMIT_SHA=$context_commit_sha"
echo "Scaling server to one instance..."
fly scale count 1 -a "$server_app_name" -y

if [[ -f "$SCRIPT_DIR/start.sh" ]]; then
  echo "Starting server app..."
  bash "$SCRIPT_DIR/start.sh"
fi

