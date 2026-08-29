param(
  [ValidateSet('preserve', 'authelia')]
  [string]$AuthMode,
  [switch]$EnableTrustGraph
)

$ErrorActionPreference = 'Stop'

# Deploys the canonical server Fly app, ensuring required secrets are set.

if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
  Write-Host "Fly CLI is required. Install from https://fly.io/docs/flyctl/install/"
  exit 1
}

function Get-FlyAppName {
  param([string]$ConfigPath)
  # Extract app name from server.toml to keep scripts DRY.
  $content = Get-Content $ConfigPath -Raw
  if ($content -match '(?m)^\s*app\s*=\s*["'']([^"'' ]+)["'']') {
    return $Matches[1]
  }
  throw "Unable to find app name in $ConfigPath"
}

function Ensure-FlyApp {
  param([string]$ConfigPath)
  # Create app if missing; no-op when it already exists.
  $appName = Get-FlyAppName -ConfigPath $ConfigPath
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& fly apps create $appName 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    $outputText = $output | Out-String
    if ($outputText -match 'already exists|already taken|Name has already been taken') {
      Write-Host "Fly app already exists: $appName"
      return
    }
    Write-Host $output
    throw "Failed to create Fly app: $appName"
  }
  Write-Host "Created Fly app: $appName"
}

function Get-FlySecretNames {
  param([string]$AppName)
  # Read existing secrets so we only prompt for missing values.
  $output = & fly secrets list -a $AppName --json 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }
  try {
    return @($output | ConvertFrom-Json | ForEach-Object { $_.name })
  } catch {
    throw "Unable to parse Fly secret list for $AppName"
  }
}

function Invoke-EnvValidation {
  param(
    [ValidateSet('fly-server')]
    [string]$Target,
    [string]$AppName
  )

  $assumedPresent = (Get-FlySecretNames -AppName $AppName) -join ','
  Write-Host "Validating env for $Target..."
  if ($assumedPresent -and $assumedPresent.Trim().Length -gt 0) {
    pnpm validate-env --target $Target --assume-present $assumedPresent
    if ($LASTEXITCODE -ne 0) {
      throw "env validation failed with exit code $LASTEXITCODE"
    }
  } else {
    pnpm validate-env --target $Target
    if ($LASTEXITCODE -ne 0) {
      throw "env validation failed with exit code $LASTEXITCODE"
    }
  }
}

function Get-EnvValueFromFile {
  param(
    [string]$EnvPath,
    [string]$Key
  )
  # Prefer the current process environment, then load a specific key from .env.
  $processValue = [Environment]::GetEnvironmentVariable($Key, 'Process')
  if ($processValue -and $processValue.Trim().Length -gt 0) {
    return $processValue.Trim()
  }
  if (-not (Test-Path $EnvPath)) {
    return $null
  }
  $lines = Get-Content $EnvPath
  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }
    $parts = $trimmed -split '=', 2
    if ($parts.Count -lt 2) {
      continue
    }
    if ($parts[0].Trim() -eq $Key) {
      return $parts[1].Trim()
    }
  }
  return $null
}

function Test-CanonicalPresentationEnabled {
  param([string]$SettingsPath)

  if (-not (Test-Path $SettingsPath)) {
    return $false
  }
  return [bool](Select-String -Path $SettingsPath -Pattern '^\s*chat-presentation-enabled:\s*true\s*$' -Quiet)
}

function Get-OrCreate-TraceToken {
  param([string]$EnvPath)
  $existing = Get-EnvValueFromFile -EnvPath $EnvPath -Key 'TRACE_API_TOKEN'
  if ($existing -and $existing.Trim().Length -gt 0) {
    return $existing.Trim()
  }

  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''

  Write-Host "Generated TRACE_API_TOKEN for deployment."
  if (Test-Path $EnvPath) {
    $content = Get-Content $EnvPath
    if ($content -match '^(TRACE_API_TOKEN=)') {
      $content = $content -replace '^(TRACE_API_TOKEN=).*', "`$1$token"
      Set-Content -Path $EnvPath -Value $content -Encoding UTF8
    } else {
      Add-Content -Path $EnvPath -Value "TRACE_API_TOKEN=$token"
    }
  } else {
    Set-Content -Path $EnvPath -Value "TRACE_API_TOKEN=$token" -Encoding UTF8
  }

  return $token
}

function Read-RequiredSecretValue {
  param(
    [string]$Secret,
    [string]$AppName
  )

  $secureValue = Read-Host "Enter value for $Secret (required for $AppName)" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Ensure-FlySecrets {
  param(
    [string]$AppName,
    [string[]]$RequiredSecrets,
    [string[]]$OptionalSecrets,
    [string]$EnvPath
  )
  # Prompt only for missing secrets; prefer .env values when available.
  Write-Host "Checking secrets for $AppName..."
  $existing = Get-FlySecretNames -AppName $AppName
  foreach ($secret in $RequiredSecrets) {
    if ($existing -notcontains $secret) {
      Write-Host "Setting required secret $secret for $AppName..."
      $value = Get-EnvValueFromFile -EnvPath $EnvPath -Key $secret
      if ($value) {
        Write-Host "Using $secret from $EnvPath."
      } elseif ($secret -eq 'TRACE_API_TOKEN') {
        $value = Get-OrCreate-TraceToken -EnvPath $EnvPath
      } else {
        $value = Read-RequiredSecretValue -Secret $secret -AppName $AppName
      }
      if ($value -and $value.Trim().Length -gt 0) {
        & fly secrets set "$secret=$value" -a $AppName | Out-Null
        Write-Host "Set $secret for $AppName."
      } else {
        throw "Missing required secret $secret for $AppName"
      }
    }
  }

  foreach ($secret in $OptionalSecrets) {
    if ($existing -notcontains $secret) {
      Write-Host "Setting optional secret $secret for $AppName..."
      $value = Get-EnvValueFromFile -EnvPath $EnvPath -Key $secret
      if ($value) {
        Write-Host "Using $secret from $EnvPath."
      } else {
        $value = Read-Host "Enter value for $secret (optional for $AppName, leave blank to skip)"
      }
      if ($value -and $value.Trim().Length -gt 0) {
        & fly secrets set "$secret=$value" -a $AppName | Out-Null
        Write-Host "Set $secret for $AppName."
      } else {
        Write-Host "Skipped $secret for $AppName."
      }
    }
  }
}

function Enable-FlyTrustGraphRuntime {
  param([string]$AppName)

  Write-Host "Enabling TrustGraph HTTP retrieval with deployment-scoped ownership validation for $AppName..."
  & fly secrets set `
    'EXECUTION_CONTRACT_TRUSTGRAPH_ENABLED=true' `
    'EXECUTION_CONTRACT_TRUSTGRAPH_KILL_SWITCH=false' `
    'EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_MODE=http' `
    'EXECUTION_CONTRACT_TRUSTGRAPH_OWNERSHIP_BINDING_MODE=deployment' `
    -a $AppName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to enable TrustGraph runtime for $AppName"
  }
}

function Upload-FootnoteSettings {
  param(
    [string]$AppName,
    [string]$RepoRootPath
  )

  $settingsPath = Join-Path $RepoRootPath 'footnote.yaml'
  if (-not (Test-Path $settingsPath)) {
    Write-Host "No footnote.yaml found at $settingsPath; skipping remote settings upload."
    return
  }

  Write-Host "Uploading canonical footnote.yaml to /data/config/footnote.yaml..."
  try {
    Get-Content -Path $settingsPath -Raw | fly ssh console -a $AppName -C "mkdir -p /data/config && cat > /data/config/footnote.yaml" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Unable to upload footnote.yaml to $AppName. Continuing deploy."
      return
    }
    Write-Host "Uploaded footnote.yaml to $AppName."
  } catch {
    Write-Warning "Unable to upload footnote.yaml to $AppName. Continuing deploy."
  }
}

$configRoot = $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $configRoot '..\..')
$envPath = Join-Path $configRoot '..\..\.env'

Push-Location $repoRoot
try {
$serverConfigPath = Join-Path $configRoot 'server.toml'
$serverAppName = Get-FlyAppName -ConfigPath $serverConfigPath
$settingsPath = Join-Path $repoRoot 'footnote.yaml'
$presentationEnabled = Test-CanonicalPresentationEnabled -SettingsPath $settingsPath
if ($presentationEnabled) {
  $existingSecrets = Get-FlySecretNames -AppName $serverAppName
  $localOpenRouterKey = Get-EnvValueFromFile -EnvPath $envPath -Key 'OPENROUTER_API_KEY'
  if ($existingSecrets -notcontains 'OPENROUTER_API_KEY' -and (-not $localOpenRouterKey)) {
    throw 'Canonical presentation is enabled, but OPENROUTER_API_KEY is neither configured on Fly nor available locally. Refusing to mutate or deploy the app.'
  }
}

Write-Host "Ensuring Fly app exists ($serverAppName)..."
Ensure-FlyApp -ConfigPath $serverConfigPath

Write-Host "Choosing authentication setup..."
$authProvisionArgs = @(
  'exec',
  'tsx',
  'scripts/fly-authelia-provision.ts',
  '--repository-root',
  $repoRoot,
  '--server-config',
  $serverConfigPath
)
if ($AuthMode) {
  $authProvisionArgs += @('--mode', $AuthMode)
}
& pnpm @authProvisionArgs
if ($LASTEXITCODE -ne 0) {
  throw "Authentication setup failed with exit code $LASTEXITCODE"
}

Write-Host "Configuring server secrets..."
$requiredSecrets = @('INCIDENT_PSEUDONYMIZATION_SECRET')
if ($EnableTrustGraph) {
  $requiredSecrets += @(
    'TAILSCALE_AUTHKEY',
    'EXECUTION_CONTRACT_TRUSTGRAPH_ADAPTER_API_TOKEN',
    'EXECUTION_CONTRACT_TRUSTGRAPH_BASE_URL',
    'EXECUTION_CONTRACT_TRUSTGRAPH_TARGETS',
    'EXECUTION_CONTRACT_TRUSTGRAPH_WORKSPACE_REF'
  )
}
$optionalSecrets = @('OPENAI_API_KEY', 'OLLAMA_API_KEY', 'TRACE_API_TOKEN', 'REFLECT_SERVICE_TOKEN', 'TURNSTILE_SECRET_KEY', 'DISCORD_TOKEN', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'GITHUB_WEBHOOK_SECRET')
if ($presentationEnabled) {
  $requiredSecrets += @('OPENROUTER_API_KEY')
} else {
  $optionalSecrets += @('OPENROUTER_API_KEY')
}
Ensure-FlySecrets -AppName $serverAppName `
  -RequiredSecrets $requiredSecrets `
  -OptionalSecrets $optionalSecrets `
  -EnvPath $envPath
if ($EnableTrustGraph) {
  Enable-FlyTrustGraphRuntime -AppName $serverAppName
}
Invoke-EnvValidation -Target 'fly-server' -AppName $serverAppName
Upload-FootnoteSettings -AppName $serverAppName -RepoRootPath $repoRoot

Write-Host "Deploying server..."
$contextCommitSha = (& git -C $repoRoot rev-parse --verify 'HEAD^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or $contextCommitSha -notmatch '^[0-9a-f]{7,64}$') {
  throw "Unable to resolve a valid project-context revision."
}
pnpm context:bundle
if ($LASTEXITCODE -ne 0) {
  throw "Project-context bundle preparation failed with exit code $LASTEXITCODE"
}
fly deploy -c $serverConfigPath --build-arg "FOOTNOTE_CONTEXT_COMMIT_SHA=$contextCommitSha"
Write-Host "Scaling server to one instance..."
fly scale count 1 -a $serverAppName -y

$startScript = Join-Path $configRoot 'start.ps1'
if (Test-Path $startScript) {
  Write-Host "Starting server app..."
  & $startScript
}
} finally {
  Pop-Location
}

