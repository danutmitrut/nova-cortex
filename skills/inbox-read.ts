#!/usr/bin/env node
// ============================================================
// Skill: inbox-read — citește mesajele neprocesate din inbox
// Utilizare: node --experimental-strip-types skills/inbox-read.ts <agent>
// Output: JSON { ok, messages: [...] }
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const [,, agentName] = process.argv;
const name = agentName || process.env.NC_AGENT_NAME;

if (!name) {
  console.error(JSON.stringify({ ok: false, error: 'Utilizare: inbox-read.ts <agent>' }));
  process.exit(1);
}

const inboxDir = join(resolve('bus'), name, 'inbox');

if (!existsSync(inboxDir)) {
  console.log(JSON.stringify({ ok: true, messages: [], note: 'Inbox inexistent sau gol.' }));
  process.exit(0);
}

const files = readdirSync(inboxDir)
  .filter(f => f.endsWith('.json'))
  .sort();

const messages = files.map(f => {
  try { return JSON.parse(readFileSync(join(inboxDir, f), 'utf-8')); }
  catch { return null; }
}).filter(Boolean);

console.log(JSON.stringify({ ok: true, messages, count: messages.length }));
