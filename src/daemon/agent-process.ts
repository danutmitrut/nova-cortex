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
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { platform } from 'os';
import { TelegramPoller } from '../telegram/poller.ts';
import { CronScheduler } from '../cron/scheduler.ts';
import { BusInbox } from '../bus/inbox.ts';
import { sendMessage } from '../bus/send.ts';
import { ragSearch, formatRagContext } from '../rag/search.ts';
import { sendTelegramMessage } from '../telegram/poller.ts';
import { loadMemory, formatMemoryForPrompt, buildSavePrompt } from './memory.ts';

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
  private _intentionalStop = false;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private outputBuffer: string[] = [];
  private static readonly MAX_OUTPUT = 200;
  private startTime: number | null = null;
  private lastOutputAt: number | null = null;

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

    // Modular brain: incarca modulele de context pe rand (nu tot odata)
    const loadModule = (filename: string) => {
      const p = join(this.agentDir, filename);
      return existsSync(p) ? readFileSync(p, 'utf-8') : '';
    };

    const identityContent = loadModule('IDENTITY.md');
    const goalsContent = loadModule('GOALS.md');
    const guardrailsContent = loadModule('GUARDRAILS.md');

    const memory = loadMemory(this.name, this.stateDir);
    if (memory) {
      console.log(`[${this.name}] Memorie găsită — injectată în system prompt.`);
    }
    if (goalsContent) console.log(`[${this.name}] GOALS.md incarcat.`);
    if (guardrailsContent) console.log(`[${this.name}] GUARDRAILS.md incarcat.`);

    const systemPrompt = [
      identityContent,
      goalsContent,
      guardrailsContent,
      memory ? formatMemoryForPrompt(memory) : '',
    ].filter(Boolean).join('\n\n---\n\n');

    const claudeCmd = platform() === 'win32' ? 'claude.cmd' : 'claude';
    const args = [
      '--dangerously-skip-permissions',
      ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : []),
      this.config.startup_prompt,
    ];

    // Genereaza .claude/settings.json cu hooks inregistrate
    this.generateHooksSettings();

    const agentStateDir = resolve(this.stateDir, this.name);
    const hooksDir = resolve(new URL('../../src/hooks', import.meta.url).pathname);
    const myherosCmd = resolve(new URL('../../src/myheros.ts', import.meta.url).pathname);

    this.ptyProcess = pty.spawn(claudeCmd, args, {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      cwd: this.agentDir,
      env: {
        ...process.env,
        PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
        ...this.envVars,
        NC_AGENT_NAME: this.name,
        NC_STATE_DIR: agentStateDir,
        NC_HOOKS_DIR: hooksDir,
        NC_MYHEROS_CMD: myherosCmd,
      } as Record<string, string>,
    });

    this._status = 'running';
    this.startTime = Date.now();
    console.log(`[${this.name}] PTY pornit (PID: ${this.ptyProcess.pid})`);

    // Afișăm output-ul în consolă și îl capturăm în buffer
    this.ptyProcess.onData((data) => {
      process.stdout.write(`[${this.name}] ${data}`);
      this.lastOutputAt = Date.now();
      // Strip ANSI escape codes pentru buffer curat
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b[()][A-B0-2]/g, '');
      for (const line of clean.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) {
          this.outputBuffer.push(trimmed);
          if (this.outputBuffer.length > AgentProcess.MAX_OUTPUT) this.outputBuffer.shift();
        }
      }
    });

    // Heartbeat la fiecare 60 secunde
    this.heartbeatTimer = setInterval(() => this.writeHeartbeat(), 60_000);
    setTimeout(() => this.writeHeartbeat(), 5000); // primul heartbeat dupa boot

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

  getOutput(): string[] {
    return [...this.outputBuffer];
  }

  // ── Cere agentului să își salveze memoria ────────────────────
  saveMemory(): void {
    if (!this.isAlive()) return;
    console.log(`[${this.name}] Salvez memoria...`);
    this.inject(buildSavePrompt(this.name, this.stateDir));
  }

  // ── Scrie heartbeat.json in state/<agent>/ ───────────────────
  private writeHeartbeat(): void {
    try {
      const agentStateDir = resolve(this.stateDir, this.name);
      mkdirSync(agentStateDir, { recursive: true });
      const uptimeSeconds = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
      const idleSeconds = this.lastOutputAt ? Math.floor((Date.now() - this.lastOutputAt) / 1000) : null;
      const lastLine = this.outputBuffer[this.outputBuffer.length - 1] || '';
      writeFileSync(join(agentStateDir, 'heartbeat.json'), JSON.stringify({
        agent: this.name,
        status: this._status,
        alive: this.isAlive(),
        uptimeSeconds,
        idleSeconds,
        lastActivity: this.lastOutputAt ? new Date(this.lastOutputAt).toISOString() : null,
        lastLine: lastLine.slice(0, 120),
        timestamp: new Date().toISOString(),
      }, null, 2), 'utf-8');
    } catch {}
  }

  // ── Genereaza raport de sesiune la inchidere ─────────────────
  saveSessionReport(): void {
    if (!this.isAlive()) return;
    const reportsDir = join(resolve(this.stateDir, this.name), 'reports');
    const date = new Date().toISOString().slice(0, 10);
    const reportPath = join(reportsDir, `${date}.md`);
    mkdirSync(reportsDir, { recursive: true });

    const prompt = `[SESSION CLOSE REPORT] Genereaza un raport de sesiune structurat si salveaza-l cu bash in: ${reportPath}

Formatul raportului:
# Raport sesiune — ${this.name} — ${date}

## Ce am facut
(lista taskuri completate cu rezultate)

## Decizii luate
(decizii importante din aceasta sesiune)

## In curs / blocat
(ce n-am terminat si de ce)

## Urmatoarea sesiune
(ce trebuie continuat sau prioritizat)

Salveaza cu:
\`\`\`bash
mkdir -p ${reportsDir}
cat > ${reportPath} << 'REPORT_EOF'
[continutul raportului]
REPORT_EOF
\`\`\``;

    console.log(`[${this.name}] Generez raport de sesiune...`);
    this.inject(prompt);
  }

  // ── Genereaza .claude/settings.json cu hooks inregistrate ───
  private generateHooksSettings(): void {
    const claudeDir = join(this.agentDir, '.claude');
    const settingsPath = join(claudeDir, 'settings.json');
    mkdirSync(claudeDir, { recursive: true });

    const agentStateDir = resolve(this.stateDir, this.name);
    const hooksDir = resolve(new URL('../../src/hooks', import.meta.url).pathname);
    // node cu --experimental-strip-types ruleaza direct TypeScript
    const nodeCmd = process.execPath;
    const hook = (name: string) =>
      `NC_AGENT_NAME=${this.name} NC_STATE_DIR=${agentStateDir} ${nodeCmd} --experimental-strip-types ${join(hooksDir, name)}`;

    const settings = {
      permissions: {
        allow: ['Bash', 'Read', 'Edit', 'Write', 'WebFetch', 'WebSearch'],
      },
      hooks: {
        PermissionRequest: [
          {
            matcher: 'ExitPlanMode',
            hooks: [{ type: 'command', command: hook('planmode-telegram.ts'), timeout: 1860 }],
          },
          {
            hooks: [{ type: 'command', command: hook('permission-telegram.ts'), timeout: 1860 }],
          },
        ],
        PreToolUse: [
          {
            matcher: 'AskUserQuestion',
            hooks: [{ type: 'command', command: hook('ask-telegram.ts'), timeout: 10 }],
          },
        ],
        SessionEnd: [
          {
            hooks: [{ type: 'command', command: hook('crash-alert.ts'), timeout: 10 }],
          },
        ],
        PreCompact: [
          {
            hooks: [{ type: 'command', command: hook('extract-facts.ts'), timeout: 15 }],
          },
        ],
        PostToolUse: [
          {
            matcher: 'TodoWrite|Task|Bash',
            hooks: [{ type: 'command', command: hook('idle-flag.ts'), timeout: 5 }],
          },
        ],
      },
    };

    // Merge cu settings.json existent daca are permisiuni custom
    let existing: any = {};
    if (existsSync(settingsPath)) {
      try { existing = JSON.parse(readFileSync(settingsPath, 'utf-8')); } catch {}
    }

    const merged = {
      ...existing,
      ...settings,
      permissions: {
        allow: [
          ...new Set([
            ...(existing.permissions?.allow || []),
            ...settings.permissions.allow,
          ]),
        ],
      },
    };

    writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`[${this.name}] Hooks inregistrate in .claude/settings.json`);
  }

  // ── Pornești Telegram + Cron ─────────────────────────────────
  private startServices(): void {
    const { BOT_TOKEN, CHAT_ID } = this.envVars;
    const agentStateDir = resolve(this.stateDir, this.name);

    if (BOT_TOKEN && CHAT_ID) {
      this.poller = new TelegramPoller(BOT_TOKEN, (text, chatId) => {
        console.log(`[${this.name}] Mesaj Telegram: "${text}"`);
        const prompt = this.buildTelegramPrompt(text, chatId);
        this.inject(prompt);
      }, agentStateDir);
      this.poller.start();

      // Mesaj de bun venit la fiecare boot al agentului
      sendTelegramMessage(BOT_TOKEN, CHAT_ID,
        `My HerOS — agentul "${this.name}" este activ si asteapta sarcini.`
      ).then(sent => {
        if (sent) console.log(`[${this.name}] Mesaj de bun venit trimis pe Telegram.`);
      });
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

    // ── Salvare periodică memorie la 30 de minute ────────────────
    const THIRTY_MIN = 30 * 60 * 1000;
    this.memoryTimer = setInterval(() => {
      if (this.isAlive()) this.saveMemory();
    }, THIRTY_MIN);

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

  // ── Oprești serviciile (Telegram + Cron + Bus + Memory + Heartbeat)
  private stopServices(): void {
    this.poller?.stop();
    this.poller = null;
    this.cron?.stop();
    this.cron = null;
    this.busInbox?.stop();
    this.busInbox = null;
    if (this.memoryTimer) { clearInterval(this.memoryTimer); this.memoryTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  // ── Construieste promptul pentru mesajele Telegram ───────────
  private buildTelegramPrompt(text: string, chatId: number): string {
    const { BOT_TOKEN, CHAT_ID } = this.envVars;
    const replyCmd = BOT_TOKEN && CHAT_ID
      ? `curl -s -X POST https://api.telegram.org/bot${BOT_TOKEN}/sendMessage -d chat_id=${chatId} -d text="<mesajul tau>"`
      : '';

    // Detectam comenzi skill: /brief, /plan, /status, /memory, /goals
    if (text.startsWith('/')) {
      const [cmd, ...args] = text.slice(1).split(' ');
      const arg = args.join(' ').trim();

      switch (cmd.toLowerCase()) {
        case 'brief':
          return `[SKILL /brief] Genereaza un briefing de status de maxim 20 randuri:
- Ce lucrezi acum
- Ce ai terminat recent
- Ce urmeaza
- Eventuale blocaje
Trimite pe Telegram via ${replyCmd}`;

        case 'plan':
          return `[SKILL /plan] ${arg ? `Task: "${arg}"` : 'Analizeaza task-ul curent'}.
Descompune in pasi concisi cu ordine si dependente. Trimite planul pe Telegram via ${replyCmd}`;

        case 'status':
          return `[SKILL /status] Trimite un status scurt (3-5 randuri) pe Telegram despre ce faci acum: ${replyCmd}`;

        case 'memory':
          return `[SKILL /memory] Rezuma ce stii din sesiunile anterioare (MEMORY.md). Trimite pe Telegram via ${replyCmd}`;

        case 'goals':
          return `[SKILL /goals] Citeste GOALS.md (daca exista) si trimite goalurile active pe Telegram via ${replyCmd}`;

        case 'help':
          return `[SKILL /help] Trimite pe Telegram lista de comenzi disponibile:
/brief - status complet
/plan [task] - descompune un task
/status - status scurt
/memory - ce stii din sesiunile anterioare
/goals - goalurile active
Foloseste: ${replyCmd}`;

        default:
          return `Comanda necunoscuta: /${cmd}. Trimite pe Telegram lista de comenzi via /help. ${replyCmd}`;
      }
    }

    // Mesaj normal
    return `Mesaj nou pe Telegram de la chat ${chatId}: "${text}"\nRaspunde via curl: ${replyCmd}`;
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
