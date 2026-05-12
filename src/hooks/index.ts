// ============================================================
// Hooks — utilitare comune pentru toate hook-urile Nova Cortex
// ============================================================

import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, watch } from 'fs';
import { join, basename } from 'path';
import * as crypto from 'crypto';

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

export function parseHookInput(input: string): { tool_name: string; tool_input: any } {
  try {
    const parsed = JSON.parse(input);
    return {
      tool_name: parsed.tool_name || 'unknown',
      tool_input: parsed.tool_input || {},
    };
  } catch {
    return { tool_name: 'unknown', tool_input: {} };
  }
}

export function loadEnv(): { botToken?: string; chatId?: string; agentName: string; stateDir: string } {
  const agentName = process.env.NC_AGENT_NAME || basename(process.cwd());
  const stateDir = process.env.NC_STATE_DIR || join(process.cwd(), 'state', agentName);

  // Citeste .env din directorul agentului
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }

  return {
    botToken: process.env.BOT_TOKEN,
    chatId: process.env.CHAT_ID,
    agentName,
    stateDir,
  };
}

export function outputDecision(behavior: 'allow' | 'deny', message?: string): void {
  const decision: any = { behavior };
  if (message) decision.message = message;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision },
  }) + '\n');
  process.exit(0);
}

export function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

export async function sendTelegram(token: string, chatId: string, text: string, replyMarkup?: object): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

export function buildPermissionKeyboard(id: string): object {
  return {
    inline_keyboard: [[
      { text: '✅ Allow', callback_data: `perm_allow_${id}` },
      { text: '❌ Deny', callback_data: `perm_deny_${id}` },
    ]],
  };
}

export function buildPlanKeyboard(id: string): object {
  return {
    inline_keyboard: [[
      { text: '✅ Approve Plan', callback_data: `plan_allow_${id}` },
      { text: '❌ Deny Plan', callback_data: `plan_deny_${id}` },
    ]],
  };
}

export function buildAskSingleSelectKeyboard(questionIdx: number, options: string[]): object {
  return {
    inline_keyboard: options.map((label, optIdx) => [
      { text: label, callback_data: `askopt_${questionIdx}_${optIdx}` },
    ]),
  };
}

export function buildAskMultiSelectKeyboard(questionIdx: number, options: string[]): object {
  return {
    inline_keyboard: [
      ...options.map((label, optIdx) => [
        { text: label, callback_data: `asktoggle_${questionIdx}_${optIdx}` },
      ]),
      [{ text: '✅ Submit', callback_data: `asksubmit_${questionIdx}` }],
    ],
  };
}

export function buildAskState(questions: any[]): object {
  return {
    questions: questions.map(q => ({
      question: q.question,
      header: q.header || '',
      multiSelect: q.multiSelect || false,
      options: (q.options || []).map((o: any) => o.label || o),
    })),
    current_question: 0,
    total_questions: questions.length,
    multi_select_chosen: [],
  };
}

export function formatQuestionMessage(agentName: string, questionIdx: number, totalQuestions: number, question: any): string {
  let msg = totalQuestions > 1
    ? `QUESTION (${questionIdx + 1}/${totalQuestions}) — ${agentName}:`
    : `QUESTION — ${agentName}:`;
  if (question.header) msg += `\n<b>${question.header}</b>`;
  msg += `\n${question.question}\n`;
  if (question.multiSelect) msg += '\n(Multi-select: alege optiunile, apoi Submit)';
  for (let i = 0; i < (question.options || []).length; i++) {
    const o = question.options[i];
    const label = o.label || o;
    msg += `\n${i + 1}. ${label}`;
    if (o.description) msg += `\n   ${o.description}`;
  }
  return msg;
}

export function cleanupResponseFile(filePath: string): void {
  try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}
}

export function waitForResponseFile(filePath: string, timeoutMs: number): Promise<string | null> {
  return new Promise(resolve => {
    const dir = join(filePath, '..');
    const fileName = basename(filePath);
    mkdirSync(dir, { recursive: true });

    let resolved = false;
    let watcher: ReturnType<typeof watch> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      if (pollInterval) clearInterval(pollInterval);
      if (timeoutHandle) clearTimeout(timeoutHandle);
    };

    const checkFile = () => {
      if (resolved) return;
      try {
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8');
          cleanup();
          resolve(content);
        }
      } catch {}
    };

    try {
      watcher = watch(dir, (_, fn) => { if (fn === fileName) checkFile(); });
    } catch {}

    pollInterval = setInterval(checkFile, 2000);
    timeoutHandle = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);

    checkFile();
  });
}
