// ============================================================
// PASUL 2: Agent cu identitate
// ============================================================
// Ce adăugăm față de Pasul 1:
//   - Directorul agentului devine working directory-ul Claude Code
//     → Claude Code citește CLAUDE.md automat din cwd
//   - IDENTITY.md este pasat via --append-system-prompt
//     → devine o extensie a system prompt-ului
//   - config.json definește numele și promptul de start
//
// De ce două fișiere de identitate?
//   CLAUDE.md = reguli de comportament (Claude Code îl citește automat)
//   IDENTITY.md = cine este agentul, ce spune la pornire
//   Separarea permite actualizarea identității fără a atinge regulile.
// ============================================================

import pty from 'node-pty';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';

// ── 1. Citim configurația agentului ─────────────────────────
// Calea către directorul agentului (relativ la locul de unde rulăm)
const agentDir = resolve('./agents/demo');

// config.json conține ce are nevoie daemonul să știe despre agent
const config = JSON.parse(readFileSync(join(agentDir, 'config.json'), 'utf-8'));
console.log(`[nova-cortex] Pornesc agentul: ${config.name}`);

// ── 2. Citim IDENTITY.md ─────────────────────────────────────
// IDENTITY.md extinde system prompt-ul cu personalitatea agentului
const identityPath = join(agentDir, 'IDENTITY.md');
const identityContent = existsSync(identityPath)
  ? readFileSync(identityPath, 'utf-8')
  : '';

// ── 3. Construim argumentele pentru Claude Code ──────────────
const claudeCommand = platform() === 'win32' ? 'claude.cmd' : 'claude';

const args = [
  '--dangerously-skip-permissions',

  // --append-system-prompt adaugă conținut la system prompt-ul Claude Code
  // CLAUDE.md din cwd este deja încărcat automat — acesta îl completează
  ...(identityContent ? ['--append-system-prompt', identityContent] : []),

  // Promptul de start vine din config.json — nu e hardcodat în cod
  config.startup_prompt,
];

// ── 4. Pornim Claude Code cu identitatea agentului ───────────
// Cheia față de Pasul 1: cwd = directorul agentului
// Claude Code va găsi și citi CLAUDE.md din acest director automat
const agent = pty.spawn(claudeCommand, args, {
  name: 'xterm-256color',
  cols: 220,
  rows: 50,
  cwd: agentDir, // ← diferența față de Pasul 1
  env: {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
  } as Record<string, string>,
});

console.log(`[nova-cortex] Agent "${config.name}" pornit cu PID: ${agent.pid}`);

// ── 5. Afișăm output-ul ──────────────────────────────────────
agent.onData((data) => {
  process.stdout.write(data);
});

// ── 6. Auto-acceptăm "trust this folder?" ────────────────────
setTimeout(() => agent.write('\r'), 5000);
setTimeout(() => agent.write('\r'), 8000);

// ── 7. Detectăm închiderea ───────────────────────────────────
agent.onExit(({ exitCode }) => {
  console.log(`\n[nova-cortex] Agent "${config.name}" închis (cod: ${exitCode})`);
  process.exit(exitCode);
});
