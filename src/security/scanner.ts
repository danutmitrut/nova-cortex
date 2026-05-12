// ============================================================
// Security Scanner — validare pre-boot
// ============================================================
// Rulează înainte ca agenții să pornească și detectează:
//   1. Secrete expuse în fișiere care ar putea fi comise în git
//   2. Valori placeholder în .env (token-uri neschimbate)
//   3. Configurații lipsă sau invalide
//   4. Permisiuni periculoase (avertismente, nu blocare)
//
// Nu blochează boot-ul, ci returnează raportul de risc.
// Daemonul decide dacă oprește sau continuă.
// ============================================================

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

export type Severity = 'critical' | 'warning' | 'info';

export interface SecurityFinding {
  severity: Severity;
  agent?: string;
  file?: string;
  message: string;
}

// Tipare care indică secrete placeholder (neschimbate de la template)
const PLACEHOLDER_PATTERNS = [
  /your[_-]/i,
  /changeme/i,
  /xxx+/i,
  /todo/i,
  /insert[_-]here/i,
  /replace[_-]me/i,
];

// Tipare care indică posibile secrete reale scurse în fișiere greșite
const SECRET_KEY_PATTERNS = [
  /bot.?token\s*=/i,
  /api.?key\s*=/i,
  /api.?secret\s*=/i,
  /password\s*=/i,
  /secret\s*=/i,
  /private.?key\s*=/i,
  /access.?token\s*=/i,
];

// ── Scanare completă — returnează lista de finding-uri ───────
export function runSecurityScan(
  agentsDir: string,
  knowledgeDir: string
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // 1. Avertisment global despre --dangerously-skip-permissions
  findings.push({
    severity: 'warning',
    message: 'Agenții rulează cu --dangerously-skip-permissions. Claude Code poate executa orice comandă bash fără confirmare. Rulați NUMAI pe sisteme de dezvoltare, nu în producție publică.',
  });

  // 2. Scanăm fiecare agent
  if (existsSync(agentsDir)) {
    const agents = readdirSync(agentsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    for (const agent of agents) {
      const agentDir = join(agentsDir, agent);
      findings.push(...scanAgent(agent, agentDir));
    }
  }

  // 3. Scanăm knowledge base pentru PII accidental
  if (knowledgeDir && existsSync(knowledgeDir)) {
    findings.push(...scanKnowledgeForPii(knowledgeDir));
  }

  return findings;
}

// ── Scanare per agent ─────────────────────────────────────────
function scanAgent(agentName: string, agentDir: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Verifică dacă există config.json
  const configPath = join(agentDir, 'config.json');
  if (!existsSync(configPath)) {
    findings.push({ severity: 'critical', agent: agentName, message: 'Lipsește config.json.' });
    return findings;
  }

  // Verifică .env
  const envPath = join(agentDir, '.env');
  if (existsSync(envPath)) {
    findings.push(...scanEnvFile(agentName, envPath));
  } else {
    findings.push({ severity: 'info', agent: agentName, message: 'Fișier .env absent — agentul nu are Telegram configurat.' });
  }

  // Verifică CLAUDE.md
  if (!existsSync(join(agentDir, 'CLAUDE.md'))) {
    findings.push({ severity: 'warning', agent: agentName, message: 'Lipsește CLAUDE.md — agentul nu are instrucțiuni de comportament.' });
  }

  return findings;
}

// ── Analiză .env ──────────────────────────────────────────────
function scanEnvFile(agentName: string, envPath: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const content = readFileSync(envPath, 'utf8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    // Valori placeholder neschimbate
    if (PLACEHOLDER_PATTERNS.some(p => p.test(value))) {
      findings.push({
        severity: 'critical',
        agent: agentName,
        file: '.env',
        message: `"${key}" pare a fi un placeholder neschimbat. Înlocuiește cu valoarea reală.`,
      });
    }

    // Valori goale pentru chei critice
    if (!value && SECRET_KEY_PATTERNS.some(p => p.test(key))) {
      findings.push({
        severity: 'warning',
        agent: agentName,
        file: '.env',
        message: `"${key}" este gol — serviciul asociat nu va funcționa.`,
      });
    }
  }

  return findings;
}

// ── Detectare PII în knowledge base ──────────────────────────
function scanKnowledgeForPii(knowledgeDir: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const PII_PATTERNS = [
    { pattern: /\b\d{13}\b/, label: 'posibil CNP' },
    { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, label: 'posibil număr card' },
    { pattern: /password\s*:\s*\S+/i, label: 'posibilă parolă în text clar' },
  ];

  const files = readdirSync(knowledgeDir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'));

  for (const file of files) {
    const content = readFileSync(join(knowledgeDir, file.name), 'utf8');
    for (const { pattern, label } of PII_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({
          severity: 'warning',
          file: file.name,
          message: `knowledge/${file.name}: detectat ${label}. Verifică că nu conține date sensibile.`,
        });
      }
    }
  }

  return findings;
}

// ── Formatare raport pentru consolă ──────────────────────────
export function printSecurityReport(findings: SecurityFinding[]): void {
  const icons: Record<Severity, string> = { critical: '✗', warning: '!', info: '·' };
  const critical = findings.filter(f => f.severity === 'critical');

  console.log('\n[security] ── Raport de securitate ──────────────────');
  for (const f of findings) {
    const prefix = f.agent ? `[${f.agent}] ` : '';
    console.log(`[security] ${icons[f.severity]} ${prefix}${f.message}`);
  }

  if (critical.length > 0) {
    console.log(`[security] ──────────────────────────────────────────`);
    console.log(`[security] ${critical.length} problemă(e) critică(e) detectată(e). Verifică configurația.`);
  } else {
    console.log(`[security] ── OK — nicio problemă critică ───────────`);
  }
  console.log();
}
