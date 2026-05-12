#!/usr/bin/env node
// PermissionRequest hook — trimite cererea pe Telegram cu butoane Allow/Deny
// Timeout: 30 minute, deny implicit

import { mkdirSync } from 'fs';
import { join } from 'path';
import {
  readStdin, parseHookInput, loadEnv, outputDecision,
  generateId, waitForResponseFile, cleanupResponseFile,
  sendTelegram, buildPermissionKeyboard,
} from './index.ts';

async function main(): Promise<void> {
  const input = await readStdin();
  const { tool_name, tool_input } = parseHookInput(input);

  // ExitPlanMode si AskUserQuestion sunt tratate de alte hook-uri
  if (tool_name === 'ExitPlanMode' || tool_name === 'AskUserQuestion') {
    process.exit(0);
  }

  const env = loadEnv();
  if (!env.botToken || !env.chatId) {
    outputDecision('allow');
    return;
  }

  // Auto-approve operatii pe .claude/
  const toolStr = JSON.stringify(tool_input || '');
  if (toolStr.includes('/.claude/') || toolStr.includes('\\.claude\\')) {
    outputDecision('allow');
    return;
  }

  // Construieste rezumat human-readable
  const summary = JSON.stringify(tool_input, null, 2).slice(0, 800);
  const uniqueId = generateId();
  mkdirSync(env.stateDir, { recursive: true });
  const responseFile = join(env.stateDir, `hook-response-${uniqueId}.json`);

  const cleanup = () => cleanupResponseFile(responseFile);
  process.on('exit', cleanup);
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  let message = `🔐 PERMISSION REQUEST\nAgent: <b>${env.agentName}</b>\nTool: <code>${tool_name}</code>\n\n<pre>${summary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
  if (message.length > 3800) message = message.slice(0, 3800) + '...(trunchiat)';

  try {
    await sendTelegram(env.botToken, env.chatId, message, buildPermissionKeyboard(uniqueId));
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
        outputDecision('deny', 'Refuzat de utilizator via Telegram');
      }
    } catch {
      outputDecision('deny', 'Raspuns invalid');
    }
  } else {
    try {
      await sendTelegram(env.botToken, env.chatId,
        `⏱ Permission request TIMEOUT (auto-deny): ${env.agentName} / ${tool_name}`);
    } catch {}
    outputDecision('deny', 'Timeout 30 minute — auto-deny');
  }
}

main().catch(err => {
  process.stderr.write(`hook-permission-telegram error: ${err}\n`);
  outputDecision('deny', `Hook error: ${err}`);
});
