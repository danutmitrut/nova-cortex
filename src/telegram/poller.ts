// ============================================================
// Telegram Poller — polling getUpdates + callback_query handler
// ============================================================
// Gestioneaza:
//   - Mesaje text → inject in agent via onMessage callback
//   - callback_query de la butoane inline (Approve/Deny, plan review,
//     AskUserQuestion) → scrie fisiere de raspuns pentru hook-uri

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

type MessageCallback = (text: string, chatId: number) => void;

export class TelegramPoller {
  private offset = 0;
  private running = false;
  private token: string;
  private stateDir: string;
  private onMessage: MessageCallback;

  constructor(token: string, onMessage: MessageCallback, stateDir = '') {
    this.token = token;
    this.onMessage = onMessage;
    this.stateDir = stateDir;
  }

  start(): void {
    this.running = true;
    console.log('[telegram] Poller pornit — astept mesaje...');
    this.poll();
  }

  stop(): void {
    this.running = false;
    console.log('[telegram] Poller oprit.');
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.fetchUpdates();
      } catch (err) {
        console.error('[telegram] Eroare la getUpdates:', err);
        await sleep(5000);
        continue;
      }
      await sleep(1000);
    }
  }

  private async fetchUpdates(): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=0`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
    if (!data.ok) return;

    for (const update of data.result) {
      this.offset = update.update_id + 1;

      if (update.callback_query) {
        await this.handleCallback(update.callback_query);
        continue;
      }

      const text = update.message?.text;
      const chatId = update.message?.chat.id;
      if (text && chatId) {
        console.log(`[telegram] Mesaj primit (chat ${chatId}): "${text}"`);
        this.onMessage(text, chatId);
      }
    }
  }

  // ── Gestioneaza butoanele inline de la hook-uri ──────────────
  private async handleCallback(cb: NonNullable<TelegramUpdate['callback_query']>): Promise<void> {
    const data = cb.data || '';
    const chatId = cb.message?.chat.id;

    // Raspunde imediat la Telegram ca sa dispara animatia loading
    await this.answerCallback(cb.id);

    // ── Permission hooks: perm_allow_<id> / perm_deny_<id> ─────
    const permMatch = data.match(/^perm_(allow|deny)_([a-f0-9]+)$/);
    if (permMatch && this.stateDir) {
      const [, decision, id] = permMatch;
      const responseFile = join(this.stateDir, `hook-response-${id}.json`);
      mkdirSync(this.stateDir, { recursive: true });
      writeFileSync(responseFile, JSON.stringify({ decision }), 'utf-8');
      console.log(`[telegram] Permission ${decision} pentru hook ${id}`);
      if (chatId) {
        await this.sendMessage(chatId,
          decision === 'allow' ? `✅ Permisiune acordata.` : `❌ Permisiune refuzata.`);
      }
      return;
    }

    // ── Plan hooks: plan_allow_<id> / plan_deny_<id> ────────────
    const planMatch = data.match(/^plan_(allow|deny)_([a-f0-9]+)$/);
    if (planMatch && this.stateDir) {
      const [, decision, id] = planMatch;
      const responseFile = join(this.stateDir, `hook-response-${id}.json`);
      mkdirSync(this.stateDir, { recursive: true });
      writeFileSync(responseFile, JSON.stringify({ decision }), 'utf-8');
      console.log(`[telegram] Plan ${decision} pentru hook ${id}`);
      if (chatId) {
        await this.sendMessage(chatId,
          decision === 'allow' ? `✅ Plan aprobat.` : `❌ Plan refuzat.`);
      }
      return;
    }

    // ── AskUserQuestion: askopt_<qIdx>_<optIdx> ─────────────────
    const askMatch = data.match(/^askopt_(\d+)_(\d+)$/);
    if (askMatch && this.stateDir) {
      const [, qIdxStr, optIdxStr] = askMatch;
      const qIdx = parseInt(qIdxStr, 10);
      const optIdx = parseInt(optIdxStr, 10);
      this.handleAskOption(qIdx, optIdx, chatId);
      return;
    }

    // ── AskUserQuestion multi-select submit ─────────────────────
    const askSubmitMatch = data.match(/^asksubmit_(\d+)$/);
    if (askSubmitMatch && this.stateDir) {
      this.handleAskSubmit(chatId);
      return;
    }
  }

  private handleAskOption(qIdx: number, optIdx: number, chatId?: number): void {
    const stateFile = join(this.stateDir, 'ask-state.json');
    if (!existsSync(stateFile)) return;

    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const q = state.questions?.[qIdx];
      if (!q) return;

      if (!q.multiSelect) {
        // Single select → inject raspunsul direct in agentul PTY
        const chosen = q.options?.[optIdx];
        if (chosen && chatId) {
          this.onMessage(`[RASPUNS INTREBARE] ${chosen}`, chatId);
          console.log(`[telegram] AskUserQuestion raspuns: "${chosen}"`);
        }
      } else {
        // Multi-select → toggle optiunea
        const chosen: number[] = state.multi_select_chosen || [];
        const idx = chosen.indexOf(optIdx);
        if (idx === -1) chosen.push(optIdx);
        else chosen.splice(idx, 1);
        state.multi_select_chosen = chosen;
        writeFileSync(stateFile, JSON.stringify(state), 'utf-8');
      }
    } catch {}
  }

  private handleAskSubmit(chatId?: number): void {
    const stateFile = join(this.stateDir, 'ask-state.json');
    if (!existsSync(stateFile)) return;

    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      const qIdx = state.current_question || 0;
      const q = state.questions?.[qIdx];
      if (!q) return;

      const chosen: string[] = (state.multi_select_chosen || [])
        .map((i: number) => q.options?.[i])
        .filter(Boolean);

      if (chosen.length > 0 && chatId) {
        this.onMessage(`[RASPUNS INTREBARE] ${chosen.join(', ')}`, chatId);
        console.log(`[telegram] AskUserQuestion multi-select: "${chosen.join(', ')}"`);
      }
    } catch {}
  }

  private async answerCallback(callbackQueryId: string): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch {}
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string
): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function validateTelegramToken(
  token: string
): Promise<{ ok: boolean; username?: string; firstName?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username: string; first_name: string } };
    if (data.ok && data.result) {
      return { ok: true, username: data.result.username, firstName: data.result.first_name };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
