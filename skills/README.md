# Nova Cortex Skills

Scripturi reutilizabile pe care agenții le pot apela din Claude Code via bash.

## Utilizare

```bash
node --experimental-strip-types skills/<skill>.ts [argumente]
```

## Skills disponibile

### bus-send
Trimite un mesaj în inbox-ul unui agent.
```bash
node --experimental-strip-types skills/bus-send.ts researcher "Analizează tendințele AI din mai 2026"
# Output: {"ok":true,"id":"...","file":"..."}
```

### inbox-read
Citește mesajele neprocesate din inbox-ul unui agent.
```bash
node --experimental-strip-types skills/inbox-read.ts orchestrator
# Output: {"ok":true,"messages":[...],"count":2}
```

### agent-status
Returnează statusul tuturor agenților (via daemon sau heartbeats).
```bash
node --experimental-strip-types skills/agent-status.ts
# Output: {"ok":true,"agents":[{"name":"researcher","status":"running","alive":true},...]}
```

## Adaugă un skill nou

1. Creează `skills/<nume>.ts`
2. Adaugă intrarea în `community/catalog.json` secțiunea `skills`
3. Documentează în acest README
