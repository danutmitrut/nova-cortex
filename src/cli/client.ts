// ============================================================
// IPC Client — comunică cu daemonul prin socket/TCP
// ============================================================
// Trimite o comandă JSON și returnează răspunsul.
// Același protocol ca IpcServer din daemon/ipc.ts.
// ============================================================

import { createConnection } from 'net';
import { platform } from 'os';

const SOCKET_PATH = '/tmp/nova-cortex.sock';
const TCP_PORT = 7654;
const TIMEOUT_MS = 5_000;

export async function sendCommand(command: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const useSocket = platform() !== 'win32';
    const socket = useSocket
      ? createConnection(SOCKET_PATH)
      : createConnection(TCP_PORT, '127.0.0.1');

    let buffer = '';

    socket.setTimeout(TIMEOUT_MS);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Timeout: daemonul nu a răspuns în 5s. Rulează "npm run dev"?'));
    });

    socket.on('connect', () => {
      socket.write(JSON.stringify(command) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
    });

    socket.on('end', () => {
      try {
        resolve(JSON.parse(buffer));
      } catch {
        reject(new Error(`Răspuns invalid de la daemon: ${buffer}`));
      }
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        reject(new Error('Daemonul nu rulează. Pornește-l cu "npm run dev".'));
      } else {
        reject(err);
      }
    });
  });
}
