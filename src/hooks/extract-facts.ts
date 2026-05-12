#!/usr/bin/env node
// PreCompact hook — extrage fapte din rezumatul sesiunii si le salveaza in memory/facts/
// Non-blocking: nu blocheaza compactarea niciodata

import { existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnv, readStdin } from './index.ts';

interface FactEntry {
  ts: string;
  session_id: string;
  agent: string;
  source: 'precompact';
  summary: string;
  keywords: string[];
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
    'by', 'from', 'is', 'was', 'are', 'were', 'be', 'been', 'has', 'have', 'had', 'do',
    'does', 'did', 'will', 'would', 'could', 'should', 'that', 'this', 'it', 'its',
    'si', 'sau', 'dar', 'ca', 'sa', 'la', 'de', 'in', 'cu', 'pe', 'din', 'pentru', 'care',
  ]);
  const words = text.toLowerCase().replace(/[^a-z0-9\sàâăîșțşţ_-]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq).filter(([, c]) => c >= 2).sort(([, a], [, b]) => b - a)
    .slice(0, 20).map(([w]) => w);
}

async function main(): Promise<void> {
  const env = loadEnv();
  try {
    const raw = await Promise.race([
      readStdin(),
      new Promise<string>(resolve => setTimeout(() => resolve(''), 10_000)),
    ]);
    if (!raw.trim()) return;

    let payload: any = {};
    try { payload = JSON.parse(raw); } catch { payload = { summary: raw.trim() }; }

    let summaryText = payload.summary || '';
    if (!summaryText && payload.turns?.length) {
      const lastAssistant = [...payload.turns].reverse().find((t: any) => t.role === 'assistant');
      if (lastAssistant) summaryText = lastAssistant.content;
    }
    if (!summaryText || summaryText.trim().length < 20) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const factsDir = join(env.stateDir, 'memory', 'facts');
    if (!existsSync(factsDir)) mkdirSync(factsDir, { recursive: true });

    const entry: FactEntry = {
      ts: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      session_id: payload.session_id || `session-${Date.now()}`,
      agent: env.agentName,
      source: 'precompact',
      summary: summaryText.slice(0, 8000),
      keywords: extractKeywords(summaryText),
    };

    appendFileSync(join(factsDir, `${dateStr}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {}
}

main().catch(() => process.exit(0));
