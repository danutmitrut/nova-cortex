#!/usr/bin/env node
// PermissionRequest / ExitPlanMode hook — trimite planul pe Telegram cu Approve/Deny
// Timeout: 30 minute, auto-APPROVE (nu deny!) ca agentul sa nu fie blocat

import { mkdirSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, homedir } from 'path';
import {
  readStdin, parseHookInput, loadEnv, outputDecision,
  generateId, waitForResponseFile, cleanupResponseFile,
  sendTelegram, buildPlanKeyboard,
} from './index.ts';

function findMostRecentPlan(): string | null {
  const plansDir = join(homedir(), '.claude', 'plans');
  if (!existsSync(plansDir)) return null;
  try {
    const files = readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ path: join(plansDir, f), mtime: statSync(join(plansDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].path : null;
  } catch { return null; }
}

async function main(): Promise<void> {
  const input = await readStdin();
  const { tool_input } = parseHookInput(input);

  const env = loadEnv();
  if (!env.botToken || !env.chatId) { outputDecision('allow'); return; }

  // Gaseste fisierul de plan
  let planPath = tool_input.plan_file || findMostRecentPlan() || '';
  let planContent = '';
  if (planPath && existsSync(planPath)) {
    try {
      planContent = readFileSync(planPath, 'utf-8').split('\n').slice(0, 100).join('\n');
    } catch {}
  }
  if (!planContent) planContent = '(Plan file negasit)';
  if (planContent.length > 3600) planContent = planContent.slice(0, 3600) + '...(trunchiat)';

  const uniqueId = generateId();
  mkdirSync(env.stateDir, { recursive: true });
  const responseFile = join(env.stateDir, `hook-response-${uniqueId}.json`);

  const cleanup = () => cleanupResponseFile(responseFile);
  process.on('exit', cleanup);
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  const message = `📋 PLAN REVIEW — <b>${env.agentName}</b>\n\n<pre>${planContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;

  try {
    await sendTelegram(env.botToken, env.chatId, message, buildPlanKeyboard(uniqueId));
  } catch {
    outputDecision('allow');
    return;
  }

  const TIMEOUT_MS = 1800 * 1000;
  const content = await waitForResponseFile(responseFile, TIMEOUT_MS);

  if (content !== null) {
    try {
      const response = JSON.parse(content);
      if (response.decision === 'allow') {
        outputDecision('allow');
      } else {
        outputDecision('deny', 'Plan refuzat via Telegram. Intreaba ce trebuie schimbat.');
      }
    } catch { outputDecision('allow'); }
  } else {
    try {
      await sendTelegram(env.botToken, env.chatId,
        `⏱ Plan review TIMEOUT (auto-approved): ${env.agentName}`);
    } catch {}
    outputDecision('allow');
  }
}

main().catch(err => {
  process.stderr.write(`hook-planmode-telegram error: ${err}\n`);
  outputDecision('allow');
});
