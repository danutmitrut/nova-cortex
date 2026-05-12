#!/usr/bin/env node
// ============================================================
// Skill: agent-status — returnează statusul tuturor agenților
// Utilizare: node --experimental-strip-types skills/agent-status.ts
// Output: JSON { ok, agents: [{name, status, alive}] }
// Funcționează și offline (citește heartbeat-urile din state/)
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { createConnection } from 'net';
import { platform } from 'os';

const SOCKET = platform() === 'win32' ? undefined : '/tmp/nova-cortex.sock';
const TCP_PORT = 7654;

function fromHeartbeats(): object[] {
  const stateDir = resolve('state');
  if (!existsSync(stateDir)) return [];
  return readdirSync(stateDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const hbPath = join(stateDir, e.name, 'heartbeat.json');
      if (!existsSync(hbPath)) return null;
      try { return JSON.parse(readFileSync(hbPath, 'utf-8')); } catch { return null; }
    }).filter(Boolean);
}

async function fromDaemon(): Promise<object[] | null> {
  return new Promise(res => {
    const sock = SOCKET
      ? createConnection(SOCKET)
      : createConnection(TCP_PORT, '127.0.0.1');

    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); res(null); }, 2000);

    sock.on('data', d => { buf += d.toString(); });
    sock.on('end', () => {
      clearTimeout(timer);
      try { res(JSON.parse(buf).agents ?? null); } catch { res(null); }
    });
    sock.on('error', () => { clearTimeout(timer); res(null); });
    sock.write(JSON.stringify({ command: 'status' }) + '\n');
  });
}

const agents = await fromDaemon() ?? fromHeartbeats();
console.log(JSON.stringify({ ok: true, agents, source: agents.length ? 'daemon' : 'heartbeats' }));
