// ============================================================
// Agent Registry — persistenta enable/disable per agent
// Fisier: state/enabled-agents.json
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface AgentEntry {
  enabled: boolean;
  updatedAt: string;
}

type Registry = Record<string, AgentEntry>;

export class AgentRegistry {
  private path: string;
  private cache: Registry = {};

  constructor(stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
    this.path = join(stateDir, 'enabled-agents.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try { this.cache = JSON.parse(readFileSync(this.path, 'utf-8')); } catch {}
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  isEnabled(name: string): boolean {
    const entry = this.cache[name];
    if (!entry) return true; // default: enabled
    return entry.enabled;
  }

  enable(name: string): void {
    this.cache[name] = { enabled: true, updatedAt: new Date().toISOString() };
    this.save();
  }

  disable(name: string): void {
    this.cache[name] = { enabled: false, updatedAt: new Date().toISOString() };
    this.save();
  }

  getAll(): Registry {
    return { ...this.cache };
  }
}
