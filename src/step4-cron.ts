// ============================================================
// PASUL 4: Cron Scheduler
// ============================================================
// Ce adăugăm față de Pasul 3:
//   - Citim cron-urile din config.json al agentului
//   - Le înregistrăm în CronScheduler
//   - CronScheduler verifică la fiecare minut dacă trebuie să
//     injecteze un prompt în PTY
//   - State-ul e salvat în state/demo/crons.json
//     → la restart, cron-urile sunt reîncărcate automat
//
// Principiu cheie: cron-urile sunt definite în config.json,
//   nu hardcodate în cod. Schimbi config-ul, schimbi comportamentul.
// ============================================================

import pty from 'node-pty';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import { TelegramPoller } from './telegram/poller.ts';
import { CronScheduler } from './cron/scheduler.ts';

// ── 1. Configurație agent ────────────────────────────────────
const agentDir = resolve('./agents/demo');
const stateDir = resolve('./state');
const config = JSON.parse(readFileSync(join(agentDir, 'config.json'), 'utf-8'));

// ── 2. Citim .env ────────────────────────────────────────────
const envPath = join(agentDir, '.env');
if (!existsSync(envPath)) {
  console.error(`[my-heros] Lipsește ${envPath}`);
  process.exit(1);
}

const envVars: Record<string, string> = {};
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0) envVars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

const { BOT_TOKEN, CHAT_ID } = envVars;
if (!BOT_TOKEN || !CHAT_ID) {
  console.error('[my-heros] BOT_TOKEN și CHAT_ID sunt obligatorii în .env');
  process.exit(1);
}

// ── 3. Citim IDENTITY.md ─────────────────────────────────────
const identityPath = join(agentDir, 'IDENTITY.md');
const identityContent = existsSync(identityPath)
  ? readFileSync(identityPath, 'utf-8')
  : '';

// ── 4. Pornim Claude Code în PTY ─────────────────────────────
const claudeCommand = platform() === 'win32' ? 'claude.cmd' : 'claude';

const agent = pty.spawn(claudeCommand, [
  '--dangerously-skip-permissions',
  ...(identityContent ? ['--append-system-prompt', identityContent] : []),
  config.startup_prompt,
], {
  name: 'xterm-256color',
  cols: 220,
  rows: 50,
  cwd: agentDir,
  env: {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
    BOT_TOKEN,
    CHAT_ID,
  } as Record<string, string>,
});

console.log(`[my-heros] Agent "${config.name}" pornit cu PID: ${agent.pid}`);
agent.onData((data) => process.stdout.write(data));

// ── 5. Funcția de injecție (refolosită în cron + telegram) ───
function injectMessage(text: string): void {
  agent.write('\x1b[200~' + text + '\x1b[201~');
  setTimeout(() => agent.write('\r'), 300);
}

// ── 6. Auto-acceptăm "trust this folder?" ────────────────────
setTimeout(() => agent.write('\r'), 5000);
setTimeout(() => agent.write('\r'), 8000);

// ── 7. Pornim sistemele după boot-ul Claude (12s) ────────────
setTimeout(() => {

  // ── 7a. Cron Scheduler ──────────────────────────────────────
  // Cron-urile definite în config.json sunt înregistrate o singură
  // dată. Dacă există deja în state/ (de la o rulare anterioară),
  // le ignorăm pentru a evita duplicatele.
  const cron = new CronScheduler(config.name, stateDir, (job) => {
    console.log(`\n[cron] Injectez prompt: "${job.label}"`);
    injectMessage(job.prompt);
  });

  // Înregistrăm cron-urile din config dacă scheduler-ul e gol
  if (cron.list().length === 0 && config.crons?.length > 0) {
    for (const c of config.crons) {
      cron.add(c.expression, c.prompt, c.label);
    }
  }

  cron.start();

  // ── 7b. Telegram Poller ──────────────────────────────────────
  const poller = new TelegramPoller(BOT_TOKEN, (text, chatId) => {
    console.log(`\n[telegram] Injectez: "${text}"`);
    const prompt = `Mesaj nou pe Telegram de la chat ${chatId}: "${text}"\nRăspunde pe Telegram via curl cu BOT_TOKEN și CHAT_ID din env.`;
    injectMessage(prompt);
  });

  poller.start();

  // Cleanup la CTRL+C
  process.on('SIGINT', () => {
    cron.stop();
    poller.stop();
    agent.kill();
    process.exit(0);
  });

}, 12000);

agent.onExit(({ exitCode }) => {
  console.log(`\n[my-heros] Agent "${config.name}" închis (cod: ${exitCode})`);
  process.exit(exitCode);
});
