// ============================================================
// Tunnel CLI — acces remote la dashboard via cloudflared
// ============================================================
// nova tunnel start   — porneste tunel cloudflared la port 4242
// nova tunnel stop    — opreste tunelul activ
// nova tunnel status  — verifica daca tunelul ruleaza
// nova tunnel url     — afiseaza URL-ul public curent
// ============================================================

import { existsSync, writeFileSync, readFileSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { spawn, spawnSync } from 'child_process';

const STATE_DIR = resolve('state');
const PID_FILE = join(STATE_DIR, 'tunnel.pid');
const URL_FILE = join(STATE_DIR, 'tunnel.url');
const LOG_FILE = join(STATE_DIR, 'tunnel.log');

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

function cloudflaredInstalled(): boolean {
  const r = spawnSync('which', ['cloudflared'], { stdio: 'pipe' });
  return r.status === 0;
}

export async function cmdTunnel(sub: string): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true });

  switch (sub) {
    case 'start':
      return tunnelStart();
    case 'stop':
      return tunnelStop();
    case 'status':
      return tunnelStatus();
    case 'url':
      return tunnelUrl();
    default:
      console.error('Utilizare: nova tunnel start|stop|status|url');
      process.exit(1);
  }
}

function tunnelStart(): void {
  if (!cloudflaredInstalled()) {
    console.error('cloudflared nu este instalat.');
    console.error('Instaleaza: brew install cloudflared');
    process.exit(1);
  }

  const pid = readPid();
  if (pid && isRunning(pid)) {
    console.log(`Tunelul deja rulează (PID ${pid}).`);
    tunnelUrl();
    return;
  }

  const child = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:4242'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  writeFileSync(PID_FILE, String(child.pid));

  const logFile = createWriteStream(LOG_FILE, { flags: 'a' });
  child.stdout?.pipe(logFile);
  child.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString();
    logFile.write(line);
    // cloudflared scrie URL-ul pe stderr cu pattern trycloudflare.com
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      writeFileSync(URL_FILE, match[0]);
      console.log(`\nDashboard disponibil la: ${match[0]}\n`);
    }
  });

  child.unref();

  console.log(`Tunel pornit (PID ${child.pid}). Asteapta URL-ul...`);
  console.log('(poate dura 5-10 secunde)');
  console.log('Ruleaza "nova tunnel url" pentru a vedea URL-ul public.');
}

function tunnelStop(): void {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    console.log('Niciun tunel activ.');
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Tunel oprit (PID ${pid}).`);
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    if (existsSync(URL_FILE)) unlinkSync(URL_FILE);
  } catch (err: any) {
    console.error(`Nu am putut opri tunelul: ${err.message}`);
  }
}

function tunnelStatus(): void {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    console.log('Tunel: oprit');
    return;
  }
  console.log(`Tunel: activ (PID ${pid})`);
  tunnelUrl();
}

function tunnelUrl(): void {
  if (!existsSync(URL_FILE)) {
    console.log('URL-ul nu este disponibil inca. Incearca dupa cateva secunde.');
    return;
  }
  const url = readFileSync(URL_FILE, 'utf8').trim();
  console.log(`URL public: ${url}`);
}
