// ============================================================
// Bus Send — trimite un mesaj în inbox-ul unui agent
// ============================================================
// Fiecare mesaj = un fișier JSON în bus/<destinatar>/inbox/
// Numele fișierului include timestamp pentru ordine cronologică.
//
// De ce fișiere JSON în loc de o coadă în memorie?
//   - Persistă la restart (mesajele nu se pierd)
//   - Debuggable: poți inspecta inbox-ul cu ls / cat
//   - Nu necesită un broker (Redis, RabbitMQ, etc.)
//   - Funcționează la fel pe Mac și Windows
// ============================================================

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { BusMessage } from './types.ts';

export function sendMessage(
  busDir: string,
  from: string,
  to: string,
  content: string,
  requiresAck = false,
): BusMessage {
  const message: BusMessage = {
    id: randomUUID(),
    from,
    to,
    content,
    timestamp: new Date().toISOString(),
    requiresAck,
  };

  // Creăm directorul inbox dacă nu există
  const inboxDir = join(busDir, to, 'inbox');
  if (!existsSync(inboxDir)) mkdirSync(inboxDir, { recursive: true });

  // Numele fișierului: timestamp + ID (ordine cronologică + unicitate)
  const filename = `${message.timestamp.replace(/[:.]/g, '-')}-${message.id}.json`;
  writeFileSync(join(inboxDir, filename), JSON.stringify(message, null, 2), 'utf-8');

  console.log(`[bus] Mesaj trimis: ${from} → ${to} | "${content.slice(0, 60)}..."`);
  return message;
}
