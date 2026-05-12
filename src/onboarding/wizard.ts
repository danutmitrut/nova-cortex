// ============================================================
// Nova Cortex — Wizard de onboarding
// ============================================================
// Rulare: node --experimental-strip-types src/onboarding/wizard.ts
// Sau:    npm run setup
//
// Ghidează utilizatorul în ~10 minute prin:
//   1. Verificare prerequisite (Node.js, claude CLI)
//   2. Creare director agent personalizat
//   3. Configurare Telegram (opțional)
//   4. Instrucțiuni de pornire
// ============================================================

import { createInterface } from 'readline';
import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { validateTelegramToken, sendTelegramMessage } from '../telegram/poller.ts';

const rl = createInterface({ input: process.stdin, output: process.stdout });

// ── Utilitar: întreabă și returnează răspunsul ───────────────
function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

// ── Utilitar: întreabă cu valoare default ────────────────────
async function askWithDefault(question: string, defaultValue: string): Promise<string> {
  const answer = await ask(`${question} [${defaultValue}]: `);
  return answer || defaultValue;
}

// ── Stilizare consolă minimală ────────────────────────────────
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function print(text: string) { console.log(text); }
function ok(text: string) { console.log(`${C.green}✓${C.reset} ${text}`); }
function warn(text: string) { console.log(`${C.yellow}!${C.reset} ${text}`); }
function err(text: string) { console.log(`${C.red}✗${C.reset} ${text}`); }
function header(text: string) { console.log(`\n${C.bold}${C.cyan}${text}${C.reset}`); }
function line() { console.log(`${C.dim}${'─'.repeat(50)}${C.reset}`); }

// ── Verifică dacă o comandă există în PATH ───────────────────
function commandExists(cmd: string): boolean {
  const result = spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    [cmd],
    { stdio: 'pipe', env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` } }
  );
  return result.status === 0;
}

// ── Verifică versiunea Node.js ───────────────────────────────
function checkNodeVersion(): { ok: boolean; version: string } {
  try {
    const version = process.version; // ex: v22.0.0
    const major = parseInt(version.slice(1).split('.')[0]);
    return { ok: major >= 20, version };
  } catch {
    return { ok: false, version: 'necunoscut' };
  }
}

// ── Pasul 1: Bun venit ────────────────────────────────────────
async function stepWelcome(): Promise<void> {
  console.clear();
  print(`
${C.bold}${C.cyan}   ▸ Nova Cortex — Sistem Multi-Agent AI${C.reset}
${C.dim}   Wizard de configurare${C.reset}
`);
  line();
  print('  Acest wizard te va ghida prin configurarea sistemului în ~10 minute.');
  print('  La final vei avea un agent AI personal care rulează pe calculatorul tău.');
  line();
  await ask(`\n  Apasă Enter pentru a continua...`);
}

// ── Pasul 2: Verificare prerequisite ─────────────────────────
async function stepPrerequisites(): Promise<boolean> {
  header('Pasul 1 / 4 — Verificare prerequisite');
  line();

  let allOk = true;

  // Node.js
  const node = checkNodeVersion();
  if (node.ok) {
    ok(`Node.js ${node.version} — compatibil`);
  } else {
    err(`Node.js ${node.version} — ai nevoie de v20 sau mai nou`);
    print(`  Descarcă de la: https://nodejs.org`);
    allOk = false;
  }

  // Claude CLI
  if (commandExists('claude')) {
    ok('Claude Code CLI — instalat');
  } else {
    err('Claude Code CLI — NEINSTALAT');
    print('  Instalează cu: npm install -g @anthropic-ai/claude-code');
    allOk = false;
  }

  if (!allOk) {
    print('\n  Rezolvă problemele de mai sus și rulează din nou wizard-ul.');
    return false;
  }

  print('');
  ok('Toate prerequisitele sunt îndeplinite!');
  return true;
}

// ── Pasul 3: Creare agent ─────────────────────────────────────
async function stepCreateAgent(): Promise<{ name: string; agentDir: string }> {
  header('Pasul 2 / 4 — Crează primul tău agent');
  line();

  print('  Agentul tău AI va fi un proces Claude Code autonom,');
  print('  specializat conform instrucțiunilor pe care i le dai.\n');

  const name = await askWithDefault('  Numele agentului (ex: "secretary", "analyst")', 'my-agent');
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

  const agentsDir = resolve('./agents');
  const agentDir = join(agentsDir, safeName);

  if (existsSync(agentDir)) {
    warn(`Directorul agents/${safeName}/ există deja. Continuăm fără a-l suprascrie.`);
    return { name: safeName, agentDir };
  }

  print(`\n  Ce face agentul tău? (2-3 cuvinte, ex: "secretar personal", "analist financiar")`);
  const role = await ask('  Rol: ');

  print('\n  Scrie o instrucțiune de prezentare pe care agentul o execută la pornire.');
  const startupPrompt = await askWithDefault('  Mesaj de start', 'Ești activ. Prezintă-te scurt.');

  // Creăm structura
  mkdirSync(agentDir, { recursive: true });

  writeFileSync(join(agentDir, 'config.json'), JSON.stringify({
    name: safeName,
    startup_prompt: startupPrompt,
    crons: [],
  }, null, 2));

  writeFileSync(join(agentDir, 'CLAUDE.md'), `# Agent: ${safeName}

Ești un agent AI numit **${safeName}**.
Rolul tău: ${role || 'asistent personal AI'}.

## Comportament de bază

- Ești concis și la obiect
- Comunici în limba română
- Colaborezi cu ceilalți agenți prin bus când e necesar
`);

  writeFileSync(join(agentDir, 'IDENTITY.md'), `# Identitate

Numele tău este **${safeName}**.
Faci parte din sistemul Nova Cortex.

## La pornire

Confirmă: "${safeName} activ."
`);

  ok(`Agent "${safeName}" creat în agents/${safeName}/`);
  return { name: safeName, agentDir };
}

// ── Pasul 4: Configurare Telegram ─────────────────────────────
async function stepTelegram(agentDir: string, agentName: string): Promise<void> {
  header('Pasul 3 / 4 — Telegram (opțional)');
  line();
  print('  Poți controla agentul prin Telegram — îi trimiți mesaje și el răspunde.');
  print('  Dacă sari peste acest pas, agentul va funcționa fără Telegram.\n');

  const wantsTelegram = await ask('  Vrei să configurezi Telegram? (da/nu) [nu]: ');
  if (!wantsTelegram.toLowerCase().startsWith('d')) {
    warn('Telegram sărit. Poți configura mai târziu în agents/<agent>/.env');
    return;
  }

  // ── Token ────────────────────────────────────────────────────
  print('\n  1. Deschide Telegram și caută @BotFather');
  print('  2. Trimite /newbot și urmează instrucțiunile');
  print('  3. Copiază token-ul primit (format: 123456789:ABC-DEF...)\n');

  let token = '';
  let botUsername = '';

  while (true) {
    token = await ask('  BOT_TOKEN: ');
    if (!token) { warn('Token gol. Încearcă din nou.'); continue; }

    print('  Se verifică token-ul...');
    const validation = await validateTelegramToken(token);

    if (validation.ok) {
      botUsername = validation.username ?? '';
      ok(`Token valid — bot: @${botUsername} (${validation.firstName})`);
      break;
    } else {
      err('Token invalid. Verifică că ai copiat corect din BotFather și încearcă din nou.');
    }
  }

  // ── Chat ID ──────────────────────────────────────────────────
  print(`\n  4. Deschide @${botUsername} în Telegram și trimite /start`);
  print(`  5. Accesează în browser:`);
  print(`     https://api.telegram.org/bot${token}/getUpdates`);
  print('  6. Găsește "chat":{"id":<număr>} în răspuns\n');

  let chatId = '';

  while (true) {
    chatId = await ask('  CHAT_ID: ');
    if (!chatId) { warn('Chat ID gol. Încearcă din nou.'); continue; }

    print('  Se trimite mesaj de test...');
    const sent = await sendTelegramMessage(token, chatId,
      `Nova Cortex — configurare reusita!\nAgentul tau "${agentName}" este pregatit. La "npm run dev" va porni si va astepta sarcini.`
    );

    if (sent) {
      ok('Mesaj de confirmare trimis pe Telegram. Verifică telefonul!');
      break;
    } else {
      err('Mesajul nu a ajuns. Chat ID posibil incorect — trimite /start botului și verifică din nou getUpdates.');
    }
  }

  writeFileSync(join(agentDir, '.env'), `BOT_TOKEN=${token}\nCHAT_ID=${chatId}\n`);
  ok('.env salvat.');
}

// ── Pasul 5: Instrucțiuni finale ──────────────────────────────
async function stepFinish(agentName: string): Promise<void> {
  header('Pasul 4 / 4 — Gata!');
  line();

  ok(`Agentul "${agentName}" este configurat.`);
  print('');
  print(`  ${C.bold}Pornește Nova Cortex:${C.reset}`);
  print(`    npm run dev`);
  print('');
  print(`  ${C.bold}Controlează agenții din alt terminal:${C.reset}`);
  print(`    npm run nova -- status`);
  print(`    npm run nova -- stop ${agentName}`);
  print(`    npm run nova -- bus ${agentName} "Salut, prezintă-te!"`);
  print('');
  print(`  ${C.bold}Dashboard web (când daemonul rulează):${C.reset}`);
  print(`    http://localhost:4242`);
  print('');
  line();
  print(`  ${C.dim}Documentație: README.md | GitHub: github.com/danutmitrut/nova-cortex${C.reset}`);
  print('');
}

// ── Main ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  await stepWelcome();

  const prereqOk = await stepPrerequisites();
  if (!prereqOk) {
    rl.close();
    process.exit(1);
  }

  const { name, agentDir } = await stepCreateAgent();
  await stepTelegram(agentDir, name);
  await stepFinish(name);

  rl.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
