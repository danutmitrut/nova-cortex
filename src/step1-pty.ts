// ============================================================
// PASUL 1: PTY Wrapper
// ============================================================
// Ce face acest fișier:
//   1. Pornește Claude Code ca un sub-proces în terminal (PTY)
//   2. Afișează tot ce scrie Claude în consolă
//   3. Injectează un mesaj în Claude după ce e gata
//   4. Acceptă automat promptul "trust this folder?" de la Claude
//
// De ce PTY și nu process.spawn obișnuit?
//   Claude Code rulează în terminal interactiv (TUI). Un spawn
//   obișnuit nu îi oferă un terminal — Claude refuză să pornească.
//   PTY (pseudo-terminal) simulează un terminal real.
// ============================================================

import pty from 'node-pty';
import { platform } from 'os';

// ── 1. Determinăm ce comandă să rulăm ───────────────────────
// Pe Mac/Linux comanda e "claude", pe Windows "claude.cmd" sau "claude.exe"
const claudeCommand = platform() === 'win32' ? 'claude.cmd' : 'claude';

// ── 2. Pornim Claude Code în PTY ────────────────────────────
// spawn(comandă, argumente, opțiuni)
const agent = pty.spawn(claudeCommand, [
  '--dangerously-skip-permissions', // nu mai cere confirmare la fiecare acțiune
  'Salut! Spune-mi doar "Sunt gata." și nimic altceva.', // promptul de start
], {
  name: 'xterm-256color', // tipul de terminal simulat
  cols: 220,              // lățimea terminalului în caractere
  rows: 50,               // înălțimea terminalului în linii
  cwd: process.cwd(),     // directorul de lucru
  // Moștenim variabilele de mediu + ne asigurăm că PATH include Homebrew
  // (node-pty poate pierde PATH-ul complet față de shell-ul tău normal)
  env: {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
  } as Record<string, string>,
});

console.log(`[my-heros] Agent pornit cu PID: ${agent.pid}`);

// ── 3. Capturăm tot ce scrie Claude ─────────────────────────
// onData se declanșează de fiecare dată când Claude scrie ceva în terminal
agent.onData((data) => {
  process.stdout.write(data); // afișăm direct în consola noastră
});

// ── 4. Acceptăm automat "trust this folder?" ─────────────────
// La prima rulare într-un director nou, Claude întreabă dacă avem încredere.
// Dacă nu răspundem, agentul se blochează. Trimitem Enter după 5 și 8 secunde.
setTimeout(() => agent.write('\r'), 5000);
setTimeout(() => agent.write('\r'), 8000);

// ── 5. Injectăm un mesaj după 12 secunde ─────────────────────
// Bracketed paste mode (\x1b[200~ ... \x1b[201~) îi spune terminalului
// că urmează text lipit, nu taste tastate. Fără asta, caracterele speciale
// (ghilimele, backtick, newline) ar fi interpretate ca comenzi și ar strica mesajul.
setTimeout(() => {
  const mesaj = 'Acum spune-mi ora exactă din România.';

  agent.write('\x1b[200~' + mesaj + '\x1b[201~'); // lipim mesajul
  setTimeout(() => agent.write('\r'), 300);        // apăsăm Enter după 300ms

  console.log(`\n[my-heros] Mesaj injectat: "${mesaj}"`);
}, 12000);

// ── 6. Detectăm când Claude se închide ───────────────────────
agent.onExit(({ exitCode }) => {
  console.log(`\n[my-heros] Agent închis cu codul: ${exitCode}`);
  process.exit(exitCode);
});
