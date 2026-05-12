// ============================================================
// Comenzi CLI Nova Cortex
// ============================================================
// status  — listează toți agenții și statusul lor
// start   — pornește un agent specific
// stop    — oprește un agent specific
// bus     — trimite un mesaj prin bus la un agent
// ============================================================

import { sendCommand } from './client.ts';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { homedir, platform } from 'os';

type AgentStatus = { name: string; status: string; alive: boolean };

// ── nova status ───────────────────────────────────────────────
export async function cmdStatus(): Promise<void> {
  const response = await sendCommand({ command: 'status' }) as { ok: boolean; agents: AgentStatus[] };

  if (!response.agents?.length) {
    console.log('Nova Cortex — niciun agent activ.');
    return;
  }

  console.log('\nNova Cortex — Agenți activi:\n');
  console.log('  AGENT          STATUS       ALIVE');
  console.log('  ─────────────────────────────────');

  for (const agent of response.agents) {
    const alive = agent.alive ? '✓' : '✗';
    const name = agent.name.padEnd(14);
    const status = agent.status.padEnd(12);
    console.log(`  ${name} ${status} ${alive}`);
  }

  console.log();
}

// ── nova start <agent> ────────────────────────────────────────
export async function cmdStart(name: string): Promise<void> {
  if (!name) {
    console.error('Utilizare: nova start <nume-agent>');
    process.exit(1);
  }

  const response = await sendCommand({ command: 'start', agent: name }) as { ok: boolean; error?: string };

  if (response.ok) {
    console.log(`Agent "${name}" pornit.`);
  } else {
    console.error(`Eroare: ${response.error ?? 'Agent necunoscut'}`);
    process.exit(1);
  }
}

// ── nova stop <agent> ─────────────────────────────────────────
export async function cmdStop(name: string): Promise<void> {
  if (!name) {
    console.error('Utilizare: nova stop <nume-agent>');
    process.exit(1);
  }

  const response = await sendCommand({ command: 'stop', agent: name }) as { ok: boolean; error?: string };

  if (response.ok) {
    console.log(`Agent "${name}" oprit.`);
  } else {
    console.error(`Eroare: ${response.error ?? 'Agent necunoscut'}`);
    process.exit(1);
  }
}

// ── nova bus <agent> <mesaj> ──────────────────────────────────
export async function cmdBus(to: string, content: string): Promise<void> {
  if (!to || !content) {
    console.error('Utilizare: nova bus <agent> "<mesaj>"');
    process.exit(1);
  }

  const busDir = resolve('./bus');
  const inboxDir = join(busDir, to, 'inbox');

  if (!existsSync(join(busDir, to))) {
    console.error(`Agentul "${to}" nu are inbox. Rulează daemonul mai întâi.`);
    process.exit(1);
  }

  mkdirSync(inboxDir, { recursive: true });

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const filename = `${timestamp.replace(/[:.]/g, '-').slice(0, 19)}-${id}.json`;

  const message = {
    id,
    from: 'cli',
    to,
    content,
    timestamp,
    requiresAck: false,
  };

  writeFileSync(join(inboxDir, filename), JSON.stringify(message, null, 2));
  console.log(`Mesaj trimis la "${to}" (id: ${id.slice(0, 8)}...)`);
}

// ── nova doctor ───────────────────────────────────────────────
export async function cmdDoctor(): Promise<void> {
  const ok  = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  const err = (msg: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  const warn= (msg: string) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

  console.log('\nNova Cortex — Diagnostic\n');

  // Node.js
  const major = parseInt(process.version.slice(1));
  major >= 20 ? ok(`Node.js ${process.version}`) : err(`Node.js ${process.version} — necesită v20+`);

  // Claude CLI
  const claudePath = spawnSync(platform() === 'win32' ? 'where' : 'which', ['claude'], {
    stdio: 'pipe',
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` },
  });
  claudePath.status === 0
    ? ok(`Claude CLI: ${claudePath.stdout.toString().trim()}`)
    : err('Claude CLI neinstalat — npm install -g @anthropic-ai/claude-code');

  // Daemon (IPC)
  let daemonOk = false;
  let agentList: AgentStatus[] = [];
  try {
    const r = await sendCommand({ command: 'status' }) as { agents: AgentStatus[] };
    agentList = r.agents ?? [];
    daemonOk = true;
    ok(`Daemon: rulează (${agentList.length} agent/i)`);
  } catch {
    err('Daemon: oprit — rulează "npm run dev" sau "nova service install"');
  }

  // Agenți
  if (daemonOk) {
    for (const a of agentList) {
      a.alive ? ok(`Agent "${a.name}": ${a.status}`) : warn(`Agent "${a.name}": ${a.status}`);
    }
  }

  // Telegram per agent
  const agentsDir = resolve('./agents');
  if (existsSync(agentsDir)) {
    const dirs = readdirSync(agentsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const d of dirs) {
      const envPath = join(agentsDir, d.name, '.env');
      existsSync(envPath)
        ? ok(`Telegram "${d.name}": .env configurat`)
        : warn(`Telegram "${d.name}": .env absent`);
    }
  }

  // Dashboard
  try {
    const r = await fetch('http://localhost:4242/api/status', { signal: AbortSignal.timeout(1000) });
    r.ok ? ok('Dashboard: http://localhost:4242') : warn('Dashboard: răspuns neașteptat');
  } catch {
    warn('Dashboard: offline (pornește daemonul)');
  }

  // Serviciu launchd
  if (platform() === 'darwin') {
    const plist = join(homedir(), 'Library', 'LaunchAgents', 'com.novacortex.daemon.plist');
    existsSync(plist)
      ? ok('Serviciu launchd: instalat (pornire automată la login)')
      : warn('Serviciu launchd: neinstalat — rulează "nova service install"');
  }

  console.log();
}

// ── nova help ─────────────────────────────────────────────────
export function cmdHelp(): void {
  console.log(`
Nova Cortex CLI

COMENZI:
  nova status                    Listează toți agenții și statusul
  nova start <agent>             Pornește un agent
  nova stop <agent>              Oprește un agent
  nova bus <agent> <msg>         Trimite un mesaj prin bus
  nova doctor                    Diagnostic complet al sistemului
  nova service install           Instalează serviciu launchd (macOS)
  nova service uninstall         Dezinstalează serviciul
  nova service status            Statusul serviciului

EXEMPLE:
  nova status
  nova doctor
  nova service install
  nova bus orchestrator "Analizează tendințele AI din 2025"
`);
}
