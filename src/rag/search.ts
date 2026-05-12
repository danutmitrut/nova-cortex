// ============================================================
// RAG Lite — căutare în knowledge base fără vector DB
// ============================================================
// "RAG" (Retrieval-Augmented Generation) înseamnă că înainte
// să răspundă, AI-ul primește context relevant din documente.
//
// Versiunea "lite" de față nu folosește embeddings sau baze
// de date vectoriale — în schimb face keyword scoring:
//   1. Tokenizează query-ul (cuvinte unice, lowercase)
//   2. Sparge fiecare document în chunk-uri (paragrafe)
//   3. Scorează fiecare chunk: câte token-uri din query apar?
//   4. Returnează top N chunk-uri
//
// Limitare vs RAG real: nu înțelege sinonime sau semantică.
// Avantaj: zero dependențe, funcționează instant, explicabil.
// ============================================================

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface RagChunk {
  source: string;   // numele fișierului
  content: string;  // textul chunk-ului
  score: number;    // relevanță față de query
}

// ── Caută în knowledge base și returnează top N chunk-uri ────
export function ragSearch(
  query: string,
  knowledgeDir: string,
  topN: number = 3
): RagChunk[] {
  if (!existsSync(knowledgeDir)) return [];

  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const chunks = loadAllChunks(knowledgeDir);
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: scoreChunk(chunk.content, tokens),
  }));

  return scored
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// ── Formatează rezultatele pentru injectare în prompt ────────
export function formatRagContext(chunks: RagChunk[]): string {
  if (chunks.length === 0) return '';

  const sections = chunks.map(c =>
    `### Din: ${c.source}\n${c.content.trim()}`
  ).join('\n\n');

  return `## Context relevant din knowledge base\n\n${sections}`;
}

// ── Tokenizare: cuvinte unice, lowercase, minim 3 litere ────
function tokenize(text: string): string[] {
  return [...new Set(
    text.toLowerCase()
      .replace(/[^\wăâîșțĂÂÎȘȚ\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3)
  )];
}

// ── Score TF: câte token-uri distincte apar în chunk ────────
function scoreChunk(content: string, tokens: string[]): number {
  const lower = content.toLowerCase();
  return tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
}

// ── Încarcă toate fișierele .md din knowledge/ ca chunk-uri ─
function loadAllChunks(dir: string): Omit<RagChunk, 'score'>[] {
  const chunks: Omit<RagChunk, 'score'>[] = [];

  const files = readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => e.name);

  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 50);

    for (const paragraph of paragraphs) {
      chunks.push({ source: file, content: paragraph });
    }
  }

  return chunks;
}
