// ============================================================
// AgentProcess — ciclul de viață al unui agent
// ============================================================
// Responsabilități:
//   - Pornește Claude Code în PTY pentru un agent specific
//   - Deține CronScheduler și TelegramPoller pentru agentul acesta
//   - Expune start() / stop() / isAlive() / inject()
//   - Notifică daemonul când agentul se închide (onExit callback)
//
// Un daemon cu 3 agenți = 3 instanțe AgentProcess.
// Fiecare e complet independentă.
// ============================================================

import pty from 'node-pty';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { TelegramPoller } from '../telegram/poller.ts';
import { CronScheduler } from '../cron/scheduler.ts';
import { BusInbox } from '../bus/inbox.ts';
import { sendMessage } from '../bus/send.ts';
import { ragSearch, formatRagContext } from '../rag/search.ts';

export interface AgentConfig {
  name: string;
  startup_prompt: string;
  crons?: Array<{ expression: string; prompt: string; label: string }>;
}

export type AgentStatus = 'stopped' | 'starting' | 'running' | 'crashed';

export class AgentProcess {
  readonly name: string;
  readonly agentDir: string;

  private ptyProcess: ReturnType<typeof pty.spawn> | null = null;
  private poller: TelegramPoller | null = null;
  private cron: CronScheduler | null = null;
  private busInbox: BusInbox | null = null;
  private config: AgentConfig;
  private envVars: Record<string, string>;
  private stateDir: string;
  private busDir: string;
  private knowledgeDir: string;

  private _status: AgentStatus = 'stopped';
  private _onExit: ((name: string, exitCode: number) => void) | null = null;
  private _intentionalStop = false; // previne watchdog-ul la oprire manuală

  constructor(agentDir: string, stateDir: string, busDir: string, knowledgeDir = '') {
    this.agentDir = agentDir;
    this.stateDir = stateDir;
    this.busDir = busDir;
    this.knowledgeDir = knowledgeDir;
    this.config = JSON.parse(readFileSync(join(agentDir, 'config.json'), 'utf-8'));
    this.name = this.config.name;
    this.envVars = this.loadEnv();
  }

  get status(): AgentStatus { return this._status; }

  // ── Registrăm callback pentru exit ──────────────────────────
  onExit(cb: (name: string, exitCode: number) => void): void {
    this._onExit = cb;
  }

  // ── Pornești agentul ─────────────────────────────────────────
  start(): void {
    if (this._status === 'running' || this._status === 'starting') {
      console.log(`[${this.name}] Deja pornit — ignorăm.`);
      return;
    }

    this._status = 'starting';
    console.log(`[${this.name}] Pornesc...`);

    const identityPath = join(this.agentDir, 'IDENTITY.md');
    const identityContent = existsSync(identityPath)
      ? readFileSync(identityPath, 'utf-8')
      : '';

    const claudeCmd = platform() === 'win32' ? 'claude.cmd' : 'claude';
    const args = [
      '--dangerously-skip-permissions',
      ...(identityContent ? ['--append-system-prompt', identityContent] : []),
      this.config.startup_prompt,
    ];

    this.ptyProcess = pty.spawn(claudeCmd, args, {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      cwd: this.agentDir,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
        ...this.envVars,
      } as Record<string, string>,
    });

    this._status = 'running';
    console.log(`[${this.name}] PTY pornit (PID: ${this.ptyProcess.pid})`);

    // Afișăm output-ul în consolă cu prefix de agent
    this.ptyProcess.onData((data) => {
      process.stdout.write(`[${this.name}] ${data}`);
    });

    // Auto-acceptăm "trust this folder?"
    setTimeout(() => this.ptyProcess?.write('\r'), 5000);
    setTimeout(() => this.ptyProcess?.write('\r'), 8000);

    // Pornești Telegram + Cron după boot
    setTimeout(() => this.startServices(), 12000);

    // Detectăm închiderea
    this.ptyProcess.onExit(({ exitCode }) => {
      // Dacă am oprit noi intenționat, raportăm exitCode 0
      // → watchdog-ul nu va reporni agentul
      const reportedCode = this._intentionalStop ? 0 : exitCode;
      this._intentionalStop = false;

      console.log(`[${this.name}] Ieșit cu codul: ${exitCode}`);
      this._status = exitCode === 0 ? 'stopped' : 'crashed';
      this.stopServices();
      this._onExit?.(this.name, reportedCode);
    });
  }

  // ── Oprești agentul ──────────────────────────────────────────
  stop(): void {
    this._intentionalStop = true; // semnalăm watchdog-ului că e oprire voluntară
    this.stopServices();
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    this._status = 'stopped';
    console.log(`[${this.name}] Oprit.`);
  }

  // ── Injectează un mesaj în PTY ───────────────────────────────
  inject(text: string): void {
    if (!this.ptyProcess) return;
    this.ptyProcess.write('\x1b[200~' + text + '\x1b[201~');
    setTimeout(() => this.ptyProcess?.write('\r'), 300);
  }

  isAlive(): boolean {
    return this._status === 'running';
  }

  // ── Pornești Telegram + Cron ─────────────────────────────────
  private startServices(): void {
    const { BOT_TOKEN, CHAT_ID } = this.envVars;

    if (BOT_TOKEN && CHAT_ID) {
      this.poller = new TelegramPoller(BOT_TOKEN, (text, chatId) => {
        console.log(`[${this.name}] Mesaj Telegram: "${text}"`);
        this.inject(
          `Mesaj nou pe Telegram de la chat ${chatId}: "${text}"\nRăspunde via curl cu BOT_TOKEN și CHAT_ID din env.`
        );
      });
      this.poller.start();
    }

    this.cron = new CronScheduler(this.name, this.stateDir, (job) => {
      console.log(`[${this.name}] Cron declanșat: "${job.label}"`);
      this.inject(job.prompt);
    });

    if (this.cron.list().length === 0 && this.config.crons?.length) {
      for (const c of this.config.crons) {
        this.cron.add(c.expression, c.prompt, c.label);
      }
    }

    this.cron.start();

    // ── Bus Inbox ────────────────────────────────────────────────
    this.busInbox = new BusInbox(this.name, this.busDir, (message) => {
      console.log(`[${this.name}] Mesaj bus de la "${message.from}": "${message.content.slice(0, 60)}"`);
      // Injectăm mesajul în PTY formatat clar pentru agent
      this.inject(
        `[BUS] Mesaj de la agentul "${message.from}":\n${message.content}\n` +
        (message.requiresAck ? `\n(Mesajul a fost confirmat automat. Procesează și răspunde dacă e necesar.)` : '')
      );
    });
    this.busInbox.start();

    // ── RAG: injectăm context relevant din knowledge base ────────
    if (this.knowledgeDir) {
      const chunks = ragSearch(this.config.startup_prompt, this.knowledgeDir, 3);
      if (chunks.length > 0) {
        const context = formatRagContext(chunks);
        console.log(`[${this.name}] RAG: ${chunks.length} chunk(uri) relevante găsite.`);
        this.inject(`[CONTEXT AUTOMAT]\n${context}\n\nUtilizează aceste informații dacă sunt relevante pentru sarcinile tale.`);
      }
    }
  }

  // ── Oprești serviciile (Telegram + Cron + Bus) ───────────────
  private stopServices(): void {
    this.poller?.stop();
    this.poller = null;
    this.cron?.stop();
    this.cron = null;
    this.busInbox?.stop();
    this.busInbox = null;
  }

  // ── Trimite un mesaj bus către un alt agent ──────────────────
  sendBusMessage(to: string, content: string, requiresAck = false) {
    return sendMessage(this.busDir, this.name, to, content, requiresAck);
  }

  // ── Parsăm .env al agentului ─────────────────────────────────
  private loadEnv(): Record<string, string> {
    const envPath = join(this.agentDir, '.env');
    if (!existsSync(envPath)) return {};

    const vars: Record<string, string> = {};
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) vars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return vars;
  }
}
