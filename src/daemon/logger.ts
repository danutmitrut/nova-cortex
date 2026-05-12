// ============================================================
// Logger — ring buffer pentru ultimele 200 linii de log
// ============================================================
// Interceptează console.log la nivel de modul.
// Trebuie importat PRIMUL în src/index.ts pentru a captura
// tot output-ul daemonului, inclusiv din module importate ulterior.
// ============================================================

const MAX_LINES = 200;
const buffer: string[] = [];

const _origLog = console.log;
const _origError = console.error;

function capture(level: string, args: unknown[]): string {
  const text = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  return `${new Date().toISOString().slice(11, 19)} ${level} ${text}`;
}

console.log = (...args: unknown[]) => {
  const line = capture('INF', args);
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.shift();
  _origLog(...args);
};

console.error = (...args: unknown[]) => {
  const line = capture('ERR', args);
  buffer.push(line);
  if (buffer.length > MAX_LINES) buffer.shift();
  _origError(...args);
};

export function getRecentLogs(): string[] {
  return [...buffer];
}
