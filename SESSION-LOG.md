# Session Log — My HerOS

---

## 2026-05-13 — Rebrand Nova Cortex → My HerOS

LUCRAT:
- Redenumit sistemul din "Nova Cortex" în "My HerOS"
- CLI command `nova` → `myheros` în toate fișierele
- `src/nova.ts` redenumit în `src/myheros.ts`
- `package.json`: name="my-heros", script "nova" → "myheros"
- IPC socket: `nova-cortex.sock` → `myheros.sock`
- launchd label: `com.novacortex.daemon` → `com.myheros.daemon`
- Windows task + VBS: `NovaCortex` → `MyHerOS`, `nova-daemon.vbs` → `myheros-daemon.vbs`
- `install.sh` + `install.ps1`: binary și URL-uri actualizate
- Repo GitHub redenumit `nova-cortex` → `my-heros` via `gh repo rename`
- Remote local actualizat la `https://github.com/danutmitrut/my-heros.git`
- 37 fișiere modificate, 242 înlocuiri

DECIZII:
- Rebranding complet la "My HerOS" cu CLI `myheros` (propus de user)
- Repo redenumit direct din terminal via GitHub CLI (nu manual în browser)
- Prefixele interne `NC_` păstrate (env vars interne, nu user-facing)

---

## 2026-05-12 — Onboarding, cron, skills, CLI complet

LUCRAT:
- `myheros setup` — wizard interactiv cross-platform (Node.js check, Claude CLI, agenți din template-uri, Telegram, autostart)
- `install.sh` + `install.ps1` — one-liner instalare Mac și Windows
- `myheros service install` Windows — Task Scheduler via schtasks + VBScript wrapper (fără consolă)
- `CronScheduler` — parsează 5-field cron + @aliases, fire via bus message, integrat în daemon
- Template orchestrator — briefing L-V 8:00 + raport 17:00, protocol bus documentat în CLAUDE.md
- Skills system: `bus-send.ts`, `inbox-read.ts`, `agent-status.ts` + README
- `myheros logs <agent>` — tail live output PTY via IPC poll 800ms
- `myheros report <agent>` — ultimul raport de sesiune din state/<agent>/reports/
- `myheros chat <agent>` — trimite bus message + tail output 60s
- `myheros knowledge list|show|add` — gestionare knowledge base
- Dashboard: panou heartbeat cu uptime/idle/lastLine + butoane enable/disable
- IPC: comanda `output` → lines[] pentru logs și chat
- `knowledge/system-overview.md` — document de pornire injectat via RAG

FIȘIERE MODIFICATE:
- `src/cli/commands.ts` — cmdLogs, cmdReport, cmdKnowledge, cmdChat, cmdEnable, cmdDisable, cmdHeartbeats, cmdCommunity, cmdImport
- `src/cli/setup.ts` — NOU: wizard onboarding
- `src/cli/service.ts` — Windows Task Scheduler support
- `src/cli/tunnel.ts` — NOU: cloudflared tunnel
- `src/daemon/cron-scheduler.ts` — NOU
- `src/daemon/agent-registry.ts` — NOU
- `src/daemon/daemon.ts` — CronScheduler, AgentRegistry, enable/disable, getHeartbeats
- `src/daemon/ipc.ts` — enable, disable, heartbeats, output
- `src/dashboard/server.ts` — /api/heartbeats, enable/disable actions
- `src/dashboard/index.html` — heartbeat panel, enable/disable buttons
- `src/myheros.ts` — toate comenzile noi wirate
- `community/catalog.json` — orchestrator + 3 skills
- `templates/orchestrator/` — NOU: 5 fișiere
- `skills/` — NOU: bus-send.ts, inbox-read.ts, agent-status.ts, README.md
- `knowledge/` — NOU: system-overview.md
- `install.sh`, `install.ps1` — NOU

DECIZII:
- Windows service via schtasks + VBScript (fără npm package extern)
- `myheros chat` face tail pe output agent, nu polling pe reply — mai simplu și util vizual
- CronScheduler scrie în bus (nu injectează direct în PTY) — arhitectură consistentă
- Knowledge base e deja implementat cu RAG în agent-process.ts — doar directoryl lipsea

DE FĂCUT:
- [ ] Verificat `myheros setup` end-to-end pe Mac real (cu daemon oprit)
- [ ] Verificat `install.ps1` pe Windows (cursant)
- [ ] Verificat `myheros logs` + `myheros chat` cu agent live
- [ ] Verificat Windows service (schtasks) — pornire la login, fără consolă neagră
- [ ] Testat CronScheduler — asteapta tick-ul de minut și verifica mesajul în inbox
- [ ] Verificat `myheros knowledge list` cu fișier în knowledge/
- [ ] `myheros report` — necesită shutdown agent ca să genereze raportul întâi
- [ ] Documentat instrucțiunile de instalare pentru cursanți (README.md)
- [ ] README.md actualizat cu toate comenzile noi și one-liner instalare

---
