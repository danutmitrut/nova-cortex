#!/usr/bin/env node
// ============================================================
// Skill: bus-send — trimite mesaj în inbox-ul unui agent
// Utilizare: node --experimental-strip-types skills/bus-send.ts <agent> "<mesaj>"
// Output: JSON { ok, id, file }
// ============================================================

import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';

const [,, to, ...msgParts] = process.argv;
const content = msgParts.join(' ');

if (!to || !content) {
  console.error(JSON.stringify({ ok: false, error: 'Utilizare: bus-send.ts <agent> "<mesaj>"' }));
  process.exit(1);
}

const busDir = resolve('bus');
const agentBusDir = join(busDir, to);
const inboxDir = join(agentBusDir, 'inbox');

if (!existsSync(agentBusDir)) {
  console.error(JSON.stringify({ ok: false, error: `Agentul "${to}" nu are director bus. Verifică că daemonul rulează.` }));
  process.exit(1);
}

mkdirSync(inboxDir, { recursive: true });

const id = randomUUID();
const timestamp = new Date().toISOString();
const filename = `${timestamp.replace(/[:.]/g, '-').slice(0, 19)}-${id}.json`;

const message = { id, from: process.env.NC_AGENT_NAME || 'skill', to, content, timestamp, requiresAck: false };
const filepath = join(inboxDir, filename);
writeFileSync(filepath, JSON.stringify(message, null, 2));

console.log(JSON.stringify({ ok: true, id, file: filename }));
