// ============================================================
// Dashboard Server — interfață web la localhost:4242
// ============================================================
// Server HTTP pur (fără Express), două endpoint-uri:
//   GET /         → pagina HTML a dashboard-ului
//   GET /api/status → JSON cu statusul agenților
//   GET /api/bus   → JSON cu ultimele mesaje din bus
//
// De ce nu Express?
//   Dashboard-ul e intern, fără rețea publică, fără auth.
//   Node.js http nativ are tot ce ne trebuie, zero dependențe.
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
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

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    if (url === '/api/status') {
      this.sendJson(res, { agents: this.daemon.getStatus() });
    } else if (url === '/api/bus') {
      this.sendJson(res, { messages: this.getRecentBusMessages() });
    } else {
      this.sendHtml(res);
    }
  }

  private sendJson(res: ServerResponse, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  }

  private sendHtml(res: ServerResponse): void {
    const htmlPath = new URL('./index.html', import.meta.url).pathname;
    const html = existsSync(htmlPath)
      ? readFileSync(htmlPath, 'utf8')
      : '<h1>Nova Cortex Dashboard</h1><p>index.html lipsește</p>';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  // Citește ultimele 20 de mesaje procesate din bus/*/processed/
  private getRecentBusMessages(): object[] {
    const messages: object[] = [];

    if (!existsSync(this.busDir)) return messages;

    try {
      const agents = readdirSync(this.busDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);

      for (const agent of agents) {
        const processedDir = join(this.busDir, agent, 'processed');
        if (!existsSync(processedDir)) continue;

        const files = readdirSync(processedDir)
          .filter(f => f.endsWith('.json'))
          .sort()
          .slice(-10); // ultimele 10 per agent

        for (const file of files) {
          try {
            const raw = readFileSync(join(processedDir, file), 'utf8');
            messages.push(JSON.parse(raw));
          } catch {
            // fișier corupt — ignorat
          }
        }
      }
    } catch {
      // busDir inaccesibil — returnăm ce avem
    }

    // Sortăm după timestamp descrescător, limităm la 20 total
    return messages
      .sort((a: any, b: any) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))
      .slice(0, 20);
  }
}
