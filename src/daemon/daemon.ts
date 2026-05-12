// ============================================================
// Daemon — procesul central Nova Cortex
// ============================================================
// Responsabilități:
//   - Descoperă automat toți agenții din agents/*/config.json
//   - Creează un AgentProcess per agent și îl pornește
//   - Menține un registru de agenți activi
//   - Ascultă comenzi prin IPC (Unix socket)
//   - La oprire (SIGINT/SIGTERM) oprește toți agenții ordonat
//
// Analogie: PM2 este daemonul pentru procese Node.js.
//           Nova Cortex Daemon este PM2-ul pentru agenți Claude.
// ============================================================

import { readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { AgentProcess } from './agent-process.ts';
import { IpcServer } from './ipc.ts';

export class Daemon {
  private agents: Map<string, AgentProcess> = new Map();
  private agentsDir: string;
  private stateDir: string;
  private ipc: IpcServer;

  constructor(agentsDir: string, stateDir: string) {
    this.agentsDir = resolve(agentsDir);
    this.stateDir = resolve(stateDir);
    this.ipc = new IpcServer(this);
  }

  // ── Pornește daemonul ────────────────────────────────────────
  async start(): Promise<void> {
    console.log('[daemon] Nova Cortex pornit.');
    console.log(`[daemon] Caut agenți în: ${this.agentsDir}`);

    this.discoverAgents();
    this.startAllAgents();
    this.ipc.start();
    this.setupShutdown();

    console.log(`[daemon] ${this.agents.size} agent(i) activ(i).`);
  }

  // ── Descoperă agenții din agents/*/ ─────────────────────────
  private discoverAgents(): void {
    if (!existsSync(this.agentsDir)) {
      console.error(`[daemon] Directorul ${this.agentsDir} nu există.`);
      return;
    }

    const entries = readdirSync(this.agentsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const agentDir = join(this.agentsDir, entry.name);
      const configPath = join(agentDir, 'config.json');

      if (!existsSync(configPath)) {
        console.log(`[daemon] Ignorat ${entry.name} — lipsește config.json`);
        continue;
      }

      try {
        const agent = new AgentProcess(agentDir, this.stateDir);

        // Daemonul e notificat când agentul se închide
        // (Step 6 va adăuga restart automat aici)
        agent.onExit((name, exitCode) => {
          console.log(`[daemon] Agentul "${name}" s-a închis (cod: ${exitCode})`);
        });

        this.agents.set(agent.name, agent);
        console.log(`[daemon] Agent descoperit: "${agent.name}"`);
      } catch (err) {
        console.error(`[daemon] Eroare la încărcarea agentului ${entry.name}:`, err);
      }
    }
  }

  // ── Pornește toți agenții descoperiți ────────────────────────
  private startAllAgents(): void {
    for (const agent of this.agents.values()) {
      agent.start();
    }
  }

  // ── Returnează statusul tuturor agenților ───────────────────
  getStatus(): Array<{ name: string; status: string; alive: boolean }> {
    return Array.from(this.agents.values()).map(a => ({
      name: a.name,
      status: a.status,
      alive: a.isAlive(),
    }));
  }

  // ── Pornește un agent specific după nume ─────────────────────
  startAgent(name: string): boolean {
    const agent = this.agents.get(name);
    if (!agent) return false;
    agent.start();
    return true;
  }

  // ── Oprește un agent specific după nume ──────────────────────
  stopAgent(name: string): boolean {
    const agent = this.agents.get(name);
    if (!agent) return false;
    agent.stop();
    return true;
  }

  // ── Oprire ordonată la SIGINT / SIGTERM ──────────────────────
  private setupShutdown(): void {
    const shutdown = () => {
      console.log('\n[daemon] Oprire ordonată...');
      for (const agent of this.agents.values()) {
        agent.stop();
      }
      this.ipc.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}
