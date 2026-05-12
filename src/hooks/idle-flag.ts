#!/usr/bin/env node
// Stop hook — scrie timestamp last_idle.flag
// Folosit de TelegramPoller pentru typing indicator

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnv } from './index.ts';

async function main(): Promise<void> {
  const env = loadEnv();
  try {
    mkdirSync(env.stateDir, { recursive: true });
    writeFileSync(join(env.stateDir, 'last_idle.flag'), String(Math.floor(Date.now() / 1000)), 'utf-8');
  } catch {}
}

main().catch(() => process.exit(0));
