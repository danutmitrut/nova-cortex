// ============================================================
// Dashboard Server — interfață web la localhost:4242
// ============================================================
// GET  /             → HTML dashboard (necesită auth)
// GET  /login        → pagina de login
// GET  /api/status   → JSON status agenți
// GET  /api/bus      → JSON mesaje recente din bus
// GET  /api/logs     → JSON ultimele 200 linii log daemon
// POST /api/login    → autentifică { token } → setează cookie nc_token
// POST /api/bus      → trimite mesaj bus { to, content }
// POST /api/agent    → start/stop agent { action, name }
// ============================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID, randomBytes } from 'crypto';
import { getRecentLogs } from '../daemon/logger.ts';
import type { Daemon } from '../daemon/daemon.ts';

const PORT = 4242;
const TOKEN_FILE = '.dashboard-token';

export class DashboardServer {
  private daemon: Daemon;
  private busDir: string;
  private stateDir: string;
  private token: string;

  constructor(daemon: Daemon, busDir: string, stateDir: string) {
    this.daemon = daemon;
    this.busDir = busDir;
    this.stateDir = stateDir;
    this.token = this.loadOrCreateToken();
  }

  private loadOrCreateToken(): string {
    mkdirSync(this.stateDir, { recursive: true });
    const tokenPath = join(this.stateDir, TOKEN_FILE);
    if (existsSync(tokenPath)) {
      return readFileSync(tokenPath, 'utf8').trim();
    }
    const token = randomBytes(16).toString('hex');
    writeFileSync(tokenPath, token);
    return token;
  }

  private isAuthenticated(req: IncomingMessage): boolean {
    const cookie = req.headers.cookie ?? '';
    return cookie.split(';').some(c => c.trim() === `nc_token=${this.token}`);
  }

  start(): void {
    const server = createServer((req, res) => this.handle(req, res));
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[dashboard] http://localhost:${PORT}`);
      console.log(`[dashboard] Token acces: ${this.token}`);
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

    // ── Login page (fără auth) ───────────────────────────────
    if (url === '/login') return this.sendLoginHtml(res);

    if (method === 'POST' && url === '/api/login') {
      const body = await this.readBody(req);
      try {
        const { token } = JSON.parse(body);
        if (token === this.token) {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `nc_token=${this.token}; HttpOnly; SameSite=Strict; Path=/`,
          });
          res.end(JSON.stringify({ ok: true }));
        } else {
          this.sendJson(res, { ok: false, error: 'Token invalid' }, 401);
        }
      } catch {
        this.sendJson(res, { ok: false, error: 'JSON invalid' }, 400);
      }
      return;
    }

    // ── Auth guard ───────────────────────────────────────────
    if (!this.isAuthenticated(req)) {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }

    if (method === 'GET') {
      if (url === '/api/status')               return this.sendJson(res, { agents: this.daemon.getStatus() });
      if (url === '/api/bus')                  return this.sendJson(res, { messages: this.getRecentBusMessages() });
      if (url === '/api/logs')                 return this.sendJson(res, { lines: getRecentLogs() });
      if (url === '/api/agents')               return this.sendJson(res, { agents: this.daemon.getAgentNames() });
      if (url === '/api/heartbeats')           return this.sendJson(res, { heartbeats: this.daemon.getHeartbeats() });
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
          if (action === 'start')   return this.sendJson(res, { ok: this.daemon.startAgent(name) });
          if (action === 'stop')    return this.sendJson(res, { ok: this.daemon.stopAgent(name) });
          if (action === 'enable')  return this.sendJson(res, { ok: this.daemon.enableAgent(name) });
          if (action === 'disable') return this.sendJson(res, { ok: this.daemon.disableAgent(name) });
          return this.sendJson(res, { ok: false, error: 'action trebuie să fie start/stop/enable/disable' }, 400);
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
      : '<h1>My HerOS</h1><p>index.html lipsește</p>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private sendLoginHtml(res: ServerResponse): void {
    const html = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>My HerOS — Login</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'SF Mono', 'Fira Code', monospace; background: #0d0d0d; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { background: #111; border: 1px solid #222; border-radius: 10px; padding: 32px 36px; width: 340px; }
  h1 { color: #7ee8a2; font-size: 1.2rem; margin-bottom: 6px; }
  p { color: #444; font-size: 0.75rem; margin-bottom: 24px; }
  label { display: block; color: #666; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  input { width: 100%; background: #161616; border: 1px solid #2a2a2a; border-radius: 4px; color: #e0e0e0; font-family: inherit; font-size: 0.85rem; padding: 10px 12px; outline: none; }
  input:focus { border-color: #444; }
  button { margin-top: 14px; width: 100%; background: #1a4a2a; color: #7ee8a2; border: none; border-radius: 4px; padding: 10px; font-family: inherit; font-size: 0.85rem; cursor: pointer; }
  button:hover { background: #1f5a32; }
  .err { color: #e87e7e; font-size: 0.75rem; margin-top: 10px; display: none; }
  .hint { color: #333; font-size: 0.68rem; margin-top: 18px; }
</style>
</head>
<body>
<div class="card">
  <h1>⬡ My HerOS</h1>
  <p>Introdu token-ul de acces din consolă.</p>
  <label for="token">Token</label>
  <input type="password" id="token" placeholder="••••••••••••••••" autofocus />
  <button onclick="login()">Autentifică</button>
  <div class="err" id="err">Token incorect.</div>
  <p class="hint">Token-ul apare în consolă la pornirea daemonului:<br>
  <code>[dashboard] Token acces: ...</code></p>
</div>
<script>
  async function login() {
    const token = document.getElementById('token').value.trim();
    const r = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ token }) });
    const data = await r.json();
    if (data.ok) { window.location.href = '/'; }
    else { document.getElementById('err').style.display = 'block'; }
  }
  document.getElementById('token').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
</script>
</body>
</html>`;
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
