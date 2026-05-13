// ============================================================
// Watchdog — auto-restart la crash cu exponential backoff
// ============================================================
// Ce face:
//   - Monitorizează un agent și îl repornește la crash
//   - Exponential backoff: 3s → 6s → 12s → 24s → 48s
//   - Renunță după MAX_CRASHES consecutive (evităm crash loop)
//   - Resetează contorul dacă agentul rulează stabil 5 minute
//
// De ce exponential backoff și nu restart imediat?
//   Dacă agentul cade din cauza unei resurse indisponibile
//   (rețea, API down), restart imediat nu ajută — consumă
//   resurse inutil. Backoff dă timp resursei să se refacă.
//
// De ce MAX_CRASHES = 5?
//   5 crash-uri consecutive = problema nu e tranzitorie.
//   Alertăm operatorul în loc să continuăm în van.
// ============================================================

import type { AgentProcess } from './agent-process.ts';

const MAX_CRASHES = 5;           // renunțăm după atâtea crash-uri consecutive
const BASE_DELAY_MS = 3_000;     // 3 secunde delay inițial
const STABLE_THRESHOLD_MS = 5 * 60_000; // 5 minute = agent considerat stabil

export class Watchdog {
  private agent: AgentProcess;
  private crashCount = 0;
  private lastStartTime = 0;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private active = true;

  constructor(agent: AgentProcess) {
    this.agent = agent;
  }

  // ── Apelat de daemon când agentul se închide ─────────────────
  onAgentExit(exitCode: number): void {
    if (!this.active) return;

    // Oprire curată (exitCode 0) = utilizatorul a oprit agentul
    // Nu repornim — nu e crash
    if (exitCode === 0) {
      console.log(`[watchdog:${this.agent.name}] Oprire curată — nu repornesc.`);
      return;
    }

    // Anulăm timerul de stabilitate dacă agentul a căzut înainte
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    this.crashCount++;
    console.warn(`[watchdog:${this.agent.name}] Crash #${this.crashCount} (cod: ${exitCode})`);

    if (this.crashCount > MAX_CRASHES) {
      console.error(
        `[watchdog:${this.agent.name}] ${MAX_CRASHES} crash-uri consecutive — renunț. ` +
        `Verifică logurile și repornește manual cu: myheros start ${this.agent.name}`
      );
      return;
    }

    // Delay exponential: 3s, 6s, 12s, 24s, 48s
    const delay = BASE_DELAY_MS * Math.pow(2, this.crashCount - 1);
    console.log(`[watchdog:${this.agent.name}] Repornesc în ${delay / 1000}s...`);

    setTimeout(() => {
      if (!this.active) return;
      console.log(`[watchdog:${this.agent.name}] Repornesc acum.`);
      this.lastStartTime = Date.now();
      this.agent.start();
      this.scheduleStabilityCheck();
    }, delay);
  }

  // ── Oprește watchdog-ul (când daemonul se oprește) ───────────
  stop(): void {
    this.active = false;
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  // ── Resetăm contorul dacă agentul rămâne stabil 5 minute ────
  // Apelat la fiecare start al agentului
  scheduleStabilityCheck(): void {
    if (this.stableTimer) clearTimeout(this.stableTimer);

    this.stableTimer = setTimeout(() => {
      if (this.crashCount > 0) {
        console.log(
          `[watchdog:${this.agent.name}] Stabil 5 minute — resetez contorul de crash-uri ` +
          `(era: ${this.crashCount})`
        );
        this.crashCount = 0;
      }
    }, STABLE_THRESHOLD_MS);
  }
}
