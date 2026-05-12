// ============================================================
// IPC Server — controlul daemonului din exterior
// ============================================================
// Permite CLI-ului să comunice cu daemonul fără a-l reporni.
// Folosește Unix socket pe Mac/Linux, TCP pe Windows.
//
// Protocol simplu: JSON linie cu linie
//   → { "command": "status" }
//   ← { "ok": true, "agents": [...] }
//
//   → { "command": "stop", "agent": "demo" }
//   ← { "ok": true }
//
// De ce Unix socket și nu HTTP?
//   E local-only, nicio expunere la rețea, latență sub 1ms.
//   CLI-ul și daemonul sunt pe aceeași mașină.
// ============================================================

import { createServer, type Server } from 'net';
import { unlinkSync, existsSync } from 'fs';
import { platform } from 'os';
import { join } from 'path';
import type { Daemon } from './daemon.ts';

// Pe Windows nu există Unix sockets — folosim TCP pe localhost
const SOCKET_PATH = platform() === 'win32'
  ? undefined
  : join('/tmp', 'nova-cortex.sock');

const TCP_PORT = 7654; // folosit doar pe Windows

export class IpcServer {
  private server: Server | null = null;
  private daemon: Daemon;

  constructor(daemon: Daemon) {
    this.daemon = daemon;
  }

  // ── Pornește server-ul IPC ───────────────────────────────────
  start(): void {
    this.server = createServer((socket) => {
      socket.on('data', (raw) => {
        try {
          const cmd = JSON.parse(raw.toString().trim());
          const response = this.handle(cmd);
          socket.write(JSON.stringify(response) + '\n');
        } catch {
          socket.write(JSON.stringify({ ok: false, error: 'JSON invalid' }) + '\n');
        }
        socket.end();
      });
    });

    if (SOCKET_PATH) {
      // Curățăm socket-ul vechi dacă daemonul a crashat anterior
      if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);
      this.server.listen(SOCKET_PATH, () => {
        console.log(`[ipc] Server pornit pe ${SOCKET_PATH}`);
      });
    } else {
      this.server.listen(TCP_PORT, '127.0.0.1', () => {
        console.log(`[ipc] Server pornit pe localhost:${TCP_PORT}`);
      });
    }
  }

  // ── Oprește server-ul ────────────────────────────────────────
  stop(): void {
    this.server?.close();
    if (SOCKET_PATH && existsSync(SOCKET_PATH)) {
      unlinkSync(SOCKET_PATH);
    }
  }

  // ── Procesează o comandă primită ─────────────────────────────
  private handle(cmd: { command: string; agent?: string }): object {
    switch (cmd.command) {
      case 'status':
        return { ok: true, agents: this.daemon.getStatus() };

      case 'stop':
        if (!cmd.agent) return { ok: false, error: 'Lipsește agent' };
        return { ok: this.daemon.stopAgent(cmd.agent) };

      case 'start':
        if (!cmd.agent) return { ok: false, error: 'Lipsește agent' };
        return { ok: this.daemon.startAgent(cmd.agent) };

      case 'enable':
        if (!cmd.agent) return { ok: false, error: 'Lipsește agent' };
        return { ok: this.daemon.enableAgent(cmd.agent) };

      case 'disable':
        if (!cmd.agent) return { ok: false, error: 'Lipsește agent' };
        return { ok: this.daemon.disableAgent(cmd.agent) };

      case 'heartbeats':
        return { ok: true, heartbeats: this.daemon.getHeartbeats() };

      case 'output':
        if (!cmd.agent) return { ok: false, error: 'Lipsește agent' };
        return { ok: true, lines: this.daemon.getAgentOutput(cmd.agent) };

      default:
        return { ok: false, error: `Comandă necunoscută: ${cmd.command}` };
    }
  }
}
