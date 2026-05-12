// ============================================================
// CronScheduler — execută cron-uri din config.json per agent
// ============================================================
// Format expresie: "MIN HOUR DOM MON DOW" (standard unix cron)
// Suportă: * */n n n,m n-m
// La fiecare minut verifică dacă vreun job trebuie rulat.
// Când cronul fire-uiește, scrie un mesaj în inbox-ul agentului.
// ============================================================

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface CronEntry {
  expression: string;
  prompt: string;
  label?: string;
}

interface AgentCrons {
  agentName: string;
  crons: CronEntry[];
  busDir: string;
}

export class CronScheduler {
  private registrations: AgentCrons[] = [];
  private timer: NodeJS.Timeout | null = null;

  // ── Înregistrează cron-urile unui agent ──────────────────────
  register(agentName: string, crons: CronEntry[], busDir: string): void {
    if (!crons?.length) return;
    this.registrations.push({ agentName, crons, busDir });
    console.log(`[cron] "${agentName}": ${crons.length} job(uri) înregistrate`);
    for (const c of crons) {
      console.log(`[cron]   "${c.label || c.expression}" — ${c.expression}`);
    }
  }

  // ── Pornește scheduler-ul ────────────────────────────────────
  start(): void {
    // Aliniază la începutul minutului următor
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    setTimeout(() => {
      this.tick();
      this.timer = setInterval(() => this.tick(), 60_000);
    }, msToNextMinute);

    console.log(`[cron] Scheduler pornit (${this.registrations.length} agent/i, tick în ${Math.round(msToNextMinute / 1000)}s)`);
  }

  // ── Oprește scheduler-ul ─────────────────────────────────────
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ── Tick la fiecare minut ────────────────────────────────────
  private tick(): void {
    const now = new Date();
    for (const reg of this.registrations) {
      for (const cron of reg.crons) {
        if (this.matches(cron.expression, now)) {
          this.fire(reg.agentName, cron, reg.busDir, now);
        }
      }
    }
  }

  // ── Scrie mesaj în inbox-ul agentului ────────────────────────
  private fire(agentName: string, cron: CronEntry, busDir: string, now: Date): void {
    const label = cron.label || cron.expression;
    console.log(`[cron] Fire: "${agentName}" — ${label}`);

    const inboxDir = join(busDir, agentName, 'inbox');
    mkdirSync(inboxDir, { recursive: true });

    const id = randomUUID();
    const timestamp = now.toISOString();
    const filename = `${timestamp.replace(/[:.]/g, '-').slice(0, 19)}-${id}.json`;

    writeFileSync(join(inboxDir, filename), JSON.stringify({
      id,
      from: `cron:${label}`,
      to: agentName,
      content: cron.prompt,
      timestamp,
      requiresAck: false,
      meta: { cron: cron.expression, label },
    }, null, 2));
  }

  // ── Verifică dacă expresia se potrivește cu momentul dat ─────
  private matches(expr: string, now: Date): boolean {
    // Suportă @hourly @daily @weekly @monthly @yearly
    const aliases: Record<string, string> = {
      '@hourly':  '0 * * * *',
      '@daily':   '0 0 * * *',
      '@midnight':'0 0 * * *',
      '@weekly':  '0 0 * * 0',
      '@monthly': '0 0 1 * *',
      '@yearly':  '0 0 1 1 *',
      '@annually':'0 0 1 1 *',
    };
    const resolved = aliases[expr.trim()] ?? expr;
    const parts = resolved.trim().split(/\s+/);
    if (parts.length !== 5) {
      console.warn(`[cron] Expresie invalidă: "${expr}"`);
      return false;
    }

    const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

    return (
      this.matchField(minExpr,  now.getMinutes())    &&
      this.matchField(hourExpr, now.getHours())      &&
      this.matchField(domExpr,  now.getDate())       &&
      this.matchField(monExpr,  now.getMonth() + 1)  &&
      this.matchField(dowExpr,  now.getDay())
    );
  }

  // ── Evaluează un câmp cron față de o valoare ─────────────────
  private matchField(field: string, value: number): boolean {
    if (field === '*') return true;

    for (const part of field.split(',')) {
      // */n
      if (part.startsWith('*/')) {
        const step = parseInt(part.slice(2), 10);
        if (!isNaN(step) && value % step === 0) return true;
        continue;
      }
      // n-m/s sau n-m
      if (part.includes('-')) {
        const [range, stepStr] = part.split('/');
        const [lo, hi] = range.split('-').map(Number);
        const step = stepStr ? parseInt(stepStr, 10) : 1;
        if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
        continue;
      }
      // număr simplu
      if (parseInt(part, 10) === value) return true;
    }
    return false;
  }
}
