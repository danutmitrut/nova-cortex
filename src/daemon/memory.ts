// ============================================================
// Agent Memory — persistență între sesiuni
// ============================================================
// Fiecare agent are un fișier state/<agent>/MEMORY.md.
// La boot: conținutul e injectat în system prompt.
// La shutdown sau la 30 min: agentul primește un prompt
//   care îi cere să scrie/actualizeze fișierul via bash.
//
// Agentul scrie singur memoria — Claude Code are acces
// la filesystem prin tool-ul Bash/Write.
// ============================================================

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Încarcă memoria dintr-o sesiune anterioară ────────────────
export function loadMemory(agentName: string, stateDir: string): string {
  const path = memoryPath(agentName, stateDir);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8').trim();
}

// ── Formatează memoria pentru injectare în system prompt ──────
export function formatMemoryForPrompt(memory: string): string {
  return [
    '## Memoria ta din sesiunile anterioare',
    '',
    memory,
    '',
    '---',
    'Aceasta este memoria ta persistentă. Continuă de unde ai rămas.',
  ].join('\n');
}

// ── Construiește promptul de salvare memorie ──────────────────
// Agentul primește acest text și îl execută scriind fișierul.
export function buildSavePrompt(agentName: string, stateDir: string): string {
  const path = memoryPath(agentName, stateDir);
  // Asigurăm că directorul există înainte ca agentul să scrie
  mkdirSync(join(stateDir, agentName), { recursive: true });

  return `[SISTEM — SALVARE MEMORIE]

Actualizează-ți memoria persistentă. Scrie în fișierul:
${path}

Structura pe care o urmezi:
# Memorie ${agentName} — ${new Date().toISOString().slice(0, 10)}

## Cine sunt
[rolul tău în sistem, 1-2 propoziții]

## Ce am făcut în această sesiune
[sarcini finalizate, rezultate importante]

## Decizii și observații
[orice e util de știut la next boot]

## În curs / urmează
[sarcini incomplete sau planificate]

Maxim 300 cuvinte. Scrie fișierul direct cu bash (cat > sau Write tool). Suprascrie tot.`;
}

export function memoryPath(agentName: string, stateDir: string): string {
  return join(stateDir, agentName, 'MEMORY.md');
}
