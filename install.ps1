# ============================================================
# Nova Cortex — Installer pentru Windows
# Utilizare: iex (irm https://raw.githubusercontent.com/danutmitrut/nova-cortex/main/install.ps1)
# Sau local: powershell -ExecutionPolicy Bypass -File install.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function ok   { param($s) Write-Host "  [OK] $s" -ForegroundColor Green }
function warn { param($s) Write-Host "  [!]  $s" -ForegroundColor Yellow }
function fail { param($s) Write-Host "  [X]  $s" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Nova Cortex Installer" -ForegroundColor Green
Write-Host "  ---------------------"
Write-Host ""

# ── Node.js ──────────────────────────────────────────────────
try {
  $nodeVersion = node -e "console.log(process.version)" 2>&1
  $nodeMajor   = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
  if ($nodeMajor -lt 20) {
    fail "Node.js $nodeVersion detectat — necesită v20+. Descarcă de la https://nodejs.org"
  }
  ok "Node.js $nodeVersion"
} catch {
  fail "Node.js nu este instalat. Descarcă v20+ de la https://nodejs.org"
}

# ── Git ───────────────────────────────────────────────────────
try {
  $gitVersion = git --version 2>&1
  ok $gitVersion
} catch {
  fail "Git nu este instalat. Descarcă de la https://git-scm.com"
}

# ── Clone / actualizare repo ─────────────────────────────────
$InstallDir = "$env:USERPROFILE\nova-cortex"

if (Test-Path "$InstallDir\.git") {
  warn "Nova Cortex există deja în $InstallDir — actualizez..."
  git -C $InstallDir pull --ff-only
} else {
  Write-Host ""
  Write-Host "  Clonez Nova Cortex in $InstallDir..."
  git clone https://github.com/danutmitrut/nova-cortex.git $InstallDir
}
ok "Repo: $InstallDir"

# ── npm install ───────────────────────────────────────────────
Set-Location $InstallDir
npm install --silent
ok "Dependente instalate"

# ── Claude CLI ───────────────────────────────────────────────
$claudeExists = Get-Command claude -ErrorAction SilentlyContinue
if ($claudeExists) {
  ok "Claude CLI: $($claudeExists.Source)"
} else {
  warn "Claude CLI neinstalat — instalez..."
  npm install -g @anthropic-ai/claude-code
  ok "Claude CLI instalat"
}

# ── Comandă nova în PATH ──────────────────────────────────────
$novaBat = "$InstallDir\nova.bat"
@"
@echo off
cd /d "$InstallDir"
node --experimental-strip-types src\nova.ts %*
"@ | Set-Content -Path $novaBat -Encoding ASCII

# Adaugă InstallDir în PATH pentru sesiunea curentă și permanent
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("PATH", "$userPath;$InstallDir", "User")
  $env:PATH += ";$InstallDir"
  ok "nova.bat adaugat in PATH"
} else {
  ok "nova.bat deja in PATH"
}

# ── Wizard ───────────────────────────────────────────────────
Write-Host ""
Write-Host "  Instalare completa!" -ForegroundColor Green
Write-Host ""
Write-Host "  Pornind wizard-ul de configurare..."
Write-Host ""
Start-Sleep -Seconds 1

node --experimental-strip-types "$InstallDir\src\nova.ts" setup
