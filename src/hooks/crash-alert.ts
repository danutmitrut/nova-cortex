#!/usr/bin/env node
// SessionEnd hook — alerta Telegram la crash / oprire agent
// Categorizeaza tipul de oprire si trimite notificare

import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnv, sendTelegram } from './index.ts';

const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function shouldSuppressDedup(stateDir: string, endType: string): boolean {
  const dedupFile = join(stateDir, '.crash_alert_dedup.json');
  const now = Date.now();
  let last: Record<string, number> = {};
  try { last = JSON.parse(readFileSync(dedupFile, 'utf-8')); } catch {}
  const prev = last[endType] ?? 0;
  if (now - prev < DEDUP_WINDOW_MS) return true;
  last[endType] = now;
  try { writeFileSync(dedupFile, JSON.stringify(last), 'utf-8'); } catch {}
  return false;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const { agentName, stateDir, botToken, chatId } = env;

  mkdirSync(stateDir, { recursive: true });

  // Detecteaza tipul de oprire din fisiere marker
  let endType = 'crash';
  let reason = '';

  const markers = [
    { file: '.restart-planned', type: 'planned-restart' },
    { file: '.user-restart',    type: 'user-restart' },
    { file: '.user-stop',       type: 'user-stop' },
    { file: '.daemon-stop',     type: 'daemon-stop' },
  ];

  for (const marker of markers) {
    const markerPath = join(stateDir, marker.file);
    if (existsSync(markerPath)) {
      endType = marker.type;
      try { reason = readFileSync(markerPath, 'utf-8').trim(); unlinkSync(markerPath); } catch {}
      break;
    }
  }

  // Numara crash-uri azi
  const today = new Date().toISOString().split('T')[0];
  const countFile = join(stateDir, '.crash_count_today');
  let crashCount = 0;
  if (endType === 'crash') {
    try {
      const data = readFileSync(countFile, 'utf-8').trim();
      const [date, count] = data.split(':');
      crashCount = date === today ? parseInt(count, 10) + 1 : 1;
    } catch { crashCount = 1; }
    try { writeFileSync(countFile, `${today}:${crashCount}`, 'utf-8'); } catch {}
  }

  // Log mereu in crashes.log
  const ts = new Date().toISOString();
  try { appendFileSync(join(stateDir, 'crashes.log'), `${ts} type=${endType} reason=${reason||'none'}\n`); } catch {}

  // Suprima opriri normale fara Telegram
  const quietTypes = new Set(['planned-restart', 'user-restart', 'user-stop', 'daemon-stop']);
  if (quietTypes.has(endType)) return;

  if (shouldSuppressDedup(stateDir, endType)) return;

  if (!botToken || !chatId) return;

  const message = endType === 'crash'
    ? `🚨 CRASH: <b>${agentName}</b> s-a oprit neasteptat.${crashCount > 1 ? ` Crashes azi: ${crashCount}.` : ''}`
    : `🛑 ${agentName} oprit (${endType}).${reason ? ` ${reason}` : ''}`;

  try { await sendTelegram(botToken, chatId, message); } catch {}
}

main().catch(() => process.exit(0));
