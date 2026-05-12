// ============================================================
// Telegram Poller
// ============================================================
// Apelează getUpdates la fiecare 1 secundă.
// Când vine un mesaj nou, apelează callback-ul `onMessage`.
//
// De ce polling și nu webhooks?
//   Webhooks cer un server public cu HTTPS.
//   Polling funcționează de pe orice mașină, fără port deschis.
//   CortextOS folosește același pattern.
// ============================================================

interface TelegramMessage {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number };
    text?: string;
  };
}

type MessageCallback = (text: string, chatId: number) => void;

export class TelegramPoller {
  private offset = 0;       // ID-ul ultimului update procesat — evităm duplicatele
  private running = false;
  private token: string;
  private onMessage: MessageCallback;

  constructor(token: string, onMessage: MessageCallback) {
    this.token = token;
    this.onMessage = onMessage;
  }

  // ── Pornește polling-ul ──────────────────────────────────────
  start(): void {
    this.running = true;
    console.log('[telegram] Poller pornit — aștept mesaje...');
    this.poll();
  }

  // ── Oprește polling-ul ───────────────────────────────────────
  stop(): void {
    this.running = false;
    console.log('[telegram] Poller oprit.');
  }

  // ── Bucla de polling ─────────────────────────────────────────
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.fetchUpdates();
      } catch (err) {
        // Nu oprim polling-ul la eroare de rețea — reîncercăm după 5s
        console.error('[telegram] Eroare la getUpdates:', err);
        await sleep(5000);
        continue;
      }
      await sleep(1000); // așteptăm 1 secundă între cereri
    }
  }

  // ── Cere update-uri noi de la Telegram ───────────────────────
  private async fetchUpdates(): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=0`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { ok: boolean; result: TelegramMessage[] };

    if (!data.ok) return;

    for (const update of data.result) {
      // offset + 1 = marchăm update-ul ca procesat pentru apelul următor
      this.offset = update.update_id + 1;

      const text = update.message?.text;
      const chatId = update.message?.chat.id;

      if (text && chatId) {
        console.log(`[telegram] Mesaj primit (chat ${chatId}): "${text}"`);
        this.onMessage(text, chatId);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
