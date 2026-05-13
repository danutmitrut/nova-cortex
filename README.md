# My HerOS

Sistem multi-agent AI care rulează local pe Mac sau Windows.
Pornești mai mulți agenți Claude Code care colaborează între ei, primesc sarcini prin Telegram și se coordonează automat.

## Ce face

- Pornește automat la login — nu dai niciodată comenzi manuale
- Primești și trimiți mesaje prin Telegram
- Mai mulți agenți specializați colaborează prin bus
- Orchestratorul distribuie sarcinile automat
- Dashboard web la `localhost:4242`
- Agenții își amintesc ce au făcut la sesiunea anterioară

## Prerequisite

- **Node.js v20 sau mai nou** — [nodejs.org](https://nodejs.org)
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- **Cont Claude** cu acces la Claude Code (Pro $20/lună sau API)

Verificare rapidă:
```bash
node --version   # trebuie v20+
claude --version # trebuie să existe
```

## Instalare

```bash
git clone https://github.com/danutmitrut/my-heros
cd my-heros
npm install
npm run setup
```

Wizardul `npm run setup` te ghidează prin:
1. Verificare prerequisite
2. Creare agent personalizat
3. Configurare Telegram (opțional)
4. Instalare serviciu de fundal (pornire automată la login)

La final deschizi `http://localhost:4242` și sistemul e activ.

## Structura agenților

My HerOS vine cu trei agenți predefiniti:

| Agent | Rol |
|-------|-----|
| `orchestrator` | Primește sarcini și le distribuie celorlalți |
| `analyst` | Cercetare, analiză, rapoarte |
| `demo` | Sarcini generale |

Adaugi agenți proprii în `agents/<nume>/` cu trei fișiere:
- `config.json` — nume, startup prompt, cron jobs
- `CLAUDE.md` — instrucțiuni de comportament (încărcat automat de Claude Code)
- `IDENTITY.md` — identitate și instrucțiuni operaționale

## Comenzi CLI

```bash
npm run myheros -- status                          # statusul tuturor agenților
npm run myheros -- doctor                          # diagnostic complet
npm run myheros -- bus orchestrator "sarcina ta"   # trimite mesaj unui agent
npm run myheros -- start analyst                   # pornește un agent oprit
npm run myheros -- stop demo                       # oprește un agent
npm run myheros -- service install                 # instalează pornire automată (macOS)
npm run myheros -- service uninstall               # dezinstalează serviciul
```

## Dashboard

Deschide `http://localhost:4242` când daemonul rulează.

- **Agenți** — status live, butoane Start/Stop per agent
- **Trimite mesaj bus** — selectezi agentul, scrii sarcina, Ctrl+Enter
- **Log daemon** — tot output-ul sistemului în timp real

## Configurare Telegram

Fiecare agent poate fi controlat prin Telegram. Creezi un bot separat per agent:

1. Deschide [@BotFather](https://t.me/BotFather) în Telegram
2. Trimite `/newbot` și urmează instrucțiunile
3. Copiază token-ul primit
4. Creează fișierul `agents/<agent>/.env`:

```
BOT_TOKEN=123456789:ABC-DEF...
CHAT_ID=<id-ul tău de chat>
```

Pentru CHAT_ID: deschide botul, trimite `/start`, accesează `https://api.telegram.org/bot<TOKEN>/getUpdates` și găsește `"chat":{"id":<număr>}`.

Repornești daemonul și agentul îți trimite automat un mesaj de confirmare.

## Cron jobs

Agenții pot executa sarcini automate la ore fixe. Adaugi în `config.json`:

```json
{
  "name": "analyst",
  "startup_prompt": "Analyst activ.",
  "crons": [
    {
      "expression": "0 8 * * *",
      "prompt": "Trimite un briefing cu noutățile AI din ultimele 24h.",
      "label": "Briefing dimineață"
    }
  ]
}
```

Expresiile cron: `minut oră zi-lună lună zi-săptămână`

## Knowledge base (RAG)

Pui fișiere `.md` în directorul `knowledge/` și agenții primesc automat context relevant la boot:

```
knowledge/
  ai-trends-2025.md
  compania-mea.md
  proceduri.md
```

## Memoria agenților

Agenții salvează automat ce au făcut la fiecare oprire în `state/<agent>/MEMORY.md`. La pornirea următoare memoria e injectată în system prompt — agentul știe ce a făcut data trecută.

## Structura proiectului

```
my-heros/
├── agents/          # un director per agent
│   ├── orchestrator/
│   ├── analyst/
│   └── demo/
├── knowledge/       # knowledge base (fișiere .md)
├── src/
│   ├── daemon/      # lifecycle agenți, watchdog, IPC, memorie
│   ├── bus/         # comunicare inter-agent
│   ├── cron/        # scheduler cron jobs
│   ├── telegram/    # poller Telegram
│   ├── rag/         # căutare în knowledge base
│   ├── security/    # scanner pre-boot
│   ├── dashboard/   # server HTTP + UI
│   ├── cli/         # comenzi myheros
│   └── onboarding/  # wizard npm run setup
├── state/           # stare persistentă (crons, memorie)
└── bus/             # mesaje inter-agent (runtime)
```

## Depanare

```bash
npm run myheros -- doctor   # verifică tot: Node, Claude, daemon, Telegram, launchd
```

Erori frecvente:

**`claude: command not found`** — reinstalează: `npm install -g @anthropic-ai/claude-code`

**Agenții nu pornesc** — verifică autentificarea: `claude --version`

**Telegram nu funcționează** — verifică că `agents/<agent>/.env` există cu `BOT_TOKEN` și `CHAT_ID` valide

**Dashboard gol** — daemonul nu rulează; dacă ai serviciul instalat: `npm run myheros -- service status`
