// ============================================================
// Comenzi CLI Nova Cortex
// ============================================================
// status  — listează toți agenții și statusul lor
// start   — pornește un agent specific
// stop    — oprește un agent specific
// bus     — trimite un mesaj prin bus la un agent
// ============================================================

import { sendCommand } from './client.ts';
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, cpSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { spawnSync } from 'child_process';
import { homedir, platform } from 'os';

type AgentStatus = { name: string; status: string; alive: boolean };

// ── nova status ───────────────────────────────────────────────
export async function cmdStatus(): Promise<void> {
  const response = await sendCommand({ command: 'status' }) as { ok: boolean; agents: AgentStatus[] };

  if (!response.agents?.length) {
    console.log('Nova Cortex — niciun agent activ.');
    return;
  }

  console.log('\nNova Cortex — Agenți activi:\n');
  console.log('  AGENT          STATUS       ALIVE');
  console.log('  ─────────────────────────────────');

  for (const agent of response.agents) {
    const alive = agent.alive ? '✓' : '✗';
    const name = agent.name.padEnd(14);
    const status = agent.status.padEnd(12);
    console.log(`  ${name} ${status} ${alive}`);
  }

  console.log();
}

// ── nova start <agent> ────────────────────────────────────────
export async function cmdStart(name: string): Promise<void> {
  if (!name) {
    console.error('Utilizare: nova start <nume-agent>');
    process.exit(1);
  }

  const response = await sendCommand({ command: 'start', agent: name }) as { ok: boolean; error?: string };

  if (response.ok) {
    console.log(`Agent "${name}" pornit.`);
  } else {
    console.error(`Eroare: ${response.error ?? 'Agent necunoscut'}`);
    process.exit(1);
  }
}

// ── nova stop <agent> ─────────────────────────────────────────
export async function cmdStop(name: string): Promise<void> {
  if (!name) {
    console.error('Utilizare: nova stop <nume-agent>');
    process.exit(1);
  }

  const response = await sendCommand({ command: 'stop', agent: name }) as { ok: boolean; error?: string };

  if (response.ok) {
    console.log(`Agent "${name}" oprit.`);
  } else {
    console.error(`Eroare: ${response.error ?? 'Agent necunoscut'}`);
    process.exit(1);
  }
}

// ── nova bus <agent> <mesaj> ──────────────────────────────────
export async function cmdBus(to: string, content: string): Promise<void> {
  if (!to || !content) {
    console.error('Utilizare: nova bus <agent> "<mesaj>"');
    process.exit(1);
  }

  const busDir = resolve('./bus');
  const inboxDir = join(busDir, to, 'inbox');

  if (!existsSync(join(busDir, to))) {
    console.error(`Agentul "${to}" nu are inbox. Rulează daemonul mai întâi.`);
    process.exit(1);
  }

  mkdirSync(inboxDir, { recursive: true });

  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const filename = `${timestamp.replace(/[:.]/g, '-').slice(0, 19)}-${id}.json`;

  const message = {
    id,
    from: 'cli',
    to,
    content,
    timestamp,
    requiresAck: false,
  };

  writeFileSync(join(inboxDir, filename), JSON.stringify(message, null, 2));
  console.log(`Mesaj trimis la "${to}" (id: ${id.slice(0, 8)}...)`);
}

// ── nova doctor ───────────────────────────────────────────────
export async function cmdDoctor(): Promise<void> {
  const ok  = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  const err = (msg: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  const warn= (msg: string) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

  console.log('\nNova Cortex — Diagnostic\n');

  // Node.js
  const major = parseInt(process.version.slice(1));
  major >= 20 ? ok(`Node.js ${process.version}`) : err(`Node.js ${process.version} — necesită v20+`);

  // Claude CLI
  const claudePath = spawnSync(platform() === 'win32' ? 'where' : 'which', ['claude'], {
    stdio: 'pipe',
    env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` },
  });
  claudePath.status === 0
    ? ok(`Claude CLI: ${claudePath.stdout.toString().trim()}`)
    : err('Claude CLI neinstalat — npm install -g @anthropic-ai/claude-code');

  // Daemon (IPC)
  let daemonOk = false;
  let agentList: AgentStatus[] = [];
  try {
    const r = await sendCommand({ command: 'status' }) as { agents: AgentStatus[] };
    agentList = r.agents ?? [];
    daemonOk = true;
    ok(`Daemon: rulează (${agentList.length} agent/i)`);
  } catch {
    err('Daemon: oprit — rulează "npm run dev" sau "nova service install"');
  }

  // Agenți
  if (daemonOk) {
    for (const a of agentList) {
      a.alive ? ok(`Agent "${a.name}": ${a.status}`) : warn(`Agent "${a.name}": ${a.status}`);
    }
  }

  // Telegram per agent
  const agentsDir = resolve('./agents');
  if (existsSync(agentsDir)) {
    const dirs = readdirSync(agentsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const d of dirs) {
      const envPath = join(agentsDir, d.name, '.env');
      existsSync(envPath)
        ? ok(`Telegram "${d.name}": .env configurat`)
        : warn(`Telegram "${d.name}": .env absent`);
    }
  }

  // Dashboard
  try {
    const r = await fetch('http://localhost:4242/api/status', { signal: AbortSignal.timeout(1000) });
    r.ok ? ok('Dashboard: http://localhost:4242') : warn('Dashboard: răspuns neașteptat');
  } catch {
    warn('Dashboard: offline (pornește daemonul)');
  }

  // Serviciu launchd
  if (platform() === 'darwin') {
    const plist = join(homedir(), 'Library', 'LaunchAgents', 'com.novacortex.daemon.plist');
    existsSync(plist)
      ? ok('Serviciu launchd: instalat (pornire automată la login)')
      : warn('Serviciu launchd: neinstalat — rulează "nova service install"');
  }

  console.log();
}

// ── nova help ─────────────────────────────────────────────────
// ── nova enable / nova disable ────────────────────────────────
export async function cmdEnable(name: string): Promise<void> {
  if (!name) { console.error('Utilizare: nova enable <agent>'); process.exit(1); }
  try {
    const r = await sendCommand({ command: 'enable', agent: name }) as { ok: boolean; error?: string };
    if (r.ok) console.log(`Agent "${name}" activat.`);
    else console.error(`Eroare: ${r.error || 'necunoscuta'}`);
  } catch {
    // Daemon offline — modifica direct registry-ul
    const { AgentRegistry } = await import('../daemon/agent-registry.ts');
    const reg = new AgentRegistry(resolve('state'));
    reg.enable(name);
    console.log(`Agent "${name}" activat in registry. Reporneste daemonul.`);
  }
}

export async function cmdDisable(name: string): Promise<void> {
  if (!name) { console.error('Utilizare: nova disable <agent>'); process.exit(1); }
  try {
    const r = await sendCommand({ command: 'disable', agent: name }) as { ok: boolean; error?: string };
    if (r.ok) console.log(`Agent "${name}" dezactivat.`);
    else console.error(`Eroare: ${r.error || 'necunoscuta'}`);
  } catch {
    const { AgentRegistry } = await import('../daemon/agent-registry.ts');
    const reg = new AgentRegistry(resolve('state'));
    reg.disable(name);
    console.log(`Agent "${name}" dezactivat in registry. Reporneste daemonul.`);
  }
}

// ── nova heartbeats ───────────────────────────────────────────
export async function cmdHeartbeats(): Promise<void> {
  try {
    const r = await sendCommand({ command: 'heartbeats' }) as { ok: boolean; heartbeats: any[] };
    if (!r.heartbeats?.length) { console.log('Niciun heartbeat disponibil.'); return; }
    console.log('\nHeartbeats agenți:\n');
    console.log('  AGENT          STATUS     UPTIME     IDLE LAST');
    console.log('  ─────────────────────────────────────────────────────────');
    for (const h of r.heartbeats) {
      const uptime = h.uptimeSeconds ? `${Math.floor(h.uptimeSeconds / 60)}m` : '-';
      const idle = h.idleSeconds != null ? `${Math.floor(h.idleSeconds / 60)}m` : '-';
      const last = (h.lastLine || '').slice(0, 35);
      console.log(`  ${h.agent.padEnd(14)} ${(h.status || '').padEnd(10)} ${uptime.padEnd(10)} ${idle.padEnd(5)} ${last}`);
    }
    console.log('');
  } catch {
    console.error('Daemonul nu ruleaza.');
  }
}

// ── nova community ────────────────────────────────────────────
export function cmdCommunity(): void {
  const catalogPath = join(resolve(''), 'community', 'catalog.json');
  if (!existsSync(catalogPath)) {
    console.log('catalog.json nu exista in community/. Ruleaza nova list-templates pentru template-uri locale.');
    return;
  }
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
    const agents: any[] = catalog.agents || [];
    const skills: any[] = catalog.skills || [];

    if (agents.length) {
      console.log('\nAgenți community:\n');
      for (const a of agents) {
        console.log(`  ${a.name.padEnd(15)} ${a.description || ''}`);
        if (a.source) console.log(`  ${''.padEnd(15)} sursa: ${a.source}`);
      }
    }
    if (skills.length) {
      console.log('\nSkills community:\n');
      for (const s of skills) {
        console.log(`  ${s.name.padEnd(15)} ${s.description || ''}`);
      }
    }
    if (!agents.length && !skills.length) console.log('Catalogul e gol.');
    console.log('\nImporta un agent: nova import <name>\n');
  } catch {
    console.error('Eroare la citirea catalog.json.');
  }
}

// ── nova import <name> ────────────────────────────────────────
export function cmdImport(name: string): void {
  if (!name) { console.error('Utilizare: nova import <name>'); process.exit(1); }

  // Cauta in templates locale
  const templateDir = join(resolve(''), 'templates', name);
  if (existsSync(templateDir)) {
    cmdAddAgent(name, name);
    return;
  }

  // Cauta in community/agents/
  const communityAgentDir = join(resolve(''), 'community', 'agents', name);
  if (existsSync(communityAgentDir)) {
    const agentDir = join(resolve(''), 'agents', name);
    if (existsSync(agentDir)) {
      console.error(`Agentul "${name}" exista deja in agents/.`);
      process.exit(1);
    }
    cpSync(communityAgentDir, agentDir, { recursive: true });
    console.log(`Agent "${name}" importat din community.`);
    return;
  }

  console.error(`"${name}" negasit in templates/ sau community/agents/. Ruleaza nova list-templates sau nova community.`);
  process.exit(1);
}

// ── nova list-templates ───────────────────────────────────────
export function cmdListTemplates(): void {
  const templatesDir = join(resolve(''), 'templates');
  if (!existsSync(templatesDir)) {
    console.log('Directorul templates/ nu exista.');
    return;
  }
  const templates = readdirSync(templatesDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      try {
        const cfg = JSON.parse(readFileSync(join(templatesDir, e.name, 'config.json'), 'utf-8'));
        return { name: e.name, prompt: cfg.startup_prompt?.slice(0, 60) || '' };
      } catch { return { name: e.name, prompt: '(config lipsa)' }; }
    });

  if (!templates.length) { console.log('Niciun template disponibil.'); return; }
  console.log('\nTemplates disponibile:\n');
  for (const t of templates) {
    console.log(`  ${t.name.padEnd(15)} ${t.prompt}`);
  }
  console.log('\nFoloseste: nova add-agent <nume> --template <template>\n');
}

// ── nova add-agent <name> [--template <template>] ─────────────
export function cmdAddAgent(name: string, templateName?: string): void {
  if (!name) { console.error('Utilizare: nova add-agent <nume> [--template <template>]'); process.exit(1); }

  const safeName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  const agentsDir = join(resolve(''), 'agents');
  const agentDir = join(agentsDir, safeName);

  if (existsSync(agentDir)) {
    console.error(`Agentul "${safeName}" exista deja.`);
    process.exit(1);
  }

  if (templateName) {
    // Copie din template
    const templateDir = join(resolve(''), 'templates', templateName);
    if (!existsSync(templateDir)) {
      console.error(`Template "${templateName}" negasit. Ruleaza "nova list-templates" pentru lista.`);
      process.exit(1);
    }

    cpSync(templateDir, agentDir, { recursive: true });

    // Redenumeste agentul in config.json
    const cfgPath = join(agentDir, 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    cfg.name = safeName;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');

    console.log(`\nAgent "${safeName}" creat din template "${templateName}".`);
    console.log(`Directorul: agents/${safeName}/`);
    console.log(`Editeaza agents/${safeName}/GOALS.md pentru a personaliza obiectivele.\n`);
  } else {
    // Agent gol
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, 'config.json'), JSON.stringify({
      name: safeName,
      startup_prompt: `${safeName} activ.`,
      crons: [],
    }, null, 2), 'utf-8');
    writeFileSync(join(agentDir, 'IDENTITY.md'), `# Identitate — ${safeName}\n\nNumele tau este **${safeName}**.\n\n## La pornire\nConfirma: "${safeName} activ."\n`);
    writeFileSync(join(agentDir, 'GOALS.md'), `# Goaluri — ${safeName}\n\n## Obiectiv principal\n(descrie rolul agentului)\n\n## Taskuri in curs\n- [ ] (asteapta sarcini)\n`);
    writeFileSync(join(agentDir, 'GUARDRAILS.md'), `# Guardrails — ${safeName}\n\n## Nu face niciodata\n- (adauga restrictii)\n\n## Intotdeauna\n- Confirma inainte de actiuni ireversibile\n`);
    writeFileSync(join(agentDir, 'CLAUDE.md'), `# Agent: ${safeName}\n\nEsti un agent AI numit **${safeName}**.\n`);

    console.log(`\nAgent "${safeName}" creat in agents/${safeName}/`);
    console.log(`Editeaza fisierele generate si reporneste daemonul.\n`);
  }
}

// ── nova logs <agent> ─────────────────────────────────────────
export async function cmdLogs(name: string): Promise<void> {
  if (!name) { console.error('Utilizare: nova logs <agent>'); process.exit(1); }

  const initial = await sendCommand({ command: 'output', agent: name }) as { ok: boolean; lines?: string[]; error?: string };
  if (!initial.ok) { console.error(`Eroare: ${initial.error ?? 'Agent necunoscut'}`); process.exit(1); }

  const lines = initial.lines ?? [];
  for (const line of lines) process.stdout.write(line + '\n');
  let lastCount = lines.length;

  process.stderr.write(`\n\x1b[2m[nova logs] "${name}" — Ctrl+C pentru a ieși\x1b[0m\n\n`);

  const timer = setInterval(async () => {
    try {
      const r = await sendCommand({ command: 'output', agent: name }) as { ok: boolean; lines?: string[] };
      if (!r.ok) return;
      const next = r.lines ?? [];
      for (let i = lastCount; i < next.length; i++) process.stdout.write(next[i] + '\n');
      lastCount = next.length;
    } catch {}
  }, 800);

  process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
  // Ținut viu — clearInterval e singurul exit
  await new Promise(() => {});
}

// ── nova report <agent> ───────────────────────────────────────
export function cmdReport(name: string): void {
  if (!name) { console.error('Utilizare: nova report <agent>'); process.exit(1); }

  const reportsDir = resolve('./state', name, 'reports');
  if (!existsSync(reportsDir)) {
    console.log(`Niciun raport pentru "${name}". Rapoartele sunt generate la shutdown.`);
    return;
  }

  const files = readdirSync(reportsDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();

  if (!files.length) { console.log('Niciun raport disponibil.'); return; }

  const [latest, ...rest] = files;
  const content = readFileSync(join(reportsDir, latest), 'utf-8');

  console.log(`\n\x1b[32m=== Raport: ${name} — ${latest.replace('.md', '')} ===\x1b[0m\n`);
  console.log(content);

  if (rest.length) {
    console.log(`\x1b[2m(${rest.length} raport/e anterioare în state/${name}/reports/)\x1b[0m\n`);
  }
}

// ── nova knowledge list|show|add ──────────────────────────────
export function cmdKnowledge(sub: string, arg?: string): void {
  const knowledgeDir = resolve('./knowledge');

  switch (sub) {
    case 'list': {
      if (!existsSync(knowledgeDir)) { console.log('Directorul knowledge/ nu există.'); return; }
      const files = readdirSync(knowledgeDir).filter(f => /\.(md|txt|json)$/.test(f));
      if (!files.length) { console.log('Knowledge base gol.'); return; }
      console.log('\nKnowledge base:\n');
      for (const f of files) {
        const kb = Math.round(statSync(join(knowledgeDir, f)).size / 102.4) / 10;
        console.log(`  ${f.padEnd(32)} ${kb}kb`);
      }
      console.log('\nFolosește: nova knowledge show <fișier>\n');
      break;
    }
    case 'show': {
      if (!arg) { console.error('Utilizare: nova knowledge show <fișier>'); process.exit(1); }
      const p = join(knowledgeDir, arg);
      if (!existsSync(p)) { console.error(`"${arg}" nu există în knowledge/.`); process.exit(1); }
      console.log(readFileSync(p, 'utf-8'));
      break;
    }
    case 'add': {
      if (!arg) { console.error('Utilizare: nova knowledge add <titlu>'); process.exit(1); }
      mkdirSync(knowledgeDir, { recursive: true });
      const filename = arg.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') + '.md';
      const p = join(knowledgeDir, filename);
      if (existsSync(p)) { console.error(`"${filename}" există deja.`); process.exit(1); }
      writeFileSync(p, `# ${arg}\n\n(Adaugă conținut aici)\n`, 'utf-8');
      console.log(`Creat: knowledge/${filename}`);
      console.log(`Editează cu: $EDITOR knowledge/${filename}`);
      break;
    }
    default:
      console.error('Utilizare: nova knowledge list|show <fișier>|add <titlu>');
      process.exit(1);
  }
}

// ── nova chat <agent> <mesaj> ─────────────────────────────────
// Trimite mesaj și urmărește output-ul agentului live (60s)
export async function cmdChat(name: string, message: string): Promise<void> {
  if (!name || !message) {
    console.error('Utilizare: nova chat <agent> "<mesaj>"');
    process.exit(1);
  }

  const busDir = resolve('./bus');
  const inboxDir = join(busDir, name, 'inbox');

  if (!existsSync(join(busDir, name))) {
    console.error(`Agentul "${name}" nu are inbox. Daemonul rulează?`);
    process.exit(1);
  }

  mkdirSync(inboxDir, { recursive: true });

  const id = randomUUID();
  const ts = new Date().toISOString();
  const filename = `${ts.replace(/[:.]/g, '-').slice(0, 19)}-${id}.json`;

  writeFileSync(join(inboxDir, filename), JSON.stringify({
    id, from: 'cli-chat', to: name, content: message, timestamp: ts, requiresAck: false,
  }, null, 2));

  console.log(`\x1b[32m→ Mesaj trimis la "${name}"\x1b[0m`);
  console.log(`\x1b[2m[nova chat] Output live (60s). Ctrl+C pentru a ieși.\x1b[0m\n`);

  // Tail output agentului pentru 60s după trimitere
  const initial = await sendCommand({ command: 'output', agent: name }) as { ok: boolean; lines?: string[] };
  let lastCount = (initial.lines ?? []).length;
  let idleSeconds = 0;
  const IDLE_TIMEOUT = 60;

  const timer = setInterval(async () => {
    try {
      const r = await sendCommand({ command: 'output', agent: name }) as { ok: boolean; lines?: string[] };
      if (!r.ok) return;
      const next = r.lines ?? [];
      if (next.length > lastCount) {
        for (let i = lastCount; i < next.length; i++) process.stdout.write(next[i] + '\n');
        lastCount = next.length;
        idleSeconds = 0;
      } else {
        idleSeconds++;
        if (idleSeconds >= IDLE_TIMEOUT) {
          clearInterval(timer);
          process.stderr.write(`\n\x1b[2m[nova chat] 60s fără output nou. Ieșire.\x1b[0m\n`);
          process.exit(0);
        }
      }
    } catch {}
  }, 1000);

  process.on('SIGINT', () => { clearInterval(timer); process.exit(0); });
  await new Promise(() => {});
}

export function cmdHelp(): void {
  console.log(`
Nova Cortex CLI

COMENZI:
  nova status                         Listeaza toti agentii si statusul
  nova start <agent>                  Porneste un agent
  nova stop <agent>                   Opreste un agent
  nova enable <agent>                 Activeaza un agent (persistent)
  nova disable <agent>                Dezactiveaza un agent (persistent)
  nova heartbeats                     Afiseaza heartbeat-urile tuturor agentilor
  nova logs <agent>                   Urmareste output-ul live al unui agent
  nova report <agent>                 Afiseaza ultimul raport de sesiune
  nova chat <agent> <msg>             Trimite mesaj si urmareste raspunsul live
  nova knowledge list                 Listeaza fisierele din knowledge base
  nova knowledge show <fisier>        Afiseaza continutul unui fisier
  nova knowledge add <titlu>          Creeaza un fisier nou in knowledge base
  nova bus <agent> <msg>              Trimite un mesaj prin bus
  nova doctor                         Diagnostic complet al sistemului
  nova add-agent <name>               Creeaza un agent nou (gol)
  nova add-agent <name> --template T  Creeaza din template (cto/researcher/writer/monitor)
  nova list-templates                 Listeaza templatele disponibile
  nova community                      Afiseaza catalogul de agenti community
  nova import <name>                  Importa un agent din templates sau community
  nova tunnel start                   Porneste tunel cloudflared (acces remote)
  nova tunnel stop                    Opreste tunelul
  nova tunnel status                  Statusul tunelului + URL public
  nova tunnel url                     Afiseaza URL-ul public curent
  nova service install                Instaleaza serviciu launchd (macOS)
  nova service uninstall              Dezinstaleaza serviciul
  nova service status                 Statusul serviciului

EXEMPLE:
  nova status
  nova enable researcher
  nova heartbeats
  nova add-agent myagent --template researcher
  nova import cto
  nova tunnel start
  nova bus orchestrator "Analizeaza tendintele AI din 2025"
`);
}
