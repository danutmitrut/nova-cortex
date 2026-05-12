// ============================================================
// Dashboard Server — interfață web la localhost:4242
// ============================================================
// GET  /             → HTML dashboard
// GET  /api/status   → JSON status agenți
// GET  /api/bus      → JSON mesaje recente din bus
// GET  /api/logs     → JSON ultimele 200 linii log daemon
// POST /api/bus      → trimite mesaj bus { to, content }
// POST /api/agent    → start/stop agent { action, name }
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getRecentLogs } from '../daemon/logger.ts';
import type { Daemon } from '../daemon/daemon.ts';

const PORT = 4242;

export class DashboardServer {
  private daemon: Daemon;
  private busDir: string;

  constructor(daemon: Daemon, busDir: string) {
    this.daemon = daemon;
    this.busDir = busDir;
  }

  start(): void {
    const server = createServer((req, res) => this.handle(req, res));
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[dashboard] http://localhost:${PORT}`);
    });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // ── CORS pentru development ──────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (method === 'GET') {
      if (url === '/api/status')               return this.sendJson(res, { agents: this.daemon.getStatus() });
      if (url === '/api/bus')                  return this.sendJson(res, { messages: this.getRecentBusMessages() });
      if (url === '/api/logs')                 return this.sendJson(res, { lines: getRecentLogs() });
      if (url === '/api/agents')               return this.sendJson(res, { agents: this.daemon.getAgentNames() });
      if (url.startsWith('/api/output/')) {
        const name = url.slice('/api/output/'.length);
        return this.sendJson(res, { lines: this.daemon.getAgentOutput(name) });
      }
      return this.sendHtml(res);
    }

    if (method === 'POST') {
      const body = await this.readBody(req);
      try {
        const data = JSON.parse(body);

        if (url === '/api/bus') {
          const { to, content } = data;
          if (!to || !content) return this.sendJson(res, { ok: false, error: 'Lipsesc câmpuri: to, content' }, 400);
          this.writeBusMessage(to, content);
          return this.sendJson(res, { ok: true });
        }

        if (url === '/api/agent') {
          const { action, name } = data;
          if (action === 'start') return this.sendJson(res, { ok: this.daemon.startAgent(name) });
          if (action === 'stop')  return this.sendJson(res, { ok: this.daemon.stopAgent(name) });
          return this.sendJson(res, { ok: false, error: 'action trebuie să fie start sau stop' }, 400);
        }
      } catch {
        return this.sendJson(res, { ok: false, error: 'JSON invalid' }, 400);
      }
    }

    res.writeHead(404); res.end();
  }

  private sendJson(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendHtml(res: ServerResponse): void {
    const htmlPath = new URL('./index.html', import.meta.url).pathname;
    const html = existsSync(htmlPath)
      ? readFileSync(htmlPath, 'utf8')
      : '<h1>Nova Cortex</h1><p>index.html lipsește</p>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise(resolve => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => resolve(body));
    });
  }

  private writeBusMessage(to: string, content: string): void {
    const inboxDir = join(this.busDir, to, 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    const id = randomUUID();
    const ts = new Date().toISOString();
    const filename = `${ts.replace(/[:.]/g, '-').slice(0, 19)}-${id}.json`;
    writeFileSync(join(inboxDir, filename), JSON.stringify({
      id, from: 'dashboard', to, content, timestamp: ts, requiresAck: false,
    }, null, 2));
  }

  private getRecentBusMessages(): object[] {
    const messages: object[] = [];
    if (!existsSync(this.busDir)) return messages;

    try {
      const agents = readdirSync(this.busDir, { withFileTypes: true })
        .filter(e => e.isDirectory()).map(e => e.name);

      for (const agent of agents) {
        const processedDir = join(this.busDir, agent, 'processed');
        if (!existsSync(processedDir)) continue;
        const files = readdirSync(processedDir).filter(f => f.endsWith('.json')).sort().slice(-10);
        for (const file of files) {
          try { messages.push(JSON.parse(readFileSync(join(processedDir, file), 'utf8'))); } catch {}
        }
      }
    } catch {}

    return messages
      .sort((a: any, b: any) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, 20);
  }
}
