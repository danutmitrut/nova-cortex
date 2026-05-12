// ============================================================
// Cron Scheduler
// ============================================================
// Gestionează job-urile cron per agent:
//   - Adaugă / elimină / listează job-uri
//   - Verifică la fiecare minut dacă un job trebuie rulat
//   - Persistă job-urile în state/<agent>/crons.json
//     → supraviețuiesc restart-ului mașinii
//
// De ce persistență pe disk și nu în memorie?
//   La restart (crash, update, reboot), job-urile trebuie
//   reîncărcate automat. Fără persistență, cron-urile dispar.
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { parseCron, matchesCron, type CronFields } from './parser.js';

export interface CronJob {
  id: string;
  expression: string;   // e.g. "0 8 * * *"
  prompt: string;       // ce injectăm în PTY când se declanșează
  label: string;        // descriere human-readable
  createdAt: string;
  lastRun?: string;
}

// Callback apelat când un job se declanșează
type FireCallback = (job: CronJob) => void;

export class CronScheduler {
  private jobs: CronJob[] = [];
  private parsedFields: Map<string, CronFields> = new Map();
  private statePath: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onFire: FireCallback;
  private lastTickMinute = -1; // evităm dubla declanșare în același minut

  constructor(agentName: string, stateDir: string, onFire: FireCallback) {
    this.statePath = join(stateDir, agentName, 'crons.json');
    this.onFire = onFire;
    this.load();
  }

  // ── Adaugă un job nou ────────────────────────────────────────
  add(expression: string, prompt: string, label: string): CronJob {
    // Validăm expresia înainte să salvăm
    const fields = parseCron(expression);

    const job: CronJob = {
      id: randomUUID(),
      expression,
      prompt,
      label,
      createdAt: new Date().toISOString(),
    };

    this.jobs.push(job);
    this.parsedFields.set(job.id, fields);
    this.save();

    console.log(`[cron] Job adăugat: "${label}" (${expression}) — ID: ${job.id}`);
    return job;
  }

  // ── Elimină un job după ID ───────────────────────────────────
  remove(id: string): boolean {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter(j => j.id !== id);
    this.parsedFields.delete(id);

    if (this.jobs.length < before) {
      this.save();
      console.log(`[cron] Job eliminat: ${id}`);
      return true;
    }
    return false;
  }

  // ── Listează toate job-urile ─────────────────────────────────
  list(): CronJob[] {
    return [...this.jobs];
  }

  // ── Pornește verificarea periodică ──────────────────────────
  start(): void {
    console.log(`[cron] Scheduler pornit cu ${this.jobs.length} job-uri.`);

    // Verificăm la fiecare 10 secunde dacă a venit un minut nou
    // (nu la fiecare secundă — economisim resurse)
    this.timer = setInterval(() => this.tick(), 10_000);
    this.tick(); // verificăm și imediat la pornire
  }

  // ── Oprește scheduler-ul ─────────────────────────────────────
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[cron] Scheduler oprit.');
  }

  // ── Verifică dacă vreun job trebuie rulat acum ───────────────
  private tick(): void {
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // Prevenim declanșarea de două ori în același minut
    if (currentMinute === this.lastTickMinute) return;
    this.lastTickMinute = currentMinute;

    for (const job of this.jobs) {
      const fields = this.parsedFields.get(job.id);
      if (!fields) continue;

      if (matchesCron(fields, now)) {
        console.log(`[cron] Declanșez: "${job.label}"`);
        job.lastRun = now.toISOString();
        this.save();
        this.onFire(job);
      }
    }
  }

  // ── Salvează pe disk ─────────────────────────────────────────
  private save(): void {
    const dir = join(this.statePath, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(this.jobs, null, 2), 'utf-8');
  }

  // ── Încarcă de pe disk la pornire ────────────────────────────
  private load(): void {
    if (!existsSync(this.statePath)) return;

    try {
      this.jobs = JSON.parse(readFileSync(this.statePath, 'utf-8'));
      // Re-parsăm expresiile cron pentru fiecare job încărcat
      for (const job of this.jobs) {
        this.parsedFields.set(job.id, parseCron(job.expression));
      }
      console.log(`[cron] ${this.jobs.length} job-uri încărcate din state.`);
    } catch (err) {
      console.error('[cron] Eroare la încărcarea state-ului:', err);
      this.jobs = [];
    }
  }
}
