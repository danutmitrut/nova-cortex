// ============================================================
// Daemon — procesul central My HerOS
// ============================================================
// Responsabilități:
//   - Descoperă automat toți agenții din agents/*/config.json
//   - Creează un AgentProcess per agent și îl pornește
//   - Menține un registru de agenți activi
//   - Ascultă comenzi prin IPC (Unix socket)
//   - La oprire (SIGINT/SIGTERM) oprește toți agenții ordonat
//
// Analogie: PM2 este daemonul pentru procese Node.js.
//           My HerOS Daemon este PM2-ul pentru agenți Claude.
// ============================================================

import { readdirSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { AgentProcess } from './agent-process.ts';
import { IpcServer } from './ipc.ts';
import { Watchdog } from './watchdog.ts';
import { DashboardServer } from '../dashboard/server.ts';
import { runSecurityScan, printSecurityReport } from '../security/scanner.ts';
import { AgentRegistry } from './agent-registry.ts';
import { CronScheduler } from './cron-scheduler.ts';

export class Daemon {
  private agents: Map<string, AgentProcess> = new Map();
  private watchdogs: Map<string, Watchdog> = new Map();
  private agentsDir: string;
  private stateDir: string;
  private busDir: string;
  private knowledgeDir: string;
  private ipc: IpcServer;
  private registry: AgentRegistry;
  private cron: CronScheduler = new CronScheduler();

  constructor(agentsDir: string, stateDir: string, busDir: string, knowledgeDir = '') {
    this.agentsDir = resolve(agentsDir);
    this.stateDir = resolve(stateDir);
    this.busDir = resolve(busDir);
    this.knowledgeDir = knowledgeDir ? resolve(knowledgeDir) : '';
    this.registry = new AgentRegistry(this.stateDir);
    this.ipc = new IpcServer(this);
  }

  // ── Pornește daemonul ────────────────────────────────────────
  async start(): Promise<void> {
    console.log('[daemon] My HerOS pornit.');
    console.log(`[daemon] Caut agenți în: ${this.agentsDir}`);

    const findings = runSecurityScan(this.agentsDir, this.knowledgeDir);
    printSecurityReport(findings);

    this.discoverAgents();
    this.startAllAgents();
    this.cron.start();
    this.ipc.start();
    new DashboardServer(this, this.busDir, this.stateDir).start();
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

      // Verifica daca agentul e dezactivat in registry
      if (!this.registry.isEnabled(entry.name)) {
        console.log(`[daemon] Ignorat ${entry.name} — dezactivat (myheros enable ${entry.name} pentru a reactiva)`);
        continue;
      }

      try {
        const agent = new AgentProcess(agentDir, this.stateDir, this.busDir, this.knowledgeDir);
        const watchdog = new Watchdog(agent);

        // Watchdog preia controlul la crash — repornește cu backoff
        agent.onExit((name, exitCode) => {
          console.log(`[daemon] Agentul "${name}" s-a închis (cod: ${exitCode})`);
          watchdog.onAgentExit(exitCode);
        });

        this.agents.set(agent.name, agent);
        this.watchdogs.set(agent.name, watchdog);

        // Înregistrează cron-urile din config.json
        try {
          const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
          if (cfg.crons?.length) this.cron.register(agent.name, cfg.crons, this.busDir);
        } catch {}

        console.log(`[daemon] Agent descoperit: "${agent.name}"`);
      } catch (err) {
        console.error(`[daemon] Eroare la încărcarea agentului ${entry.name}:`, err);
      }
    }
  }

  // ── Pornește toți agenții — staggered cu 3s între fiecare ───
  // De ce staggered și nu simultan?
  //   Fiecare agent pornește Claude Code (proces greu).
  //   Dacă avem 5 agenți și toți pornesc în același moment,
  //   sistemul e supraîncărcat în primele secunde.
  //   3s între agenți = boot lin, fără vârfuri de CPU.
  private startAllAgents(): void {
    const agents = Array.from(this.agents.entries());
    agents.forEach(([name, agent], index) => {
      setTimeout(() => {
        agent.start();
        this.watchdogs.get(name)?.scheduleStabilityCheck();
        console.log(`[daemon] Agent "${name}" pornit (${index + 1}/${agents.length})`);
      }, index * 3_000); // 0s, 3s, 6s, 9s, ...
    });
  }

  // ── Returnează lista de nume agenți ─────────────────────────
  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
  }

  // ── Returnează output-ul PTY al unui agent specific ──────────
  getAgentOutput(name: string): string[] {
    return this.agents.get(name)?.getOutput() ?? [];
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

  // ── Activeaza un agent (persistat in registry) ───────────────
  enableAgent(name: string): boolean {
    this.registry.enable(name);
    // Daca agentul nu e incarcat, il incarcam si pornim
    if (!this.agents.has(name)) {
      const agentDir = join(this.agentsDir, name);
      const configPath = join(agentDir, 'config.json');
      if (!existsSync(configPath)) return false;
      try {
        const agent = new AgentProcess(agentDir, this.stateDir, this.busDir, this.knowledgeDir);
        const watchdog = new Watchdog(agent);
        agent.onExit((n, exitCode) => {
          console.log(`[daemon] Agentul "${n}" s-a inchis (cod: ${exitCode})`);
          watchdog.onAgentExit(exitCode);
        });
        this.agents.set(name, agent);
        this.watchdogs.set(name, watchdog);
        try {
          const cfg = JSON.parse(readFileSync(join(agentDir, 'config.json'), 'utf-8'));
          if (cfg.crons?.length) this.cron.register(name, cfg.crons, this.busDir);
        } catch {}
        agent.start();
        watchdog.scheduleStabilityCheck();
        console.log(`[daemon] Agent "${name}" activat si pornit.`);
      } catch (err) {
        console.error(`[daemon] Eroare la activarea agentului ${name}:`, err);
        return false;
      }
    }
    return true;
  }

  // ── Dezactiveaza un agent (persistat in registry) ────────────
  disableAgent(name: string): boolean {
    this.registry.disable(name);
    const agent = this.agents.get(name);
    if (agent) {
      this.watchdogs.get(name)?.stop();
      agent.stop();
      this.agents.delete(name);
      this.watchdogs.delete(name);
      console.log(`[daemon] Agent "${name}" dezactivat si oprit.`);
    }
    return true;
  }

  // ── Returneaza heartbeat-urile tuturor agentilor ─────────────
  getHeartbeats(): object[] {
    const heartbeats: object[] = [];
    for (const name of this.agents.keys()) {
      const hbPath = join(this.stateDir, name, 'heartbeat.json');
      if (existsSync(hbPath)) {
        try { heartbeats.push(JSON.parse(readFileSync(hbPath, 'utf-8'))); } catch {}
      }
    }
    return heartbeats;
  }

  // ── Oprire ordonată la SIGINT / SIGTERM ──────────────────────
  private setupShutdown(): void {
    const shutdown = async () => {
      console.log('\n[daemon] Oprire ordonată — salvez memoria agenților...');

      // Cerem fiecarui agent sa isi salveze memoria si sa genereze raport
      for (const agent of this.agents.values()) {
        agent.saveMemory();
        agent.saveSessionReport();
      }

      // Asteptam 15s ca agentii sa scrie memoria si raportul de sesiune
      await new Promise(r => setTimeout(r, 15_000));

      this.cron.stop();
      for (const watchdog of this.watchdogs.values()) {
        watchdog.stop();
      }
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
