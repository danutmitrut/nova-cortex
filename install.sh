#!/usr/bin/env bash
# ============================================================
# My HerOS — Installer pentru Mac / Linux
# Utilizare: bash install.sh
# ============================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

echo ""
echo "  ⬡  My HerOS Installer"
echo "  ────────────────────────"
echo ""

# ── Node.js ──────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js nu este instalat. Descarcă v20+ de la https://nodejs.org"
fi
NODE_MAJOR=$(node -e "console.log(parseInt(process.version.slice(1)))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node.js $(node -v) detectat — necesită v20+. Actualizează de la https://nodejs.org"
fi
ok "Node.js $(node -v)"

# ── Git ───────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  fail "Git nu este instalat. Instalează de la https://git-scm.com"
fi
ok "Git $(git --version | awk '{print $3}')"

# ── Clone / actualizare repo ─────────────────────────────────
INSTALL_DIR="$HOME/my-heros"

if [ -d "$INSTALL_DIR/.git" ]; then
  warn "My HerOS există deja în $INSTALL_DIR — actualizez..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo ""
  echo "  Clonez My HerOS în $INSTALL_DIR..."
  git clone https://github.com/danutmitrut/my-heros.git "$INSTALL_DIR"
fi
ok "Repo: $INSTALL_DIR"

# ── npm install ───────────────────────────────────────────────
cd "$INSTALL_DIR"
npm install --silent
ok "Dependențe instalate"

# ── Claude CLI ───────────────────────────────────────────────
if command -v claude &>/dev/null; then
  ok "Claude CLI: $(which claude)"
else
  warn "Claude CLI neinstalat — instalez..."
  npm install -g @anthropic-ai/claude-code
  ok "Claude CLI instalat"
fi

# ── CLI global (myheros) ─────────────────────────────────────────
BIN_DIR="/usr/local/bin"
NOVA_SCRIPT="$BIN_DIR/myheros"

cat > /tmp/myheros-installer-script << 'NOVASCRIPT'
#!/usr/bin/env bash
cd "INSTALL_PLACEHOLDER" && node --experimental-strip-types src/myheros.ts "$@"
NOVASCRIPT

sed -i.bak "s|INSTALL_PLACEHOLDER|$INSTALL_DIR|g" /tmp/myheros-installer-script
rm /tmp/myheros-installer-script.bak

if [ -w "$BIN_DIR" ]; then
  cp /tmp/myheros-installer-script "$NOVA_SCRIPT"
  chmod +x "$NOVA_SCRIPT"
  ok "Comandă 'myheros' disponibilă global"
else
  warn "Nu pot scrie în $BIN_DIR — încerc cu sudo..."
  sudo cp /tmp/myheros-installer-script "$NOVA_SCRIPT"
  sudo chmod +x "$NOVA_SCRIPT"
  ok "Comandă 'myheros' disponibilă global (via sudo)"
fi

# ── Wizard ───────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}Instalare completă!${NC}"
echo ""
echo "  Pornind wizard-ul de configurare..."
echo ""
sleep 1

myheros setup
