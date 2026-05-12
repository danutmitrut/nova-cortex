// ============================================================
// PASUL 3: Telegram polling
// ============================================================
// Ce adăugăm față de Pasul 2:
//   - Citim BOT_TOKEN și CHAT_ID din agents/demo/.env
//   - Pornim un poller Telegram care ascultă mesaje noi
//   - Fiecare mesaj primit este injectat în PTY
//   - Claude are BOT_TOKEN și CHAT_ID ca env vars — poate trimite
//     răspunsuri direct prin curl (Bash tool)
//
// Principiu cheie: daemonul NU parsează răspunsurile Claude.
//   Claude trimite el însuși mesajele pe Telegram.
//   Separare clară: daemon = router de mesaje, agent = logică.
// ============================================================

import pty from 'node-pty';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import { TelegramPoller } from './telegram/poller.ts';

// ── 1. Citim configurația agentului ─────────────────────────
const agentDir = resolve('./agents/demo');
const config = JSON.parse(readFileSync(join(agentDir, 'config.json'), 'utf-8'));

// ── 2. Citim .env (BOT_TOKEN, CHAT_ID) ───────────────────────
// .env este gitignored — secretele nu ajung în repo
const envPath = join(agentDir, '.env');
if (!existsSync(envPath)) {
  console.error(`[nova-cortex] Lipsește ${envPath}`);
  console.error('Creează fișierul cu:\n  BOT_TOKEN=token_de_la_botfather\n  CHAT_ID=id_ul_tău_telegram');
  process.exit(1);
}

// Parsăm manual .env (format simplu KEY=VALUE, fără dependențe externe)
const envVars: Record<string, string> = {};
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx > 0) {
    envVars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
}

const { BOT_TOKEN, CHAT_ID } = envVars;
if (!BOT_TOKEN || !CHAT_ID) {
  console.error('[nova-cortex] BOT_TOKEN și CHAT_ID sunt obligatorii în .env');
  process.exit(1);
}

console.log(`[nova-cortex] Pornesc agentul: ${config.name}`);

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
    // Claude primește secretele ca env vars — le poate folosi în curl
    BOT_TOKEN,
    CHAT_ID,
  } as Record<string, string>,
});

console.log(`[nova-cortex] Agent "${config.name}" pornit cu PID: ${agent.pid}`);

// ── 5. Afișăm output-ul PTY ──────────────────────────────────
agent.onData((data) => {
  process.stdout.write(data);
});

// ── 6. Auto-acceptăm "trust this folder?" ────────────────────
setTimeout(() => agent.write('\r'), 5000);
setTimeout(() => agent.write('\r'), 8000);

// ── 7. Funcția de injecție a mesajelor în PTY ────────────────
// Bracketed paste mode protejează caracterele speciale
function injectMessage(text: string): void {
  agent.write('\x1b[200~' + text + '\x1b[201~');
  setTimeout(() => agent.write('\r'), 300);
}

// ── 8. Pornim Telegram poller după ce Claude e gata ──────────
// Așteptăm 12s să termine Claude boot-ul înainte să primim mesaje
setTimeout(() => {
  const poller = new TelegramPoller(BOT_TOKEN, (text, chatId) => {
    console.log(`\n[nova-cortex] Injectez în PTY: "${text}"`);

    // Formatăm mesajul ca instrucțiune clară pentru Claude
    // Claude știe din IDENTITY.md că trebuie să răspundă pe Telegram
    const prompt = `Mesaj nou pe Telegram de la chat ${chatId}: "${text}"\nRăspunde pe Telegram folosind curl și BOT_TOKEN + CHAT_ID din env.`;
    injectMessage(prompt);
  });

  poller.start();

  // Oprim poller-ul când procesul se închide
  process.on('SIGINT', () => {
    poller.stop();
    agent.kill();
    process.exit(0);
  });
}, 12000);

// ── 9. Detectăm închiderea agentului ─────────────────────────
agent.onExit(({ exitCode }) => {
  console.log(`\n[nova-cortex] Agent "${config.name}" închis (cod: ${exitCode})`);
  process.exit(exitCode);
});
