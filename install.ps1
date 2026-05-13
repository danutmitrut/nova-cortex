# ============================================================
# My HerOS — Installer pentru Windows
# Utilizare: iex (irm https://raw.githubusercontent.com/danutmitrut/my-heros/main/install.ps1)
# Sau local: powershell -ExecutionPolicy Bypass -File install.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function ok   { param($s) Write-Host "  [OK] $s" -ForegroundColor Green }
function warn { param($s) Write-Host "  [!]  $s" -ForegroundColor Yellow }
function fail { param($s) Write-Host "  [X]  $s" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  My HerOS Installer" -ForegroundColor Green
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
$InstallDir = "$env:USERPROFILE\my-heros"

if (Test-Path "$InstallDir\.git") {
  warn "My HerOS există deja în $InstallDir — actualizez..."
  git -C $InstallDir pull --ff-only
} else {
  Write-Host ""
  Write-Host "  Clonez My HerOS in $InstallDir..."
  git clone https://github.com/danutmitrut/my-heros.git $InstallDir
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

# ── Comandă myheros în PATH ──────────────────────────────────────
$novaBat = "$InstallDir\myheros.bat"
@"
@echo off
cd /d "$InstallDir"
node --experimental-strip-types src\myheros.ts %*
"@ | Set-Content -Path $novaBat -Encoding ASCII

# Adaugă InstallDir în PATH pentru sesiunea curentă și permanent
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("PATH", "$userPath;$InstallDir", "User")
  $env:PATH += ";$InstallDir"
  ok "myheros.bat adaugat in PATH"
} else {
  ok "myheros.bat deja in PATH"
}

# ── Wizard ───────────────────────────────────────────────────
Write-Host ""
Write-Host "  Instalare completa!" -ForegroundColor Green
Write-Host ""
Write-Host "  Pornind wizard-ul de configurare..."
Write-Host ""
Start-Sleep -Seconds 1

node --experimental-strip-types "$InstallDir\src\myheros.ts" setup
