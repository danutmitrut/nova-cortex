// ============================================================
// Bus Inbox — monitorizează inbox-ul unui agent
// ============================================================
// Verifică la fiecare secundă dacă au venit mesaje noi.
// Când găsește un mesaj:
//   1. Îl livrează agentului (callback → inject în PTY)
//   2. Îl mută în processed/ (nu îl procesăm de două ori)
//   3. Dacă requiresAck, scrie un ACK în bus/<from>/ack/
//
// De ce polling și nu fs.watch?
//   fs.watch are comportament inconsistent între Mac și Windows.
//   Polling la 1s e mai simplu și suficient pentru uzul nostru.
// ============================================================

import {
  readdirSync, readFileSync, renameSync,
  mkdirSync, writeFileSync, existsSync,
} from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type { BusMessage, BusAck } from './types.ts';

type DeliverCallback = (message: BusMessage) => void;

// Fereastră de deduplicare: ignorăm mesaje cu același conținut
// de la același expeditor dacă au venit în mai puțin de 60s.
const DEDUP_WINDOW_MS = 60_000;

export class BusInbox {
  private agentName: string;
  private busDir: string;
  private inboxDir: string;
  private processedDir: string;
  private onDeliver: DeliverCallback;
  private timer: ReturnType<typeof setInterval> | null = null;
  // key: "<from>:<contentHash>", value: timestamp prima livrare
  private recentHashes: Map<string, number> = new Map();

  constructor(agentName: string, busDir: string, onDeliver: DeliverCallback) {
    this.agentName = agentName;
    this.busDir = busDir;
    this.inboxDir = join(busDir, agentName, 'inbox');
    this.processedDir = join(busDir, agentName, 'processed');
    this.onDeliver = onDeliver;
  }

  // ── Pornește monitorizarea inbox-ului ────────────────────────
  start(): void {
    // Creăm directoarele necesare
    if (!existsSync(this.inboxDir)) mkdirSync(this.inboxDir, { recursive: true });
    if (!existsSync(this.processedDir)) mkdirSync(this.processedDir, { recursive: true });

    this.timer = setInterval(() => this.poll(), 1_000);
    console.log(`[bus:${this.agentName}] Inbox activ.`);
  }

  // ── Oprește monitorizarea ────────────────────────────────────
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── Verifică inbox-ul pentru mesaje noi ─────────────────────
  private poll(): void {
    if (!existsSync(this.inboxDir)) return;

    const files = readdirSync(this.inboxDir)
      .filter(f => f.endsWith('.json'))
      .sort(); // ordine cronologică (timestamp în nume)

    for (const file of files) {
      this.processFile(file);
    }
  }

  // ── Procesează un fișier de mesaj ────────────────────────────
  private processFile(filename: string): void {
    const filePath = join(this.inboxDir, filename);

    try {
      const message: BusMessage = JSON.parse(readFileSync(filePath, 'utf-8'));

      // Mutăm în processed/ ÎNAINTE de livrare
      const destPath = join(this.processedDir, filename);
      renameSync(filePath, destPath);

      // Deduplicare: ignorăm mesaje cu conținut identic de la același
      // expeditor dacă au venit în mai puțin de DEDUP_WINDOW_MS.
      // Normalizăm conținutul (diacritice, whitespace) pentru a prinde
      // și retry-urile în care agentul retrimite fără diacritice.
      const dedupKey = `${message.from}:${normalizeHash(message.content)}`;
      const now = Date.now();
      const lastSeen = this.recentHashes.get(dedupKey);

      if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) {
        console.log(`[bus:${this.agentName}] Duplicat ignorat de la "${message.from}" (${Math.round((now - lastSeen) / 1000)}s față de original)`);
        return;
      }

      this.recentHashes.set(dedupKey, now);
      // Curățăm hash-urile vechi periodic (>2x fereastra)
      if (this.recentHashes.size > 100) {
        for (const [k, t] of this.recentHashes) {
          if (now - t > DEDUP_WINDOW_MS * 2) this.recentHashes.delete(k);
        }
      }

      console.log(`[bus:${this.agentName}] Mesaj primit de la "${message.from}"`);

      if (message.requiresAck) {
        this.sendAck(message);
      }

      this.onDeliver(message);

    } catch (err) {
      console.error(`[bus:${this.agentName}] Eroare la procesarea ${filename}:`, err);
    }
  }

  // ── Trimite ACK expeditorului ────────────────────────────────
  private sendAck(message: BusMessage): void {
    const ack: BusAck = {
      messageId: message.id,
      from: this.agentName,
      timestamp: new Date().toISOString(),
    };

    const ackDir = join(this.busDir, message.from, 'ack');
    if (!existsSync(ackDir)) mkdirSync(ackDir, { recursive: true });

    const ackFile = join(ackDir, `${message.id}.json`);
    writeFileSync(ackFile, JSON.stringify(ack, null, 2), 'utf-8');

    console.log(`[bus:${this.agentName}] ACK trimis la "${message.from}"`);
  }
}

// Normalizează textul și returnează hash MD5.
// Elimină diacriticele și whitespace-ul excesiv înainte de hash,
// astfel că "Agenți" și "Agenti" produc același hash.
function normalizeHash(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[ăâ]/g, 'a')
    .replace(/î/g, 'i')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('md5').update(normalized).digest('hex');
}
