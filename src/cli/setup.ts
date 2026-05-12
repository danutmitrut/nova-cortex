// ============================================================
// nova setup — wizard interactiv de onboarding
// ============================================================
// Funcționează cross-platform (Mac / Windows / Linux).
// Folosește doar readline din stdlib Node.js.
// ============================================================

import { createInterface } from 'readline';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { platform } from 'os';

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';

const ok   = (s: string) => console.log(`  ${GREEN}✓${RESET} ${s}`);
const warn = (s: string) => console.log(`  ${YELLOW}!${RESET} ${s}`);
const err  = (s: string) => console.log(`  ${RED}✗${RESET} ${s}`);
const step = (n: number, s: string) => console.log(`\n${BOLD}${n}. ${s}${RESET}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(res => rl.question(q, res));
const askYN = async (q: string, def = 'y'): Promise<boolean> => {
  const hint = def === 'y' ? '[Y/n]' : '[y/N]';
  const ans = (await ask(`  ${q} ${hint}: `)).trim().toLowerCase();
  return ans === '' ? def === 'y' : ans === 'y' || ans === 'yes' || ans === 'da';
};

// ── Entry point ───────────────────────────────────────────────
export async function cmdSetup(): Promise<void> {
  console.clear();
  console.log(`${BOLD}${GREEN}
  ⬡  Nova Cortex — Setup Wizard
  ────────────────────────────${RESET}
  Acest wizard configurează Nova Cortex pas cu pas.
  Apasă Enter pentru opțiunea implicită (în paranteze).
`);

  // ── STEP 1: Verificare dependențe ────────────────────────────
  step(1, 'Verificare dependențe');

  const major = parseInt(process.version.slice(1));
  major >= 20
    ? ok(`Node.js ${process.version}`)
    : err(`Node.js ${process.version} — necesită v20+. Descarcă de la https://nodejs.org`);

  const claudeCheck = spawnSync(
    platform() === 'win32' ? 'where' : 'which',
    ['claude'],
    { stdio: 'pipe', env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` } }
  );
  if (claudeCheck.status === 0) {
    ok(`Claude CLI: ${claudeCheck.stdout.toString().trim().split('\n')[0]}`)
  } else {
    warn('Claude CLI neinstalat — îl instalez acum...');
    const install = spawnSync('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      stdio: 'inherit',
      shell: platform() === 'win32',
    });
    install.status === 0 ? ok('Claude CLI instalat.') : err('Instalare eșuată — rulează manual: npm install -g @anthropic-ai/claude-code');
  }

  // ── STEP 2: Alegere agenți ───────────────────────────────────
  step(2, 'Alegere agenți');

  const templatesDir = resolve('templates');
  const templates = existsSync(templatesDir)
    ? readdirSync(templatesDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    : [];

  if (!templates.length) {
    warn('Niciun template găsit în templates/. Sari peste acest pas.');
  } else {
    console.log(`\n  Template-uri disponibile:\n`);
    templates.forEach((t, i) => console.log(`    ${i + 1}. ${t}`));
    console.log(`\n  ${DIM}Exemplu: "1 3" pentru orchestrator și writer | Enter = toți${RESET}`);
    const sel = (await ask('\n  Ce agenți vrei? '));
    const selectedTemplates = sel.trim() === ''
      ? templates
      : sel.trim().split(/[\s,]+/).map(n => templates[parseInt(n) - 1]).filter(Boolean);

    const agentsDir = resolve('agents');
    for (const tName of selectedTemplates) {
      const agentDir = join(agentsDir, tName);
      if (existsSync(agentDir)) {
        warn(`Agent "${tName}" există deja — sărit.`);
        continue;
      }
      const templateDir = join(templatesDir, tName);
      cpSync(templateDir, agentDir, { recursive: true });
      const cfgPath = join(agentDir, 'config.json');
      try {
        const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
        cfg.name = tName;
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      } catch {}
      ok(`Agent "${tName}" creat.`);
    }
  }

  // ── STEP 3: Telegram ─────────────────────────────────────────
  step(3, 'Configurare Telegram (notificări și control)');

  const wantTelegram = await askYN('Vrei notificări și control via Telegram?');
  if (wantTelegram) {
    console.log(`\n  ${DIM}Creează un bot la @BotFather pe Telegram și copiază token-ul.${RESET}`);
    const botToken = (await ask('  BOT_TOKEN: ')).trim();
    const chatId   = (await ask('  CHAT_ID (al tău, găsit la @userinfobot): ')).trim();

    if (botToken && chatId) {
      const agentsDir = resolve('agents');
      if (existsSync(agentsDir)) {
        const agents = readdirSync(agentsDir, { withFileTypes: true }).filter(e => e.isDirectory());
        for (const a of agents) {
          const envPath = join(agentsDir, a.name, '.env');
          writeFileSync(envPath, `BOT_TOKEN=${botToken}\nCHAT_ID=${chatId}\n`);
          ok(`.env scris pentru "${a.name}"`);
        }
      }
    } else {
      warn('Token sau CHAT_ID gol — Telegram sărit. Poți configura manual în agents/<agent>/.env');
    }
  }

  // ── STEP 4: Serviciu autostart ───────────────────────────────
  step(4, 'Pornire automată la login');

  const os = platform();
  if (os === 'darwin') {
    const wantService = await askYN('Instalezi Nova Cortex ca serviciu launchd (pornire automată)?');
    if (wantService) {
      const { cmdServiceInstall } = await import('./service.ts');
      await cmdServiceInstall();
    }
  } else if (os === 'win32') {
    const wantService = await askYN('Instalezi Nova Cortex ca task în Task Scheduler (pornire automată)?');
    if (wantService) {
      const { cmdServiceInstall } = await import('./service.ts');
      await cmdServiceInstall();
    }
  } else {
    warn(`Linux detectat. Rulează "nova service install" pentru systemd.`);
  }

  // ── STEP 5: Diagnostic final ─────────────────────────────────
  step(5, 'Diagnostic final');
  console.log('');

  const { cmdDoctor } = await import('./commands.ts');
  await cmdDoctor();

  // ── Done ─────────────────────────────────────────────────────
  console.log(`${GREEN}${BOLD}
  ✓ Nova Cortex configurat cu succes!
  ─────────────────────────────────${RESET}

  Comenzi utile:
    ${BOLD}npm run dev${RESET}              — pornește daemonul (terminal dedicat)
    ${BOLD}nova status${RESET}              — statusul agenților
    ${BOLD}nova logs <agent>${RESET}        — output live al unui agent
    ${BOLD}nova chat <agent> "..."${RESET}  — trimite mesaj și urmărești răspunsul
    ${BOLD}nova doctor${RESET}              — diagnostic complet

  Dashboard: ${BOLD}http://localhost:4242${RESET} (după pornirea daemonului)
`);

  rl.close();
}
