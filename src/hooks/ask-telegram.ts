#!/usr/bin/env node
// PreToolUse / AskUserQuestion hook — trimite intrebarea pe Telegram cu butoane
// Non-blocking: trimite si iese imediat, fast-checker (TelegramPoller) gestioneaza raspunsul

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  readStdin, parseHookInput, loadEnv,
  buildAskState, buildAskSingleSelectKeyboard, buildAskMultiSelectKeyboard,
  formatQuestionMessage, sendTelegram,
} from './index.ts';

async function main(): Promise<void> {
  const input = await readStdin();
  const { tool_input } = parseHookInput(input);

  const questions = tool_input.questions || [];
  if (questions.length === 0) { process.exit(0); return; }

  const env = loadEnv();
  if (!env.botToken || !env.chatId) { process.exit(0); return; }

  // Salveaza starea intrebarilor pentru TelegramPoller
  mkdirSync(env.stateDir, { recursive: true });
  const stateFile = join(env.stateDir, 'ask-state.json');
  const state = buildAskState(questions);
  writeFileSync(stateFile, JSON.stringify(state), 'utf-8');

  // Trimite prima intrebare
  const q = questions[0];
  const isMultiSelect = q.multiSelect || false;
  const options = (q.options || []).map((o: any) => o.label || o);
  const messageText = formatQuestionMessage(env.agentName, 0, questions.length, q);
  const keyboard = isMultiSelect
    ? buildAskMultiSelectKeyboard(0, options)
    : buildAskSingleSelectKeyboard(0, options);

  try {
    await sendTelegram(env.botToken, env.chatId, messageText, keyboard);
  } catch {}

  process.exit(0);
}

main().catch(() => process.exit(0));
