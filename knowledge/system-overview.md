# My HerOS — Prezentare generală a sistemului

## Ce este My HerOS
My HerOS este o platformă de orchestrare multi-agent bazată pe Claude Code.
Fiecare agent rulează ca un proces Claude Code independent, coordonat de un daemon central.

## Arhitectura sistemului

```
┌─────────────────────────────────────────────┐
│                  Daemon                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Agent 1 │  │  Agent 2 │  │  Agent N │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       └──────────────┴──────────────┘        │
│                    BUS                       │
└─────────────────────────────────────────────┘
         │                    │
    Dashboard              Telegram
   (port 4242)           (hooks IPC)
```

## Comunicare între agenți (Bus)

Mesajele se transmit prin fișiere JSON în `bus/<agent>/inbox/`:
- Inbox: `bus/<agent>/inbox/*.json` — mesaje de procesat
- Processed: `bus/<agent>/processed/*.json` — mesaje procesate

Format mesaj:
```json
{
  "id": "<uuid>",
  "from": "<agent-sursa>",
  "to": "<agent-destinatar>",
  "content": "<instructiunea>",
  "timestamp": "<ISO 8601>"
}
```

## Agenți activi

- **orchestrator** — coordonator central, distribuie sarcini
- **researcher** — cercetare și analiză
- **writer** — redactare conținut
- **monitor** — health checks sistem
- **cto** — decizii tehnice

## Skills disponibile

```bash
node --experimental-strip-types skills/bus-send.ts <agent> "<mesaj>"
node --experimental-strip-types skills/inbox-read.ts <agent>
node --experimental-strip-types skills/agent-status.ts
```

## Dashboard

Disponibil la http://localhost:4242 (necesită token din consolă).
Acces remote: `myheros tunnel start`
